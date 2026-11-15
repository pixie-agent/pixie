//! ACP (Agent Client Protocol) engine — the "meta-engine".
//!
//! Following Zed's `agent_servers` design: there is **no per-agent code**. Every
//! ACP-compatible agent (Claude Code adapter, Gemini CLI, Codex adapter, Pi,
//! OpenCode, Cursor, ...) is a launch configuration (command + args + env) in
//! the agent registry; one generic implementation drives all of them over
//! newline-delimited JSON-RPC on stdio (the protocol's only transport today).
//!
//! Wire map (ACP v1, schema 1.29.x):
//! - `initialize` handshake -> version + capability negotiation
//! - `session/new` (or `session/load` when `loadSession` is advertised) -> agent-owned session id
//! - `session/prompt` request -> streamed `session/update` notifications -> response `{stopReason}`
//! - `session/update` variants -> [`NormalizedEvent`] (message/thought chunks,
//!   tool calls, `usage_update`, ...)
//! - `session/request_permission` (agent -> client request) -> interactive approval
//! - `session/cancel` notification -> graceful turn cancellation
//!
//! Unlike the CLIs parsed in `claude.rs` / `cursor.rs`, ACP is **bidirectional**,
//! so this engine does not go through `parse_line` (which only sees one stream);
//! the turn reader in this file handles both directions.

use anyhow::{Context as _, Result};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::atomic::{AtomicI64, Ordering};
use std::sync::{Arc, Mutex as StdMutex};
use std::time::{Duration, Instant};
use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader};
use tokio::process::{Child, ChildStdin, ChildStdout};
use tokio::sync::Mutex;

use super::persistent::{TurnOutcome, MAX_HEARTBEAT_TIMEOUTS, READ_HEARTBEAT_TIMEOUT};
use super::shared::{self, detach_from_controlling_terminal, truncate_text, MAX_TOOL_RESULT_CHARS};
use super::{
    AuthState, EngineStatus, NormalizedEvent, PlanEntryEvent, ProbeOutcome, ToolEvent,
    ToolEventKind, UsageInfo,
};

// ---------------------------------------------------------------------------
// Agent registry — launch configurations, not code (Zed's agent_servers.rs)
// ---------------------------------------------------------------------------

/// How to launch an ACP agent. Registry entries are data, so adding a new
/// engine is a new entry — never a new code path.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AcpAgentConfig {
    /// Stable engine id used everywhere ("acp/<key>").
    pub key: String,
    /// Human-readable display name (shown in the picker).
    pub label: String,
    /// Binary to launch. Either a bare name resolved on PATH (like the other
    /// engines do) or an absolute path.
    pub command: String,
    /// Arguments appended after `command`.
    #[serde(default)]
    pub args: Vec<String>,
    /// Extra environment variables for the agent process.
    #[serde(default)]
    pub env: HashMap<String, String>,
    /// Probe message used by the readiness check (sent as the first prompt).
    #[serde(default = "default_probe_message")]
    pub probe_message: String,
}

fn default_probe_message() -> String {
    "ping".to_string()
}

/// Built-in registry entries. These wrap the well-known community adapters so
/// the feature works out of the box; users can add more via `acp_agents` in
/// `config.json` (frontend settings UI edits the same blob).
///
/// Since the unified-ACP switch, the legacy native engine ids (`claude`,
/// `codex`, `codebuddy`, `cursor`) are *aliases* resolved through this
/// registry — their dispatch maps engine id → `acp/<key>` before spawning, so
/// their entries here are the launch configs for those aliases. `gemini`
/// remains a standalone registry agent. Keep keys in sync with
/// `native_engine_acp_key` in `engine/mod.rs`.
pub fn builtin_acp_agents() -> Vec<AcpAgentConfig> {
    vec![
        // Aliases for the legacy native engine ids.
        AcpAgentConfig {
            key: "claude".into(),
            label: "Claude Code".into(),
            command: "npx".into(),
            args: vec![
                "-y".into(),
                "@agentclientprotocol/claude-agent-acp@latest".into(),
            ],
            env: HashMap::new(),
            probe_message: "ping".into(),
        },
        AcpAgentConfig {
            key: "codex".into(),
            label: "OpenAI Codex".into(),
            command: "npx".into(),
            args: vec!["-y".into(), "@agentclientprotocol/codex-acp@latest".into()],
            env: HashMap::new(),
            probe_message: "ping".into(),
        },
        AcpAgentConfig {
            key: "codebuddy".into(),
            label: "CodeBuddy".into(),
            command: "npx".into(),
            args: vec![
                "-y".into(),
                "@tencent-ai/codebuddy-code@latest".into(),
                "--acp".into(),
            ],
            env: HashMap::new(),
            probe_message: "ping".into(),
        },
        AcpAgentConfig {
            key: "cursor".into(),
            label: "Cursor Agent".into(),
            command: "cursor-agent".into(),
            args: vec!["acp".into()],
            env: HashMap::new(),
            probe_message: "ping".into(),
        },
        // Standalone registry agent.
        AcpAgentConfig {
            key: "gemini".into(),
            label: "Gemini CLI".into(),
            command: "gemini".into(),
            args: vec!["--experimental-acp".into()],
            env: HashMap::new(),
            probe_message: "ping".into(),
        },
    ]
}

// ---------------------------------------------------------------------------
// Engine-id plumbing
// ---------------------------------------------------------------------------

/// The namespace prefix for every registry-backed engine id.
pub const ACP_PREFIX: &str = "acp/";

pub fn is_acp_engine_id(id: &str) -> bool {
    id.starts_with(ACP_PREFIX)
}

/// Extract the registry key from an engine id ("acp/gemini" -> "gemini").
pub fn acp_key_of(id: &str) -> Option<&str> {
    id.strip_prefix(ACP_PREFIX)
}

/// Build an engine id from a registry key.
pub fn acp_engine_id(key: &str) -> String {
    format!("{ACP_PREFIX}{key}")
}

/// Env-prefix sets mirroring the native engines' collectors (claude.rs etc.).
/// Since native engine ids are aliases routed through the ACP path, their
/// launch configs must inherit the same environment variables the native
/// spawn path used to forward — per-engine API keys and model overrides live
/// in these (`ANTHROPIC_API_KEY`, `OPENAI_BASE_URL`, …). Keyed by registry
/// key; `gemini` (no native twin) forwards everything with a GEMINI/ GOOGLE_
/// prefix.
pub fn env_prefixes_for(key: &str) -> &'static [&'static str] {
    match key {
        "claude" => &[
            "ANTHROPIC_",
            "CLAUDE",
            "AWS_",
            "GOOGLE_",
            "VERTEX_",
            "OPENAI_",
            "AZURE_",
        ],
        "codex" => &["CODEX_", "OPENAI_", "GITHUB_"],
        "codebuddy" => &["CODEBUDDY_", "CBC_"],
        "cursor" => &["CURSOR_"],
        "gemini" => &["GEMINI_", "GOOGLE_"],
        _ => &[],
    }
}

// ---------------------------------------------------------------------------
// JSON-RPC framing
// ---------------------------------------------------------------------------

/// One JSON-RPC message going out (request or notification).
#[derive(Debug, Clone, Serialize)]
struct OutgoingMessage {
    jsonrpc: &'static str,
    #[serde(skip_serializing_if = "Option::is_none")]
    id: Option<i64>,
    method: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    params: Option<Value>,
}

/// One incoming JSON-RPC envelope, method-agnostic.
#[derive(Debug, Clone, Deserialize)]
struct IncomingEnvelope {
    #[serde(default)]
    id: Option<Value>,
    #[serde(default)]
    method: Option<String>,
    #[serde(default)]
    params: Option<Value>,
    #[serde(default)]
    result: Option<Value>,
    #[serde(default)]
    error: Option<Value>,
}

/// Monotonic id counter shared by all requests on one connection.
#[derive(Debug, Default)]
struct RequestIdCounter(AtomicI64);

impl RequestIdCounter {
    fn next(&self) -> i64 {
        self.0.fetch_add(1, Ordering::Relaxed) + 1
    }
}

/// A pending `session/request_permission` from the agent: the option ids to
/// select when the user allows or denies. Lookup is per-session (each
/// conversation owns its own AcpSession, hence its own pending map).
#[derive(Debug, Clone)]
pub struct PendingPermission {
    pub allow_option_id: String,
    pub reject_option_id: String,
}

/// Pending agent->client permission requests we must answer, keyed by the
/// JSON-RPC request id the agent used.
pub type PendingPermissions = Arc<StdMutex<HashMap<i64, PendingPermission>>>;

/// Capabilities the agent advertised during `initialize` (subset we consume).
#[derive(Debug, Clone, Default)]
pub struct AgentCapabilities {
    pub load_session: bool,
    pub supports_image_prompt: bool,
    /// `sessionCapabilities.options`: the agent supports `session/options` —
    /// model/mode config can be listed WITHOUT creating a session (used by
    /// the model picker to avoid spawning a process per list_models call).
    pub session_options: bool,
}

/// One selectable choice inside a [`SessionConfigOption`].
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SessionConfigOptionChoice {
    pub value: Value,
    pub name: String,
    #[serde(default)]
    pub description: Option<String>,
}

/// A `configOptions` entry from `session/new` / `session/options` /
/// `session/set_config_option`. The model picker consumes the entry with
/// `category: "model"`; the values serialize as strings (or booleans for
/// boolean-typed options).
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SessionConfigOption {
    /// Stable id ("model", "thought_level", ...). `set_config_option` targets it.
    pub id: String,
    pub name: String,
    #[serde(default)]
    pub description: Option<String>,
    /// "mode" | "model" | "model_config" | "thought_level" | custom string.
    #[serde(default)]
    pub category: Option<String>,
    /// "select" | "boolean".
    #[serde(rename = "type")]
    pub kind: String,
    /// Currently active value (string or bool).
    #[serde(default)]
    pub current_value: Option<Value>,
    #[serde(default)]
    pub options: Vec<SessionConfigOptionChoice>,
}

impl SessionConfigOption {
    /// The currently-selected value, when known.
    pub fn current(&self) -> Option<&Value> {
        self.current_value.as_ref()
    }
}

/// Whether the session turn has seen a terminal stop.
#[derive(Debug)]
struct TurnState {
    stop_reason: Option<String>,
    errored: bool,
    error_message: Option<String>,
    final_text: String,
}

impl TurnState {
    fn new() -> Self {
        Self {
            stop_reason: None,
            errored: false,
            error_message: None,
            final_text: String::new(),
        }
    }
}

// ---------------------------------------------------------------------------
// AcpSession — the persistent, bidirectional agent connection
// ---------------------------------------------------------------------------

/// One long-lived ACP agent subprocess. Mirrors `PersistentSession`'s role in
/// `send_message` (kept alive across turns, killed on idle), but speaks
/// JSON-RPC: writes are requests/notifications, reads interleave `session/update`
/// notifications with responses and agent->client requests.
pub struct AcpSession {
    /// Engine id ("acp/<key>"); used for logs and diagnostics.
    pub engine_id: String,
    /// Agent-owned session id (returned by `session/new`), distinct from the
    /// Pixie conversation id. Remembered via `remember_session_id`.
    pub acp_session_id: Option<String>,
    /// Config options (modes/model/thought level) captured from the most
    /// recent `session/new` / `session/load` / `set_config_option` response,
    /// kept current by `config_option_update` pushes. Shared with the turn
    /// reader so mid-turn pushes land in the same cache the model picker
    /// reads (`category: "model"` entry).
    pub config_options: Arc<StdMutex<Vec<SessionConfigOption>>>,
    #[allow(dead_code)] // retained for diagnostics/logging on crash paths
    pub agent_config: AcpAgentConfig,
    pub capabilities: AgentCapabilities,
    /// Last evidence of activity (any stdout line or stdin write). Shared with
    /// the turn reader so the idle reaper sees streaming turns as active.
    pub last_active: Arc<StdMutex<Instant>>,
    /// Working directory the agent process was launched with (fallback cwd
    /// for `terminal/create`).
    pub launch_cwd: Option<PathBuf>,
    /// Client-managed terminals created by the agent this session.
    pub terminals: AcpTerminalMap,

    child: Child,
    /// Stdin is behind a shared Mutex: `send_message` (caller holds &mut) and
    /// the turn reader's error/permission responses (&self) both write, and
    /// interleaving at frame boundaries is safe — each write is one line.
    stdin: Arc<Mutex<ChildStdin>>,
    stdout: Arc<Mutex<BufReader<ChildStdout>>>,
    next_request_id: Arc<RequestIdCounter>,
    /// Request id of the most recent `session/prompt` sent — the response
    /// `read_acp_turn` treats as the turn terminator.
    last_prompt_id: i64,
    /// Agent->client permission requests awaiting the user's decision.
    pub pending: PendingPermissions,
    stderr_tail: Arc<StdMutex<String>>,
}

impl AcpSession {
    /// Spawn the agent process and run the `initialize` handshake.
    ///
    /// Does NOT create the ACP session yet — that happens lazily in
    /// [`ensure_session`](Self::ensure_session) on the first message, because
    /// `session/new` needs the workspace cwd, which `send_message` resolves.
    pub async fn spawn(config: AcpAgentConfig, cwd: Option<&str>) -> Result<Self> {
        let binary = shared::find_binary(&[&config.command], &config.label)?;
        let mut env = shared::collect_env(
            &config.key,
            env_prefixes_for(&config.key),
            shared::ENV_EXACT,
        )
        .await;
        for (k, v) in &config.env {
            if !v.is_empty() {
                env.insert(k.clone(), v.clone());
            }
        }

        let mut cmd = shared::engine_command(&binary);
        cmd.args(&config.args)
            .stdin(std::process::Stdio::piped())
            .stdout(std::process::Stdio::piped())
            .stderr(std::process::Stdio::piped());
        if let Some(dir) = cwd {
            cmd.current_dir(dir);
        }
        for (k, v) in &env {
            cmd.env(k, v);
        }
        detach_from_controlling_terminal(&mut cmd);

        let mut child = cmd
            .spawn()
            .with_context(|| format!("failed to spawn ACP agent {}", config.command))?;

        let stdin = child.stdin.take().context("ACP agent stdin not captured")?;
        let stdout = child
            .stdout
            .take()
            .context("ACP agent stdout not captured")?;
        let stderr_tail = Arc::new(StdMutex::new(String::new()));
        if let Some(stderr) = child.stderr.take() {
            spawn_stderr_drain(stderr, Arc::clone(&stderr_tail));
        }

        let mut session = Self {
            engine_id: acp_engine_id(&config.key),
            acp_session_id: None,
            config_options: Arc::new(StdMutex::new(Vec::new())),
            agent_config: config,
            capabilities: AgentCapabilities::default(),
            last_active: Arc::new(StdMutex::new(Instant::now())),
            launch_cwd: cwd.map(PathBuf::from),
            terminals: Arc::new(StdMutex::new(HashMap::new())),
            child,
            stdin: Arc::new(Mutex::new(stdin)),
            stdout: Arc::new(Mutex::new(BufReader::new(stdout))),
            next_request_id: Arc::new(RequestIdCounter::default()),
            last_prompt_id: 0,
            pending: Arc::new(StdMutex::new(HashMap::new())),
            stderr_tail,
        };
        session.initialize_handshake().await?;
        Ok(session)
    }

    /// Read frames until the `initialize` response arrives, storing the
    /// negotiated capabilities. Agent->client requests cannot happen before
    /// a session exists, so nothing needs answering here.
    async fn initialize_handshake(&mut self) -> Result<()> {
        let request = OutgoingMessage {
            jsonrpc: "2.0",
            id: Some(self.next_request_id.next()),
            method: "initialize".into(),
            params: Some(json!({
                "protocolVersion": 1,
                "clientCapabilities": {
                    "fs": {"readTextFile": false, "writeTextFile": false},
                    // Client-managed terminals: the agent delegates running
                    // commands (Bash) to Pixie and reads exit status back.
                    // Live output streams into the tool card (`acp.rs`
                    // terminal handlers + the per-turn pump in `lib.rs`).
                    "terminal": true,
                    // ID-addressed compaction lifecycle (status + retained
                    // summary) and live `notice` session updates.
                    "session": {"compaction": {}, "notices": {}},
                    // RFD-1992 native subagents (claude-code-acp gates its
                    // `subagent_update` + child-session event routing on
                    // this object being present).
                    "subagents": {},
                },
                "clientInfo": {"name": "Pixie", "version": env!("CARGO_PKG_VERSION")},
            })),
        };
        let id = request.id.expect("initialize has an id");
        self.write_message(&request).await?;

        loop {
            let envelope = self.read_envelope().await?;
            if envelope.id.as_ref().and_then(as_i64) == Some(id) {
                if let Some(err) = envelope.error {
                    anyhow::bail!("ACP initialize failed: {err}");
                }
                let result = envelope.result.unwrap_or(Value::Null);
                self.capabilities = AgentCapabilities {
                    load_session: result
                        .pointer("/agentCapabilities/loadSession")
                        .and_then(Value::as_bool)
                        .unwrap_or(false),
                    supports_image_prompt: result
                        .pointer("/agentCapabilities/promptCapabilities/image")
                        .and_then(Value::as_bool)
                        .unwrap_or(false),
                    session_options: result
                        .pointer("/agentCapabilities/sessionCapabilities/options")
                        .and_then(Value::as_bool)
                        .unwrap_or(false),
                };
                log::info!(
                    "[acp] {} initialized: loadSession={}, image={}, sessionOptions={}",
                    self.engine_id,
                    self.capabilities.load_session,
                    self.capabilities.supports_image_prompt,
                    self.capabilities.session_options
                );
                return Ok(());
            }
            // Stray notifications/responses before initialize completes are
            // protocol noise — ignore them (nothing to answer: no session yet).
        }
    }

    /// Create (or load) the ACP session with the workspace as cwd. When
    /// `resume_id` is Some, calls `session/load` with that agent-side id
    /// (requires the agent's `loadSession` capability); otherwise `session/new`.
    ///
    /// `config_options` are the initial session config selections (UNSTABLE
    /// `InitialSessionConfigOption`) — e.g. the conversation's persisted model
    /// choice, applied on `session/new` in order. Agents ignore unknown
    /// ids/values per spec, so a stale persisted model never blocks setup.
    /// The response's `configOptions` (full set incl. the model entry) is
    /// captured into the session for the model picker.
    pub async fn ensure_session(
        &mut self,
        cwd: Option<&str>,
        resume_id: Option<&str>,
        config_options: &[(String, Value)],
    ) -> Result<()> {
        if self.acp_session_id.is_some() {
            return Ok(());
        }
        let cwd = cwd
            .map(PathBuf::from)
            .or_else(shared::home_dir)
            .context("ACP session/new requires a working directory")?;
        let cwd = cwd.to_string_lossy().to_string();

        let mut base = match resume_id.filter(|_| self.capabilities.load_session) {
            Some(sid) => json!({"cwd": cwd, "mcpServers": [], "sessionId": sid}),
            None => json!({"cwd": cwd, "mcpServers": []}),
        };
        if !config_options.is_empty() {
            if let Some(obj) = base.as_object_mut() {
                // Resume never replays config options: session/load restores
                // the loaded session's own state (an old model choice would
                // fight the loaded one).
                if resume_id.is_none() {
                    obj.insert(
                        "configOptions".into(),
                        Value::Array(
                            config_options
                                .iter()
                                .map(|(config_id, value)| {
                                    json!({"configId": config_id.as_str(), "value": value})
                                })
                                .collect(),
                        ),
                    );
                }
            }
        }
        let request = OutgoingMessage {
            jsonrpc: "2.0",
            id: Some(self.next_request_id.next()),
            method: if resume_id
                .filter(|_| self.capabilities.load_session)
                .is_some()
            {
                "session/load".into()
            } else {
                "session/new".into()
            },
            params: Some(base),
        };
        let id = request.id.expect("session/new has an id");
        self.write_message(&request).await?;

        loop {
            let envelope = self.read_envelope().await?;
            if envelope.id.as_ref().and_then(as_i64) == Some(id) {
                if let Some(err) = envelope.error {
                    anyhow::bail!("ACP session/new failed: {err}");
                }
                let result = envelope.result.unwrap_or(Value::Null);
                let session_id = result
                    .get("sessionId")
                    .and_then(Value::as_str)
                    .context("ACP session/new response missing sessionId")?
                    .to_string();
                if let Ok(mut cached) = self.config_options.lock() {
                    *cached = result
                        .get("configOptions")
                        .and_then(|c| {
                            serde_json::from_value::<Vec<SessionConfigOption>>(c.clone()).ok()
                        })
                        .unwrap_or_default();
                }
                log::info!(
                    "[acp] {} session established: {}",
                    self.engine_id,
                    session_id
                );
                self.acp_session_id = Some(session_id);
                return Ok(());
            }
        }
    }

    /// List the session's config options without creating one, via the
    /// UNSTABLE `session/options` request (requires the agent's
    /// `sessionCapabilities.options` capability). Returns None when the
    /// capability is missing or the request fails — callers fall back to the
    /// options captured at `ensure_session` time.
    pub async fn list_session_options(
        &mut self,
        cwd: Option<&str>,
    ) -> Result<Option<Vec<SessionConfigOption>>> {
        if !self.capabilities.session_options {
            return Ok(None);
        }
        let cwd = cwd
            .map(PathBuf::from)
            .or_else(shared::home_dir)
            .context("session/options requires a working directory")?;
        let mut params = json!({"cwd": cwd.to_string_lossy().to_string()});
        if let Some(sid) = &self.acp_session_id {
            params["sessionId"] = json!(sid);
        }
        let request = OutgoingMessage {
            jsonrpc: "2.0",
            id: Some(self.next_request_id.next()),
            method: "session/options".into(),
            params: Some(params),
        };
        let id = request.id.expect("session/options has an id");
        self.write_message(&request).await?;

        loop {
            let envelope = self.read_envelope().await?;
            if envelope.id.as_ref().and_then(as_i64) == Some(id) {
                if let Some(err) = envelope.error {
                    log::warn!("[acp] {} session/options failed: {err}", self.engine_id);
                    return Ok(None);
                }
                let result = envelope.result.unwrap_or(Value::Null);
                let options = result.get("configOptions").and_then(|c| {
                    serde_json::from_value::<Vec<SessionConfigOption>>(c.clone()).ok()
                });
                return Ok(options);
            }
        }
    }

    /// Change one session config option (`session/set_config_option`), e.g.
    /// switching the model on the live session. Returns the full updated
    /// `configOptions` set (and caches it), mirroring the response contract.
    pub async fn set_config_option(
        &mut self,
        config_id: &str,
        value: &Value,
    ) -> Result<Vec<SessionConfigOption>> {
        let session_id = self
            .acp_session_id
            .clone()
            .context("ACP session not established")?;
        let request = OutgoingMessage {
            jsonrpc: "2.0",
            id: Some(self.next_request_id.next()),
            method: "session/set_config_option".into(),
            params: Some(json!({
                "sessionId": session_id,
                "configId": config_id,
                "value": value,
            })),
        };
        let id = request.id.expect("set_config_option has an id");
        self.write_message(&request).await?;

        loop {
            let envelope = self.read_envelope().await?;
            if envelope.id.as_ref().and_then(as_i64) == Some(id) {
                if let Some(err) = envelope.error {
                    anyhow::bail!("ACP set_config_option({config_id}) failed: {err}");
                }
                let result = envelope.result.unwrap_or(Value::Null);
                let options = result
                    .get("configOptions")
                    .and_then(|c| {
                        serde_json::from_value::<Vec<SessionConfigOption>>(c.clone()).ok()
                    })
                    .unwrap_or_default();
                if !options.is_empty() {
                    if let Ok(mut cached) = self.config_options.lock() {
                        *cached = options.clone();
                    }
                }
                log::info!(
                    "[acp] {} set_config_option({config_id}) applied",
                    self.engine_id
                );
                return Ok(options);
            }
        }
    }

    /// The model config option, if the agent exposed one (category "model" or
    /// the well-known id "model").
    pub fn model_option(&self) -> Option<SessionConfigOption> {
        self.config_options
            .lock()
            .ok()?
            .iter()
            .find(|o| o.category.as_deref() == Some("model") || o.id == "model")
            .cloned()
    }

    /// Send the user turn. Content blocks mirror `format_user_message`'s
    /// behavior in persistent.rs: native image blocks when the agent
    /// advertised the `image` prompt capability, `@<path>` mentions otherwise.
    pub async fn send_message(&mut self, message: &str, images: &[String]) -> Result<i64> {
        let session_id = self
            .acp_session_id
            .clone()
            .context("ACP session not established")?;
        let mut prompt: Vec<Value> = Vec::new();
        if !message.is_empty() {
            prompt.push(json!({"type": "text", "text": message}));
        }
        for path in images {
            if self.capabilities.supports_image_prompt {
                if let Some(block) = image_block(path) {
                    prompt.push(block);
                    continue;
                }
            }
            prompt.push(json!({"type": "text", "text": format!("@{path}")}));
        }
        if prompt.is_empty() {
            prompt.push(json!({"type": "text", "text": ""}));
        }
        let prompt_id = self.next_request_id.next();
        self.last_prompt_id = prompt_id;
        let request = OutgoingMessage {
            jsonrpc: "2.0",
            id: Some(prompt_id),
            method: "session/prompt".into(),
            params: Some(json!({"sessionId": session_id, "prompt": prompt})),
        };
        self.write_message(&request).await?;
        Ok(prompt_id)
    }

    /// Cancel the in-flight turn (`session/cancel` notification).
    pub async fn cancel(&mut self) -> Result<()> {
        let session_id = self
            .acp_session_id
            .clone()
            .context("ACP session not established")?;
        let notification = OutgoingMessage {
            jsonrpc: "2.0",
            id: None,
            method: "session/cancel".into(),
            params: Some(json!({"sessionId": session_id})),
        };
        self.write_message(&notification).await
    }

    /// JSON-RPC id of the oldest pending permission request, if any. The
    /// frontend's respond_permission carries only the conversation id, so the
    /// oldest pending request is the one being answered (agents ask one at a
    /// time — they block the turn on the response).
    pub fn first_pending_permission(&self) -> Option<i64> {
        self.pending
            .lock()
            .expect("pending poisoned")
            .keys()
            .copied()
            .min()
    }

    /// Respond to a pending `session/request_permission` from the agent.
    /// `allow` selects the stored allow-ish/reject-ish option id.
    pub async fn respond_permission(&mut self, request_id: i64, allow: bool) -> Result<()> {
        let choice = self
            .pending
            .lock()
            .expect("pending poisoned")
            .get(&request_id)
            .cloned()
            .context("no pending permission request with that id")?;
        let selected = if allow {
            choice.allow_option_id
        } else {
            choice.reject_option_id
        };
        self.pending
            .lock()
            .expect("pending poisoned")
            .remove(&request_id);
        log::info!("[respond_permission] ACP request {request_id}: allow={allow}");
        self.respond(
            request_id,
            json!({"outcome": {"outcome": "selected", "optionId": selected}}),
        )
        .await
    }

    /// Answer every pending permission request with `cancelled`. The ACP spec
    /// requires clients to do this when the turn is cancelled.
    pub async fn cancel_pending_permissions(&mut self) {
        self.turn_ctx().cancel_pending_permissions().await;
    }

    /// Write a JSON-RPC response to an agent->client request.
    async fn respond(&self, id: i64, result: Value) -> Result<()> {
        let msg = json!({"jsonrpc": "2.0", "id": id, "result": result});
        let line = serde_json::to_string(&msg)?;
        self.write_line(&line).await
    }

    async fn write_message(&self, msg: &OutgoingMessage) -> Result<()> {
        let line = serde_json::to_string(msg)?;
        self.write_line(&line).await
    }

    async fn write_line(&self, line: &str) -> Result<()> {
        let mut stdin = self.stdin.lock().await;
        stdin
            .write_all(line.as_bytes())
            .await
            .context("failed to write to ACP agent stdin")?;
        stdin
            .write_all(b"\n")
            .await
            .context("failed to write newline")?;
        stdin.flush().await.context("failed to flush ACP stdin")?;
        self.touch();
        Ok(())
    }

    /// The request id `send_message` last allocated for its `session/prompt`
    /// — the response `read_acp_turn` must wait for.
    pub fn last_prompt_id(&self) -> i64 {
        self.last_prompt_id
    }

    fn touch(&self) {
        if let Ok(mut t) = self.last_active.lock() {
            *t = Instant::now();
        }
    }

    /// Read one JSON-RPC envelope (line-delimited).
    async fn read_envelope(&self) -> Result<IncomingEnvelope> {
        let mut guard = self.stdout.lock().await;
        let mut line = String::new();
        let n = guard.read_line(&mut line).await?;
        if n == 0 {
            anyhow::bail!("ACP agent stdout closed (EOF)");
        }
        self.touch();
        serde_json::from_str(line.trim())
            .with_context(|| format!("invalid JSON-RPC from ACP agent: {line:.200}"))
    }

    pub fn is_alive(&mut self) -> bool {
        matches!(self.child.try_wait(), Ok(None))
    }

    pub fn pid(&self) -> Option<u32> {
        self.child.id()
    }

    pub fn activity(&self) -> Arc<StdMutex<Instant>> {
        Arc::clone(&self.last_active)
    }

    pub fn stderr_tail(&self) -> String {
        self.stderr_tail
            .lock()
            .map(|t| t.trim().to_string())
            .unwrap_or_default()
    }

    pub async fn kill(&mut self) {
        let _ = self.child.kill().await;
        let _ = self.child.wait().await;
    }
}

impl Drop for AcpSession {
    fn drop(&mut self) {
        if let Some(id) = self.child.id() {
            #[cfg(unix)]
            unsafe {
                libc::kill(id as i32, libc::SIGTERM);
            }
        }
    }
}

/// Drain agent stderr into a bounded tail (startup failures are usually only
/// visible there — same rationale as PersistentSession).
fn spawn_stderr_drain(stderr: tokio::process::ChildStderr, tail: Arc<StdMutex<String>>) {
    tokio::spawn(async move {
        let mut reader = BufReader::new(stderr);
        let mut line = String::new();
        loop {
            line.clear();
            match reader.read_line(&mut line).await {
                Ok(0) | Err(_) => break,
                Ok(_) => {
                    if let Ok(mut t) = tail.lock() {
                        t.push_str(line.trim_end());
                        t.push('\n');
                        let len = t.len();
                        if len > 8 * 1024 {
                            t.drain(..len - 8 * 1024);
                        }
                    }
                }
            }
        }
    });
}

/// Build a native image content block for an attachment path (base64 data URL
/// style — ACP uses the MCP content shape). Falls back to None when unreadable
/// or the extension has no MIME mapping (caller degrades to @mention).
fn image_block(path: &str) -> Option<Value> {
    use base64::{engine::general_purpose::STANDARD, Engine as _};
    let ext = std::path::Path::new(path)
        .extension()
        .and_then(|e| e.to_str())
        .unwrap_or("")
        .to_lowercase();
    let mime = match ext.as_str() {
        "png" => "image/png",
        "jpg" | "jpeg" => "image/jpeg",
        "gif" => "image/gif",
        "webp" => "image/webp",
        _ => return None,
    };
    let bytes = std::fs::read(path).ok()?;
    Some(json!({
        "type": "image",
        "data": STANDARD.encode(&bytes),
        "mimeType": mime,
    }))
}

fn as_i64(v: &Value) -> Option<i64> {
    v.as_i64().or_else(|| v.as_u64().map(|u| u as i64))
}

// ---------------------------------------------------------------------------
// Client-managed terminals (ACP `terminal/*` methods)
//
// With the `terminal` client capability advertised, agents (notably
// claude-code-acp's Bash) delegate running commands to Pixie: the agent asks
// the client to spawn the process (`terminal/create`), displays live output in
// the tool card via the client, and reads the exit status back
// (`terminal/wait_for_exit` / `terminal/output`). Pixie runs the process with
// piped stdio (no interactive PTY in v1) and streams its output into the
// linked tool card as partial `ToolEventKind::Update` snapshots.
// ---------------------------------------------------------------------------

/// One tool-card link to a terminal. `child_session` is set when the linked
/// tool call belongs to a subagent session rather than the main transcript.
#[derive(Debug, Clone)]
pub struct AcpTerminalLink {
    pub tool_call_id: String,
    /// Child (subagent) session the tool call belongs to, if any.
    pub child_session: Option<String>,
}

/// Terminal exit status: (exit code, signal name). Both None when the
/// process terminated without a usable status.
pub type TerminalExit = (Option<u64>, Option<String>);

/// A process spawned on behalf of the agent via `terminal/create`. All state
/// is Arc'd: the turn reader answers the agent's `terminal/*` requests, a
/// per-turn pump task in `lib.rs` streams new output to the UI, and drain
/// tasks collect stdout/stderr into the bounded buffer.
#[derive(Clone)]
pub struct AcpTerminal {
    pub pid: Option<u32>,
    /// Accumulated stdout+stderr, truncated from the front to honor the
    /// agent's `outputByteLimit` (default 64 KiB).
    pub output: Arc<StdMutex<String>>,
    pub byte_limit: usize,
    /// Set once the process exits: (exitCode, signal).
    pub exit: Arc<StdMutex<Option<TerminalExit>>>,
    /// Tool cards rendering this terminal (learned from `terminal` content
    /// blocks on the agent's tool_call / tool_call_update).
    pub links: Arc<StdMutex<Vec<AcpTerminalLink>>>,
}

/// Session-scoped terminal registry. Lives on `AcpSession`, cloned into every
/// `AcpTurnCtx`, so a terminal created during one turn can be read or released
/// during a later one (background commands outlive their turn).
pub type AcpTerminalMap = Arc<StdMutex<HashMap<String, AcpTerminal>>>;

/// Default retained output when the agent omits `outputByteLimit`.
const DEFAULT_TERMINAL_BYTE_LIMIT: usize = 64 * 1024;

/// Signal name for the common termination causes (exit-status reporting).
#[cfg(unix)]
fn signal_name(sig: i32) -> String {
    match sig {
        1 => "SIGHUP".into(),
        2 => "SIGINT".into(),
        3 => "SIGQUIT".into(),
        6 => "SIGABRT".into(),
        9 => "SIGKILL".into(),
        13 => "SIGPIPE".into(),
        15 => "SIGTERM".into(),
        n => format!("signal {n}"),
    }
}

/// Hard-kill a process by pid (used by `terminal/kill`; the reaper task owns
/// the `Child`, so the handle itself is not reachable).
fn kill_pid(pid: u32) {
    #[cfg(unix)]
    unsafe {
        libc::kill(pid as i32, libc::SIGKILL);
    }
    #[cfg(not(unix))]
    {
        let _ = std::process::Command::new("taskkill")
            .args(["/PID", &pid.to_string(), "/T", "/F"])
            .spawn();
    }
}

/// Append `chunk` to the terminal buffer, truncating from the front once the
/// agent's byte limit is exceeded (the spec's truncation contract).
fn push_terminal_output(term: &AcpTerminal, chunk: &str) {
    if chunk.is_empty() {
        return;
    }
    if let Ok(mut buf) = term.output.lock() {
        buf.push_str(chunk);
        let limit = term.byte_limit;
        if buf.len() > limit {
            // Truncate at a char boundary so the buffer stays valid UTF-8.
            let cut = buf.len() - limit;
            let start = buf
                .char_indices()
                .map(|(i, _)| i)
                .find(|&i| i >= cut)
                .unwrap_or(buf.len());
            buf.drain(..start);
        }
    }
}

/// Terminal output snapshot for UI emission / terminal/output responses.
pub fn terminal_snapshot(term: &AcpTerminal, cap: usize) -> String {
    term.output
        .lock()
        .map(|buf| truncate_text(&buf, cap))
        .unwrap_or_default()
}

/// `terminal/create` — spawn the agent-requested process, register it, and
/// start the drain/reaper tasks. Responds with the new terminalId.
async fn handle_terminal_create(ctx: &AcpTurnCtx, req_id: i64, envelope: &IncomingEnvelope) {
    let params = envelope.params.clone().unwrap_or(Value::Null);
    let Some(command) = params.get("command").and_then(Value::as_str) else {
        let _ = respond_error(ctx, req_id, "terminal/create requires a command").await;
        return;
    };
    let args: Vec<String> = params
        .get("args")
        .and_then(Value::as_array)
        .map(|a| {
            a.iter()
                .filter_map(Value::as_str)
                .map(str::to_string)
                .collect()
        })
        .unwrap_or_default();
    let byte_limit = params
        .get("outputByteLimit")
        .and_then(Value::as_u64)
        .map(|v| v as usize)
        .unwrap_or(DEFAULT_TERMINAL_BYTE_LIMIT)
        .max(1024);

    let mut cmd = tokio::process::Command::new(command);
    cmd.args(&args)
        .stdin(std::process::Stdio::null())
        .stdout(std::process::Stdio::piped())
        .stderr(std::process::Stdio::piped());
    if let Some(cwd) = params.get("cwd").and_then(Value::as_str) {
        if !cwd.is_empty() {
            cmd.current_dir(cwd);
        }
    } else if let Some(dir) = &ctx.launch_cwd {
        cmd.current_dir(dir);
    }
    if let Some(env) = params.get("env").and_then(Value::as_array) {
        for var in env {
            let name = var.get("name").and_then(Value::as_str).unwrap_or_default();
            let value = var.get("value").and_then(Value::as_str).unwrap_or_default();
            if !name.is_empty() {
                cmd.env(name, value);
            }
        }
    }

    let spawned = cmd
        .spawn()
        .with_context(|| format!("terminal/create failed to spawn `{command}`"));
    let mut child = match spawned {
        Ok(c) => c,
        Err(e) => {
            log::warn!("[acp] {}: terminal/create spawn error: {e}", ctx.engine_id);
            let _ = respond_error(ctx, req_id, &format!("failed to spawn: {e}")).await;
            return;
        }
    };
    let pid = child.id();
    log::info!(
        "[acp] {}: terminal/create `{command}` pid={pid:?}",
        ctx.engine_id
    );

    let stdout = child.stdout.take();
    let stderr = child.stderr.take();
    let term = AcpTerminal {
        pid,
        output: Arc::new(StdMutex::new(String::new())),
        byte_limit,
        exit: Arc::new(StdMutex::new(None)),
        links: Arc::new(StdMutex::new(Vec::new())),
    };

    // Drain tasks: append chunks to the bounded buffer as they arrive.
    let streams: Vec<Box<dyn tokio::io::AsyncRead + Unpin + Send>> = [
        stdout.map(|s| Box::new(s) as Box<dyn tokio::io::AsyncRead + Unpin + Send>),
        stderr.map(|s| Box::new(s) as Box<dyn tokio::io::AsyncRead + Unpin + Send>),
    ]
    .into_iter()
    .flatten()
    .collect();
    for mut reader in streams {
        let term = term.clone();
        tokio::spawn(async move {
            let mut buf = [0u8; 8192];
            use tokio::io::AsyncReadExt;
            loop {
                match reader.read(&mut buf).await {
                    Ok(0) | Err(_) => break,
                    Ok(n) => {
                        let chunk = String::from_utf8_lossy(&buf[..n]).into_owned();
                        push_terminal_output(&term, &chunk);
                    }
                }
            }
        });
    }

    // Reaper task: owns the Child, records the exit status when it lands.
    {
        let exit = Arc::clone(&term.exit);
        tokio::spawn(async move {
            let status = child.wait().await.ok();
            let recorded: Option<(Option<u64>, Option<String>)> = status.and_then(|s| {
                #[cfg(unix)]
                {
                    use std::os::unix::process::ExitStatusExt;
                    if let Some(sig) = s.signal() {
                        return Some((None, Some(signal_name(sig))));
                    }
                    s.code().map(|c| (Some(c as u64), None))
                }
                #[cfg(not(unix))]
                {
                    s.code().map(|c| (Some(c as u64), None))
                }
            });
            if let Ok(mut slot) = exit.lock() {
                *slot = Some(recorded.unwrap_or((None, None)));
            }
        });
    }

    let terminal_id = uuid::Uuid::new_v4().to_string();
    if let Ok(mut map) = ctx.terminals.lock() {
        map.insert(terminal_id.clone(), term);
    }
    let _ = ctx
        .respond(req_id, json!({"terminalId": terminal_id}))
        .await;
}

/// `terminal/output` — respond with the accumulated output and exit status.
async fn handle_terminal_output(ctx: &AcpTurnCtx, req_id: i64, envelope: &IncomingEnvelope) {
    let params = envelope.params.as_ref();
    let terminal_id = params
        .and_then(|p| p.get("terminalId"))
        .and_then(Value::as_str)
        .unwrap_or_default();
    let Some(term) = lookup_terminal(ctx, terminal_id) else {
        let _ = respond_error(ctx, req_id, "unknown terminalId").await;
        return;
    };
    let output = terminal_snapshot(&term, term.byte_limit);
    let exit = term
        .exit
        .lock()
        .ok()
        .and_then(|s| s.as_ref().cloned())
        .map(|(code, sig)| json!({"exitCode": code, "signal": sig}));
    let _ = ctx
        .respond(
            req_id,
            json!({"output": output, "truncated": false, "exitStatus": exit}),
        )
        .await;
}

/// `terminal/wait_for_exit` — the response must not block the turn reader
/// (permission requests and other notifications still flow), so a task waits
/// for the reaper to land the status and answers asynchronously.
fn handle_terminal_wait(ctx: &AcpTurnCtx, req_id: i64, envelope: &IncomingEnvelope) {
    let params = envelope.params.as_ref();
    let terminal_id = params
        .and_then(|p| p.get("terminalId"))
        .and_then(Value::as_str)
        .unwrap_or_default();
    let Some(term) = lookup_terminal(ctx, terminal_id) else {
        let ctx = ctx.clone();
        tokio::spawn(async move {
            let _ = ctx
                .respond(
                    req_id,
                    json!({"exitCode": None::<u64>, "signal": None::<String>}),
                )
                .await;
        });
        return;
    };
    let exit = Arc::clone(&term.exit);
    let ctx = ctx.clone();
    tokio::spawn(async move {
        loop {
            let landed = exit.lock().ok().and_then(|s| s.as_ref().cloned());
            if let Some((code, sig)) = landed {
                let _ = ctx
                    .respond(req_id, json!({"exitCode": code, "signal": sig}))
                    .await;
                return;
            }
            tokio::time::sleep(Duration::from_millis(100)).await;
        }
    });
}

/// `terminal/kill` — hard-kill the process (the reaper records the status).
async fn handle_terminal_kill(ctx: &AcpTurnCtx, req_id: i64, envelope: &IncomingEnvelope) {
    let params = envelope.params.as_ref();
    let terminal_id = params
        .and_then(|p| p.get("terminalId"))
        .and_then(Value::as_str)
        .unwrap_or_default();
    let Some(term) = lookup_terminal(ctx, terminal_id) else {
        let _ = respond_error(ctx, req_id, "unknown terminalId").await;
        return;
    };
    if let Some(pid) = term.pid {
        kill_pid(pid);
    }
    let _ = ctx.respond(req_id, json!({})).await;
}

/// `terminal/release` — forget the terminal. A still-running process is
/// killed: the spec frames release as freeing the terminal's resources.
async fn handle_terminal_release(ctx: &AcpTurnCtx, req_id: i64, envelope: &IncomingEnvelope) {
    let params = envelope.params.as_ref();
    let terminal_id = params
        .and_then(|p| p.get("terminalId"))
        .and_then(Value::as_str)
        .unwrap_or_default();
    let removed = ctx
        .terminals
        .lock()
        .ok()
        .and_then(|mut map| map.remove(terminal_id));
    if let Some(term) = &removed {
        if let (Some(pid), Ok(exit)) = (term.pid, term.exit.lock()) {
            if exit.is_none() {
                kill_pid(pid);
            }
        }
    }
    let _ = ctx.respond(req_id, json!({})).await;
}

fn lookup_terminal(ctx: &AcpTurnCtx, terminal_id: &str) -> Option<AcpTerminal> {
    ctx.terminals.lock().ok()?.get(terminal_id).cloned()
}

/// Answer an agent request with a JSON-RPC error (does not end the turn —
/// the agent decides how to proceed).
async fn respond_error(ctx: &AcpTurnCtx, req_id: i64, message: &str) -> Result<()> {
    let err =
        json!({"jsonrpc": "2.0", "id": req_id, "error": {"code": -32000, "message": message}});
    let line = serde_json::to_string(&err)?;
    ctx.write_line_raw(&line).await
}

/// Scan a session/update `tool_call` / `tool_call_update` for `terminal`
/// content blocks and remember which tool card renders each terminal. The
/// pump task in `lib.rs` uses these links to stream live output into the UI.
fn record_terminal_links(
    ctx: &AcpTurnCtx,
    envelope: &IncomingEnvelope,
    child_session: Option<&str>,
) {
    let Some(blocks) = envelope
        .params
        .as_ref()
        .and_then(|p| p.get("update"))
        .and_then(|u| u.get("content"))
        .and_then(Value::as_array)
        .cloned()
    else {
        return;
    };
    let Some(tool_call_id) = envelope
        .params
        .as_ref()
        .and_then(|p| p.get("update"))
        .and_then(|u| u.get("toolCallId"))
        .and_then(Value::as_str)
        .map(str::to_string)
    else {
        return;
    };
    for block in &blocks {
        if block.get("type").and_then(Value::as_str) == Some("terminal") {
            if let Some(tid) = block.get("terminalId").and_then(Value::as_str) {
                if let Ok(mut map) = ctx.terminals.lock() {
                    if let Some(term) = map.get_mut(tid) {
                        if let Ok(mut links) = term.links.lock() {
                            if !links.iter().any(|l| l.tool_call_id == tool_call_id) {
                                links.push(AcpTerminalLink {
                                    tool_call_id: tool_call_id.clone(),
                                    child_session: child_session.map(str::to_string),
                                });
                            }
                        }
                    }
                }
            }
        }
    }
}

// ---------------------------------------------------------------------------
// Turn reading — interleaved notifications, responses, and agent requests
// ---------------------------------------------------------------------------

/// The subset of an [`AcpSession`] the turn reader needs. The session is owned
/// by the sessions map while a turn is being read, so the reader borrows this
/// lightweight view (cloned Arcs) instead of the session itself — same trick
/// as `PersistentSession::stdout()`.
#[derive(Clone)]
pub struct AcpTurnCtx {
    pub engine_id: String,
    pub stdout: Arc<Mutex<BufReader<ChildStdout>>>,
    pub stdin: Arc<Mutex<ChildStdin>>,
    pub pending: PendingPermissions,
    /// Shared config-options cache (`session/update` `config_option_update`
    /// pushes replace its contents; the model picker reads the same Arc).
    pub config_options: Arc<StdMutex<Vec<SessionConfigOption>>>,
    /// The agent-owned session id this turn prompts. `session/update`
    /// notifications carrying a DIFFERENT sessionId are child (subagent)
    /// sessions and get routed into the subagent card instead of the main
    /// transcript.
    pub session_id: Option<String>,
    /// Client-managed terminal registry (`terminal/create` etc.). The per-turn
    /// pump task in `lib.rs` streams linked terminals' output to the UI.
    pub terminals: AcpTerminalMap,
    /// Working directory the agent process was launched with — the fallback
    /// cwd for `terminal/create` when the agent omits one.
    pub launch_cwd: Option<PathBuf>,
}

impl AcpTurnCtx {
    async fn write_line_raw(&self, line: &str) -> Result<()> {
        let mut stdin = self.stdin.lock().await;
        stdin.write_all(line.as_bytes()).await?;
        stdin.write_all(b"\n").await?;
        stdin.flush().await?;
        Ok(())
    }

    async fn respond(&self, id: i64, result: Value) -> Result<()> {
        let msg = json!({"jsonrpc": "2.0", "id": id, "result": result});
        let line = serde_json::to_string(&msg)?;
        self.write_line_raw(&line).await
    }

    /// Answer every pending permission request with `cancelled` (spec
    /// requirement when the client cancels a turn).
    pub async fn cancel_pending_permissions(&self) {
        let ids: Vec<i64> = {
            let pending = self.pending.lock().expect("pending poisoned");
            pending.keys().copied().collect()
        };
        for id in ids {
            let _ = self
                .respond(id, json!({"outcome": {"outcome": "cancelled"}}))
                .await;
            self.pending.lock().expect("pending poisoned").remove(&id);
        }
    }

    /// Auto-approve a pending permission request with the stored allow-ish
    /// option (`allow_once` semantics — one tool call, never persisted).
    /// Headless turns (scheduled tasks / loop iterations) have no UI to answer
    /// with; silently answering keeps them unattended. A no-longer-pending id
    /// (already cancelled by a stop) is a no-op.
    pub async fn respond_allow(&self, request_id: i64) {
        let choice = {
            let mut pending = self.pending.lock().expect("pending poisoned");
            pending.remove(&request_id)
        };
        let Some(choice) = choice else {
            return;
        };
        log::info!("[acp] auto-allowing permission request {request_id} (headless)");
        let _ = self
            .respond(
                request_id,
                json!({"outcome": {"outcome": "selected", "optionId": choice.allow_option_id}}),
            )
            .await;
    }
}

impl AcpSession {
    /// Snapshot the turn-reading view of this session.
    pub fn turn_ctx(&self) -> AcpTurnCtx {
        AcpTurnCtx {
            engine_id: self.engine_id.clone(),
            stdout: Arc::clone(&self.stdout),
            stdin: Arc::clone(&self.stdin),
            pending: Arc::clone(&self.pending),
            config_options: Arc::clone(&self.config_options),
            session_id: self.acp_session_id.clone(),
            terminals: Arc::clone(&self.terminals),
            launch_cwd: self.launch_cwd.clone(),
        }
    }
}

/// Read one ACP turn: consumes stdout until the `session/prompt` response for
/// `prompt_id` arrives, forwarding `session/update` notifications as
/// [`NormalizedEvent`]s and answering/discharging agent->client requests.
///
/// Structure mirrors `read_persistent_turn` (heartbeat timeout, stop polling,
/// activity refresh) but the terminal condition is the prompt *response*
/// rather than a `result` line, and the prompt response's `stopReason`
/// classifies the outcome:
/// - `end_turn` / `max_tokens` / `max_turn_requests` / `refusal` → Done
///   (refusal text is surfaced via the final text, not an error — the turn
///   did complete)
/// - `cancelled` → Stopped
/// - prompt response carrying a JSON-RPC error → Errored
pub async fn read_acp_turn<F, S, A>(
    ctx: &AcpTurnCtx,
    prompt_id: i64,
    mut on_events: F,
    is_stopped: S,
    mut on_activity: A,
) -> TurnOutcome
where
    F: FnMut(&[NormalizedEvent]),
    S: Fn() -> bool,
    A: FnMut(),
{
    let mut guard = ctx.stdout.lock().await;
    let mut state = TurnState::new();
    let mut consecutive_heartbeat_timeouts = 0usize;
    let engine_id = ctx.engine_id.clone();

    loop {
        if is_stopped() {
            return TurnOutcome::Stopped {
                partial: std::mem::take(&mut state.final_text),
            };
        }

        let mut line = String::new();
        // No wall-clock ceiling on the turn itself — long tasks may legitimately
        // run for hours; only the consecutive-silence detector (below) decides
        // a process is wedged.
        let read_result =
            tokio::time::timeout(READ_HEARTBEAT_TIMEOUT, guard.read_line(&mut line)).await;
        match read_result {
            Err(_) => {
                consecutive_heartbeat_timeouts += 1;
                if consecutive_heartbeat_timeouts >= MAX_HEARTBEAT_TIMEOUTS {
                    log::error!("[acp] {engine_id}: stdout stalled for {consecutive_heartbeat_timeouts} heartbeats; treating as crash");
                    return TurnOutcome::Crashed {
                        partial: std::mem::take(&mut state.final_text),
                        reason:
                            "agent produced no output for an extended period (process appears hung)"
                                .into(),
                    };
                }
                continue;
            }
            Ok(Ok(0)) => {
                return TurnOutcome::Crashed {
                    partial: std::mem::take(&mut state.final_text),
                    reason: "ACP agent stdout closed unexpectedly (EOF)".into(),
                };
            }
            Ok(Ok(_)) => {
                consecutive_heartbeat_timeouts = 0;
                on_activity();
            }
            Ok(Err(e)) => {
                return TurnOutcome::Crashed {
                    partial: std::mem::take(&mut state.final_text),
                    reason: format!("error reading ACP agent stdout: {e}"),
                };
            }
        }

        let trimmed = line.trim();
        if trimmed.is_empty() {
            continue;
        }
        let envelope: IncomingEnvelope = match serde_json::from_str(trimmed) {
            Ok(e) => e,
            Err(e) => {
                log::warn!("[acp] {engine_id}: dropping malformed line: {e} ({line:.200})");
                continue;
            }
        };

        // --- Agent -> client request (must be answered) ---
        if let (Some(req_id), Some(method)) = (
            envelope.id.as_ref().and_then(as_i64),
            envelope.method.as_deref(),
        ) {
            match method {
                "session/request_permission" => {
                    handle_permission_request(ctx, req_id, &envelope, &mut on_events);
                }
                "terminal/create" => {
                    handle_terminal_create(ctx, req_id, &envelope).await;
                }
                "terminal/output" => {
                    handle_terminal_output(ctx, req_id, &envelope).await;
                }
                "terminal/wait_for_exit" => {
                    handle_terminal_wait(ctx, req_id, &envelope);
                }
                "terminal/kill" => {
                    handle_terminal_kill(ctx, req_id, &envelope).await;
                }
                "terminal/release" => {
                    handle_terminal_release(ctx, req_id, &envelope).await;
                }
                "fs/read_text_file" | "fs/write_text_file" | "elicitation/create" => {
                    // We advertise none of these capabilities, so agents MUST
                    // not call them; answer with a JSON-RPC error so the turn
                    // can continue (a silent drop would deadlock the agent).
                    log::warn!("[acp] {engine_id}: refusing unsupported agent request {method}");
                    let err = json!({"jsonrpc": "2.0", "id": req_id, "error": {"code": -32601, "message": format!("Pixie does not support {method}")}});
                    if let Ok(l) = serde_json::to_string(&err) {
                        let _ = ctx.write_line_raw(&l).await;
                    }
                }
                _ => {
                    log::warn!("[acp] {engine_id}: unknown agent request {method}; erroring");
                    let err = json!({"jsonrpc": "2.0", "id": req_id, "error": {"code": -32601, "message": format!("unknown method {method}")}});
                    if let Ok(l) = serde_json::to_string(&err) {
                        let _ = ctx.write_line_raw(&l).await;
                    }
                }
            }
            continue;
        }

        // --- Response to one of OUR requests ---
        if envelope.method.is_none() && envelope.id.is_some() {
            let id = envelope.id.as_ref().and_then(as_i64);
            if id == Some(prompt_id) {
                // Terminal: this response ends the turn.
                if let Some(err) = envelope.error {
                    state.errored = true;
                    state.error_message = Some(format!("ACP prompt failed: {err}"));
                } else {
                    let reason = envelope
                        .result
                        .as_ref()
                        .and_then(|r| r.get("stopReason"))
                        .and_then(Value::as_str)
                        .unwrap_or("end_turn")
                        .to_string();
                    state.stop_reason = Some(reason.clone());
                    if reason == "cancelled" {
                        return TurnOutcome::Stopped {
                            partial: std::mem::take(&mut state.final_text),
                        };
                    }
                }
                break;
            }
            // Response to session/new or something else in-turn — ignore.
            continue;
        }

        // --- Notification ---
        if envelope.method.as_deref() == Some("session/update") {
            // A `session/update` carrying a DIFFERENT sessionId than the one
            // this turn prompted belongs to a CHILD (subagent) session — the
            // RFD delivers child events on the parent's connection. Route
            // them into the subagent card instead of the main transcript.
            let update_sid = envelope
                .params
                .as_ref()
                .and_then(|p| p.get("sessionId"))
                .and_then(Value::as_str);
            let is_child = match (update_sid, ctx.session_id.as_deref()) {
                (Some(u), Some(own)) => u != own,
                _ => false,
            };
            let child_sid = if is_child {
                update_sid.map(str::to_string)
            } else {
                None
            };

            // Remember which tool card renders each client-managed terminal
            // (its `terminal` content block) — the pump task in `lib.rs`
            // streams the terminal's live output through these links.
            record_terminal_links(ctx, &envelope, child_sid.as_deref());

            // A `config_option_update` push (e.g. the agent switched models)
            // refreshes the shared cache the model picker reads. No normalized
            // event exists for it — the cache IS the consumption. Only the
            // OWN session's pushes apply (child config is the agent's business).
            if !is_child {
                if let Some(update) = envelope.params.as_ref().and_then(|p| p.get("update")) {
                    if update.get("sessionUpdate").and_then(Value::as_str)
                        == Some("config_option_update")
                    {
                        if let Ok(new_options) = serde_json::from_value::<Vec<SessionConfigOption>>(
                            update.get("configOptions").cloned().unwrap_or(Value::Null),
                        ) {
                            if let Ok(mut cached) = ctx.config_options.lock() {
                                *cached = new_options;
                            }
                        }
                        continue;
                    }
                }
            }
            if let Some(mut events) = map_session_update(&envelope) {
                fill_terminal_results(ctx, &mut events);
                if let Some(sid) = &child_sid {
                    // Child-session events are wrapped: the UI renders them in
                    // the subagent's card, and they must NOT accumulate into
                    // this turn's final text.
                    let wrapped: Vec<NormalizedEvent> = events
                        .into_iter()
                        .map(|e| NormalizedEvent::SubagentChildEvent {
                            session_id: sid.clone(),
                            event: Box::new(e),
                        })
                        .collect();
                    on_events(&wrapped);
                } else {
                    // The prompt response carries only a stopReason — no final
                    // text payload — so the turn's final text is the accumulation
                    // of streamed `agent_message_chunk` deltas.
                    for evt in &events {
                        if let NormalizedEvent::TextDelta { text, .. } = evt {
                            state.final_text.push_str(text);
                        }
                    }
                    on_events(&events);
                }
            }
            continue;
        }
        // Other notifications (logging etc.) — ignore.
    }

    if state.errored {
        TurnOutcome::Errored(
            state
                .error_message
                .unwrap_or_else(|| "ACP turn failed".into()),
        )
    } else {
        TurnOutcome::Done(state.final_text)
    }
}

/// Parse a `session/request_permission` request, forward it to the frontend
/// as `NormalizedEvent::PermissionRequest`, and remember the option ids so
/// `respond_permission` can answer later.
fn handle_permission_request<F>(
    ctx: &AcpTurnCtx,
    req_id: i64,
    envelope: &IncomingEnvelope,
    on_events: &mut F,
) where
    F: FnMut(&[NormalizedEvent]),
{
    let Some(params) = envelope.params.as_ref() else {
        return;
    };
    let tool_call = params.get("toolCall").cloned().unwrap_or(Value::Null);
    let tool_name = tool_call
        .get("name")
        .and_then(Value::as_str)
        .map(str::to_string)
        .or_else(|| {
            // Fall back to the title's first word when no programmatic name.
            tool_call
                .get("title")
                .and_then(Value::as_str)
                .and_then(|t| t.split_whitespace().next())
                .map(str::to_string)
        })
        .unwrap_or_else(|| "tool".to_string());

    // Pick the first allow-ish and reject-ish option by kind.
    let options = params
        .get("options")
        .and_then(Value::as_array)
        .cloned()
        .unwrap_or_default();
    let mut allow_id: Option<String> = None;
    let mut reject_id: Option<String> = None;
    for opt in &options {
        let kind = opt.get("kind").and_then(Value::as_str).unwrap_or("");
        let id = opt.get("optionId").and_then(Value::as_str).unwrap_or("");
        if id.is_empty() {
            continue;
        }
        if kind == "allow_once" || kind == "allow_always" {
            allow_id.get_or_insert(id.to_string());
        } else if kind == "reject_once" || kind == "reject_always" {
            reject_id.get_or_insert(id.to_string());
        }
    }
    // Degenerate option lists: fall back to first option = allow, or synthesize.
    let allow_id = allow_id.unwrap_or_else(|| {
        options
            .first()
            .and_then(|o| o.get("optionId"))
            .and_then(Value::as_str)
            .unwrap_or("allow")
            .to_string()
    });
    let reject_id = reject_id.unwrap_or_else(|| "reject".to_string());

    let input = tool_call.get("rawInput").cloned().unwrap_or(Value::Null);

    ctx.pending.lock().expect("pending poisoned").insert(
        req_id,
        PendingPermission {
            allow_option_id: allow_id,
            reject_option_id: reject_id,
        },
    );
    on_events(&[NormalizedEvent::PermissionRequest {
        id: req_id.to_string(),
        tool_name,
        input,
    }]);
}

/// Backfill a tool Result with its linked terminal's output when the agent
/// sent no content of its own (the client ran the command, so Pixie is the
/// only one holding the output).
fn fill_terminal_results(ctx: &AcpTurnCtx, events: &mut [NormalizedEvent]) {
    for evt in events {
        let NormalizedEvent::Tool(te) = evt else {
            continue;
        };
        let ToolEventKind::Result {
            content: None,
            is_error,
        } = &te.kind
        else {
            continue;
        };
        let term = ctx.terminals.lock().ok().and_then(|map| {
            map.values()
                .find(|t| {
                    t.links
                        .lock()
                        .map(|l| l.iter().any(|link| link.tool_call_id == te.id))
                        .unwrap_or(false)
                })
                .cloned()
        });
        let Some(term) = term else { continue };
        let snap = terminal_snapshot(&term, MAX_TOOL_RESULT_CHARS);
        if !snap.is_empty() {
            te.kind = ToolEventKind::Result {
                content: Some(snap),
                is_error: *is_error,
            };
        }
    }
}

/// Convert a `session/update` notification into normalized events.
fn map_session_update(envelope: &IncomingEnvelope) -> Option<Vec<NormalizedEvent>> {
    let update = envelope.params.as_ref()?.get("update")?;
    let kind = update.get("sessionUpdate").and_then(Value::as_str)?;

    match kind {
        "agent_message_chunk" => {
            let text = content_block_text(update.get("content"))?;
            (!text.is_empty()).then(|| {
                vec![NormalizedEvent::TextDelta {
                    text,
                    event_type: "delta",
                }]
            })
        }
        "agent_thought_chunk" => {
            let text = content_block_text(update.get("content"))?;
            (!text.is_empty()).then(|| vec![NormalizedEvent::ThinkingText { content: text }])
        }
        "tool_call" => {
            let id = update
                .get("toolCallId")
                .and_then(Value::as_str)?
                .to_string();
            // ACP agents may omit `name` and only send a human-readable
            // `title` (or a `kind`). Prefer the programmatic name, fall back
            // to title/kind so the UI never renders a bare "tool".
            let name = update
                .get("name")
                .and_then(Value::as_str)
                .filter(|s| !s.is_empty())
                .map(str::to_string)
                .or_else(|| {
                    update
                        .get("title")
                        .and_then(Value::as_str)
                        .filter(|s| !s.is_empty())
                        .map(str::to_string)
                })
                .or_else(|| {
                    update
                        .get("kind")
                        .and_then(Value::as_str)
                        .filter(|s| !s.is_empty())
                        .map(str::to_string)
                });
            let input = update.get("rawInput").cloned().filter(|v| !v.is_null());
            let input_str = input.as_ref().map(|v| v.to_string());
            Some(vec![NormalizedEvent::Tool(ToolEvent {
                id,
                kind: ToolEventKind::Start {
                    name,
                    input: input_str,
                },
            })])
        }
        "tool_call_update" => {
            let id = update
                .get("toolCallId")
                .and_then(Value::as_str)?
                .to_string();
            let status = update.get("status").and_then(Value::as_str);
            match status {
                Some("completed") | Some("failed") => {
                    let is_error = status == Some("failed");
                    let content = tool_result_text(update.get("content"));
                    Some(vec![NormalizedEvent::Tool(ToolEvent {
                        id,
                        kind: ToolEventKind::Result { content, is_error },
                    })])
                }
                // `pending` means the input is still streaming or we are
                // awaiting approval — nothing to show yet.
                Some("pending") => None,
                // `in_progress` (or a status-less content patch, e.g. a
                // client-managed terminal's live output reference): surface
                // the partial output as a REPLACEMENT snapshot.
                _ => {
                    let content = tool_result_text(update.get("content"))?;
                    Some(vec![NormalizedEvent::Tool(ToolEvent {
                        id,
                        kind: ToolEventKind::Update { content },
                    })])
                }
            }
        }
        "usage_update" => {
            let used = update.get("used").and_then(Value::as_u64).unwrap_or(0);
            let size = update.get("size").and_then(Value::as_u64).unwrap_or(0);
            let cost = update.pointer("/cost/amount").and_then(Value::as_f64);
            Some(vec![NormalizedEvent::Usage(UsageInfo {
                kind: "turn",
                input_tokens: 0,
                output_tokens: 0,
                cache_read_tokens: 0,
                cache_creation_tokens: 0,
                context_tokens: Some(used),
                cost_usd: cost,
                duration_ms: None,
                num_turns: None,
                // Report the window size through the model slot so the
                // frontend's occupancy indicator can compute used/size.
                model: Some(format!("__ctx__{used}/{size}")),
                stop_reason: None,
            })])
        }
        "compaction_update" => {
            // ID-addressed lifecycle (gated on the session.compaction
            // capability): in_progress -> terminal status, with the retained
            // summary riding on the terminal update (claude-code-acp).
            let status = update
                .get("status")
                .and_then(Value::as_str)
                .unwrap_or("")
                .to_string();
            if !matches!(
                status.as_str(),
                "in_progress" | "completed" | "failed" | "cancelled"
            ) {
                return None;
            }
            let summary = update
                .get("summary")
                .and_then(Value::as_array)
                .and_then(|blocks| content_block_text(Some(&Value::Array(blocks.clone()))));
            let error = update
                .get("error")
                .and_then(Value::as_str)
                .map(str::to_string);
            Some(vec![NormalizedEvent::CompactionStatus {
                status,
                summary,
                error,
            }])
        }
        "plan" => {
            // The agent's execution plan: a COMPLETE entry list each update
            // (the client replaces the whole plan per the spec).
            let entries = update.get("entries")?.as_array()?;
            let mapped: Vec<PlanEntryEvent> = entries
                .iter()
                .filter_map(|e| {
                    let content = e.get("content").and_then(Value::as_str)?.to_string();
                    let status = e
                        .get("status")
                        .and_then(Value::as_str)
                        .unwrap_or("pending")
                        .to_string();
                    let priority = e
                        .get("priority")
                        .and_then(Value::as_str)
                        .map(str::to_string);
                    Some(PlanEntryEvent {
                        content,
                        status,
                        priority,
                    })
                })
                .collect();
            Some(vec![NormalizedEvent::PlanUpdate { entries: mapped }])
        }
        "notice" => {
            // Live fire-and-forget agent message (gated on the
            // session.notices capability).
            let severity = update
                .get("severity")
                .and_then(Value::as_str)
                .unwrap_or("info")
                .to_string();
            let title = update.get("title").and_then(Value::as_str)?.to_string();
            let description = update
                .get("description")
                .and_then(Value::as_str)
                .map(str::to_string);
            Some(vec![NormalizedEvent::Notice {
                severity,
                title,
                description,
            }])
        }
        "subagent_update" => {
            // RFD-1992 association patch on the PARENT session: title /
            // description / state for a child session the parent owns.
            // Fields are patch-semantics (None = unchanged); the frontend
            // merges per field, keyed by the child session id.
            let session_id = update.get("sessionId").and_then(Value::as_str)?.to_string();
            let title = update
                .get("title")
                .and_then(Value::as_str)
                .map(str::to_string);
            let description = update
                .get("description")
                .and_then(Value::as_str)
                .map(str::to_string);
            let state = update
                .pointer("/state/state")
                .and_then(Value::as_str)
                .map(str::to_string);
            let state_detail = update
                .pointer("/state/error")
                .or_else(|| update.pointer("/state/stopReason"))
                .and_then(Value::as_str)
                .map(str::to_string);
            Some(vec![NormalizedEvent::SubagentUpdate {
                session_id,
                title,
                description,
                state,
                state_detail,
            }])
        }
        "user_message_chunk"
        | "available_commands_update"
        | "current_mode_update"
        | "session_info_update"
        | "compaction_summary_chunk"
        | "session_message"
        | "session_message_chunk" => {
            // Not modeled by Pixie's normalized event set. `session_message`
            // / `session_message_chunk` (inter-session messages of the
            // subagents RFD) are covered by the child-session event routing
            // and the Task tool result; `compaction_summary_chunk` streams
            // the summary that the terminal `compaction_update` carries in
            // full. Left explicit rather than silently dropped.
            None
        }
        _ => None,
    }
}

/// Concatenate text out of an ACP content block (single or array form).
fn content_block_text(block: Option<&Value>) -> Option<String> {
    let block = block?;
    match block {
        Value::Array(blocks) => {
            let mut buf = String::new();
            for b in blocks {
                if let Some(t) = b.get("text").and_then(Value::as_str) {
                    if !buf.is_empty() {
                        buf.push('\n');
                    }
                    buf.push_str(t);
                }
            }
            Some(buf)
        }
        Value::Object(_) => block
            .get("text")
            .and_then(Value::as_str)
            .map(str::to_string),
        _ => None,
    }
}

/// Flatten a tool call's content array into a single result string for the
/// tool-result UI. `diff` content renders as a short "modified <path>" note
/// (Pixie's DiffViewer consumes diffs from dedicated events, not tool results).
fn tool_result_text(content: Option<&Value>) -> Option<String> {
    let blocks = match content {
        Some(Value::Array(a)) => a.clone(),
        Some(b @ Value::Object(_)) => vec![b.clone()],
        _ => return None,
    };
    let mut buf = String::new();
    for block in &blocks {
        let btype = block.get("type").and_then(Value::as_str).unwrap_or("");
        match btype {
            "content" => {
                if let Some(t) = block.pointer("/content/text").and_then(Value::as_str) {
                    if !buf.is_empty() {
                        buf.push('\n');
                    }
                    buf.push_str(t);
                }
            }
            "diff" => {
                let path = block.get("path").and_then(Value::as_str).unwrap_or("");
                if !buf.is_empty() {
                    buf.push('\n');
                }
                buf.push_str(&format!("[diff] {path}"));
            }
            _ => {}
        }
    }
    if buf.is_empty() {
        None
    } else {
        Some(truncate_text(&buf, MAX_TOOL_RESULT_CHARS))
    }
}

/// conversation_id -> live ACP agent subprocess (persistent-style, mirrors
/// `SessionMap`). Lives in AppState; reaped by the same idle-reaper loop.
pub type AcpSessionMap = Arc<Mutex<HashMap<String, AcpSession>>>;

pub fn init_acp_session_map() -> AcpSessionMap {
    Arc::new(Mutex::new(HashMap::new()))
}

// ---------------------------------------------------------------------------
// Remote catalog — the official ACP registry (cdn.agentclientprotocol.com)
// ---------------------------------------------------------------------------

/// One agent entry fetched from the official registry. `npx` / `uvx` entries
/// are directly launchable (the package manager resolves the binary); `binary`
/// entries are surfaced as informational (users install them out of band).
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AcpCatalogEntry {
    /// Registry id (used as the engine key: "acp/<id>").
    pub id: String,
    pub name: String,
    #[serde(default)]
    pub description: String,
    #[serde(default)]
    pub version: String,
    #[serde(default)]
    pub icon: String,
    /// Normalized launch: command program + args.
    pub command: String,
    pub args: Vec<String>,
    /// true when Pixie can launch it directly (npx/uvx resolved from PATH).
    pub launchable: bool,
}

/// URL of the official, hourly-updated registry index. JetBrains/Zed consume
/// the same feed; agents there are CI-verified to return valid authMethods.
pub const REGISTRY_CATALOG_URL: &str =
    "https://cdn.agentclientprotocol.com/registry/v1/latest/registry.json";

/// Download and normalize the official registry into launch configs.
/// Network-free failure returns an empty list (caller keeps the last one).
pub async fn fetch_catalog() -> Result<Vec<AcpCatalogEntry>> {
    let body = reqwest::get(REGISTRY_CATALOG_URL)
        .await
        .context("failed to reach the ACP registry")?
        .error_for_status()
        .context("ACP registry returned an error status")?
        .text()
        .await
        .context("failed to read the ACP registry body")?;

    let raw: Value = serde_json::from_str(&body).context("ACP registry returned invalid JSON")?;
    let agents = raw
        .get("agents")
        .and_then(Value::as_array)
        .cloned()
        .unwrap_or_default();

    let mut out = Vec::with_capacity(agents.len());
    for a in agents {
        let id = a
            .get("id")
            .and_then(Value::as_str)
            .unwrap_or_default()
            .to_string();
        if id.is_empty() {
            continue;
        }
        let dist = a.get("distribution").cloned().unwrap_or(Value::Null);
        // npx: {"npx": {"package": "...@1.2.3", "args": [...]}}
        // uvx: {"uvx": {"package": "...", "args": [...]}}
        let (command, args, launchable) =
            if let Some(spec) = dist.get("npx").or_else(|| dist.get("uvx")) {
                let package = spec
                    .get("package")
                    .and_then(Value::as_str)
                    .unwrap_or_default()
                    .to_string();
                if package.is_empty() {
                    continue;
                }
                let mut args: Vec<String> = spec
                    .get("args")
                    .and_then(Value::as_array)
                    .map(|arr| {
                        arr.iter()
                            .filter_map(Value::as_str)
                            .map(str::to_string)
                            .collect()
                    })
                    .unwrap_or_default();
                let runner = if dist.get("npx").is_some() {
                    "npx"
                } else {
                    "uvx"
                };
                args.insert(0, package);
                (runner.to_string(), args, true)
            } else {
                // binary distributions: Pixie doesn't manage downloads; show
                // them greyed-out with a pointer to the agent's own install.
                (String::new(), Vec::new(), false)
            };
        out.push(AcpCatalogEntry {
            name: a
                .get("name")
                .and_then(Value::as_str)
                .map(str::to_string)
                .unwrap_or_else(|| id.clone()),
            id,
            description: a
                .get("description")
                .and_then(Value::as_str)
                .unwrap_or_default()
                .to_string(),
            version: a
                .get("version")
                .and_then(Value::as_str)
                .unwrap_or_default()
                .to_string(),
            icon: a
                .get("icon")
                .and_then(Value::as_str)
                .unwrap_or_default()
                .to_string(),
            command,
            args,
            launchable,
        });
    }
    Ok(out)
}

// ---------------------------------------------------------------------------
// Registry loading + engine plumbing for mod.rs
// ---------------------------------------------------------------------------

static REGISTRY: std::sync::OnceLock<StdMutex<Vec<AcpAgentConfig>>> = std::sync::OnceLock::new();

fn registry() -> &'static StdMutex<Vec<AcpAgentConfig>> {
    REGISTRY.get_or_init(|| StdMutex::new(builtin_acp_agents()))
}

/// Replace the user registry (called at startup with config.json contents).
/// Built-in entries are always (re)added so a user config can't disable them
/// by omission; user entries with the same key override the built-ins' env.
pub fn load_registry(user_entries: Vec<AcpAgentConfig>) {
    let mut reg = registry().lock().expect("acp registry poisoned");
    let mut merged: Vec<AcpAgentConfig> = Vec::new();
    for mut user in user_entries {
        if user.key.is_empty() || user.command.is_empty() {
            continue;
        }
        user.key = user.key.trim().to_string();
        if user.label.is_empty() {
            user.label = user.key.clone();
        }
        // agent_by_key finds the first match, so drop later duplicates — the
        // registry state and the persisted blob otherwise diverge silently.
        if merged.iter().any(|a| a.key == user.key) {
            continue;
        }
        merged.push(user);
    }
    for builtin in builtin_acp_agents() {
        if !merged.iter().any(|a| a.key == builtin.key) {
            merged.push(builtin);
        }
    }
    *reg = merged;
}

/// All configured agents (for check_all_engines / engine enumeration).
pub fn registry_agents() -> Vec<AcpAgentConfig> {
    registry().lock().expect("acp registry poisoned").clone()
}

/// Look up one agent by full engine id ("acp/gemini").
pub fn agent_by_engine_id(engine_id: &str) -> Option<AcpAgentConfig> {
    acp_key_of(engine_id).and_then(agent_by_key)
}

/// Look up one agent by registry key.
pub fn agent_by_key(key: &str) -> Option<AcpAgentConfig> {
    registry()
        .lock()
        .expect("acp registry poisoned")
        .iter()
        .find(|a| a.key == key)
        .cloned()
}

/// Display name for an engine id ("acp/gemini" -> "Gemini CLI").
pub fn display_name_for(engine_id: &str) -> String {
    acp_key_of(engine_id)
        .and_then(agent_by_key)
        .map(|a| a.label)
        .unwrap_or_else(|| engine_id.to_string())
}

// ---------------------------------------------------------------------------
// Availability check + probe
// ---------------------------------------------------------------------------

/// Cheap check: binary exists and runs. Full readiness probing (a real ping
/// turn) reuses the interactive path; the probe child approach used by CLIs
/// doesn't map cleanly onto ACP's handshake, so availability is binary-level
/// and `auth_state` flips to Ready after the first successful session.
pub async fn check_available(config: &AcpAgentConfig) -> super::EngineStatus {
    match shared::find_binary(&[&config.command], &config.label) {
        Ok(path) => {
            let version = None; // ACP has no --version convention; skip.
            EngineStatus::basic(
                &acp_engine_id(&config.key),
                &config.label,
                true,
                version,
                Some(path.to_string_lossy().to_string()),
                None,
            )
        }
        Err(e) => EngineStatus::basic(
            &acp_engine_id(&config.key),
            &config.label,
            false,
            None,
            None,
            Some(e.to_string()),
        ),
    }
}

/// Whole-probe deadline. Every await inside the probe is a pipe read with no
/// intrinsic timeout; an agent that accepts `initialize` but never answers
/// `session/new` (pi-acp vs an old `pi` release, historically) would hang the
/// probe forever and leak the child.
pub const PROBE_TOTAL_TIMEOUT: Duration = Duration::from_secs(60);

/// Spawn the agent, run initialize + session/new + a tiny prompt, and classify
/// the outcome. Real readiness probe for the ACP path.
pub async fn probe_agent(config: AcpAgentConfig, cwd: Option<&str>) -> ProbeOutcome {
    let start = Instant::now();
    log::info!("[probe] acp/{}: starting", config.key);
    // The session lives inside the timed future so a timeout drops it (Drop
    // sends SIGTERM to the direct child). Wrappers like `npm exec` die with
    // that SIGTERM but orphan the real agent, so the timeout path also
    // SIGKILLs the probe's whole process group (every session spawns via
    // `setsid`, so pgid == child pid). Never match processes by command line
    // here: live chat sessions run the exact same command and would die too.
    let probe_pid: Arc<StdMutex<Option<u32>>> = Arc::new(StdMutex::new(None));
    let outcome = match tokio::time::timeout(
        PROBE_TOTAL_TIMEOUT,
        probe_agent_inner(config.clone(), cwd, Arc::clone(&probe_pid)),
    )
    .await
    {
        Ok(outcome) => outcome,
        Err(_) => {
            kill_probe_process_group(&probe_pid);
            ProbeOutcome {
                state: AuthState::Error,
                error: Some(format!(
                    "probe timed out after {}s (agent never completed the ACP handshake)",
                    PROBE_TOTAL_TIMEOUT.as_secs()
                )),
                raw_output: None,
            }
        }
    };
    log::info!(
        "[probe] acp/{}: {:?} after {}ms",
        config.key,
        outcome.state,
        start.elapsed().as_millis()
    );
    outcome
}

/// SIGKILL the probe's process group on timeout. The probe child called
/// `setsid()` before exec (see `detach_from_controlling_terminal`), so it is
/// its own group leader and pgid == its pid; every descendant it spawned
/// (npm wrappers, the real agent) inherited that group. Killing the group
/// therefore reaps orphaned grandchildren without touching other sessions —
/// they run in their own groups. Best-effort: a recycled/absent pgid just
/// errors on `kill` and is ignored.
#[cfg(unix)]
fn kill_probe_process_group(probe_pid: &StdMutex<Option<u32>>) {
    let pid = *probe_pid.lock().expect("probe pid poisoned");
    if let Some(pid) = pid {
        log::warn!("[probe] timeout: killing probe process group {pid}");
        unsafe {
            libc::kill(-(pid as i32), libc::SIGKILL);
        }
    }
}

#[cfg(not(unix))]
fn kill_probe_process_group(_probe_pid: &StdMutex<Option<u32>>) {}

async fn probe_agent_inner(
    config: AcpAgentConfig,
    cwd: Option<&str>,
    probe_pid: Arc<StdMutex<Option<u32>>>,
) -> ProbeOutcome {
    // Record the child pid as soon as it exists so the timeout path can kill
    // the group even while the handshake is still in flight.
    *probe_pid.lock().expect("probe pid poisoned") = None;
    let mut session = match AcpSession::spawn(config.clone(), cwd).await {
        Ok(s) => {
            *probe_pid.lock().expect("probe pid poisoned") = s.pid();
            s
        }
        Err(e) => {
            return ProbeOutcome {
                state: AuthState::Error,
                error: Some(format!("failed to start: {e}")),
                raw_output: None,
            };
        }
    };
    if let Err(e) = session.ensure_session(cwd, None, &[]).await {
        let diagnosis = session.stderr_tail();
        session.kill().await;
        return ProbeOutcome {
            state: AuthState::NotAuthenticated,
            error: Some(format!("session setup failed: {e}. {diagnosis}")),
            raw_output: None,
        };
    }
    let prompt_id = match session.send_message(&config.probe_message, &[]).await {
        Ok(id) => id,
        Err(e) => {
            session.kill().await;
            return ProbeOutcome {
                state: AuthState::Error,
                error: Some(format!("probe send failed: {e}")),
                raw_output: None,
            };
        }
    };
    let ctx = session.turn_ctx();
    let outcome = read_acp_turn(&ctx, prompt_id, |_| {}, || false, || {}).await;
    ctx.cancel_pending_permissions().await;
    session.kill().await;

    match outcome {
        TurnOutcome::Done(_) => ProbeOutcome::ready(),
        TurnOutcome::Errored(msg) => ProbeOutcome::from_message(&msg),
        TurnOutcome::Stopped { .. } => ProbeOutcome::ready(),
        TurnOutcome::Crashed { reason, .. } => ProbeOutcome {
            state: AuthState::Error,
            error: Some(reason),
            raw_output: None,
        },
    }
}

/// Fetch the model list for an ACP agent — the real model picker data, exactly
/// what the CLI itself would offer. Spawns a throwaway session and reads the
/// `configOptions` entry with `category: "model"` (id "model"); falls back to
/// the UNSTABLE `session/options` request when the agent supports it without
/// a session (still one spawn, but no prompt round-trip).
///
/// Returns (value, label) pairs; empty when the agent exposes no model option
/// (callers then show just "Auto").
pub async fn list_models_for_agent(
    config: AcpAgentConfig,
    cwd: Option<&str>,
) -> Vec<(String, String)> {
    let start = Instant::now();
    log::info!("[list_models] acp/{}: probing model options", config.key);
    let mut session = match AcpSession::spawn(config.clone(), cwd).await {
        Ok(s) => s,
        Err(e) => {
            log::warn!("[list_models] acp/{}: spawn failed: {e}", config.key);
            return vec![];
        }
    };

    // Prefer the capability-gated no-session options listing: cheaper (no
    // session/new round-trip) and it works even when sessions are unavailable.
    let model = if session.capabilities.session_options {
        match session.list_session_options(cwd).await {
            Ok(Some(options)) => options
                .into_iter()
                .find(|o| o.category.as_deref() == Some("model") || o.id == "model"),
            Ok(None) => None,
            Err(e) => {
                log::warn!(
                    "[list_models] acp/{}: session/options failed: {e}",
                    config.key
                );
                None
            }
        }
    } else {
        None
    };

    // Fall back to (or first-time) session setup: session/new returns the
    // full configOptions set.
    let model = match model {
        Some(m) => Some(m),
        None => match session.ensure_session(cwd, None, &[]).await {
            Ok(()) => session.model_option(),
            Err(e) => {
                let diagnosis = session.stderr_tail();
                log::warn!(
                    "[list_models] acp/{}: session setup failed: {e}. {diagnosis}",
                    config.key
                );
                session.kill().await;
                return vec![];
            }
        },
    };

    session.kill().await;
    let models: Vec<(String, String)> = model
        .map(|m| {
            m.options
                .iter()
                .map(|c| (value_to_config_string(&c.value), c.name.clone()))
                .collect()
        })
        .unwrap_or_default();
    log::info!(
        "[list_models] acp/{}: {} models after {}ms",
        config.key,
        models.len(),
        start.elapsed().as_millis()
    );
    models
}

/// Canonical string form of a config-option value (the model picker and
/// `set_config_option` both speak plain strings; booleans serialize as
/// "true"/"false").
pub fn value_to_config_string(value: &Value) -> String {
    match value {
        Value::String(s) => s.clone(),
        Value::Bool(b) => b.to_string(),
        other => other.to_string(),
    }
}

// ---------------------------------------------------------------------------
// Tests — wire mapping (no subprocess; pure serde/mapping logic)
// ---------------------------------------------------------------------------

#[cfg(test)]
mod tests {
    use super::*;
    use crate::engine::normalize_engine_id;

    fn envelope(params: Value) -> IncomingEnvelope {
        serde_json::from_value(json!({
            "jsonrpc": "2.0",
            "method": "session/update",
            "params": params,
        }))
        .expect("envelope")
    }

    #[test]
    fn maps_agent_message_chunk_to_text_delta() {
        let env = envelope(json!({"update": {
            "sessionUpdate": "agent_message_chunk",
            "content": {"type": "text", "text": "hello world"},
        }}));
        let events = map_session_update(&env).expect("events");
        assert_eq!(events.len(), 1);
        match &events[0] {
            NormalizedEvent::TextDelta { text, .. } => assert_eq!(text, "hello world"),
            other => panic!("expected TextDelta, got {other:?}"),
        }
    }

    #[test]
    fn maps_thought_chunk_to_thinking_text() {
        let env = envelope(json!({"update": {
            "sessionUpdate": "agent_thought_chunk",
            "content": {"type": "text", "text": "thinking..."},
        }}));
        let events = map_session_update(&env).expect("events");
        match &events[0] {
            NormalizedEvent::ThinkingText { content } => assert_eq!(content, "thinking..."),
            other => panic!("expected ThinkingText, got {other:?}"),
        }
    }

    #[test]
    fn maps_tool_call_to_tool_start() {
        let env = envelope(json!({"update": {
            "sessionUpdate": "tool_call",
            "toolCallId": "call_1",
            "name": "Bash",
            "rawInput": {"command": "ls"},
        }}));
        let events = map_session_update(&env).expect("events");
        match &events[0] {
            NormalizedEvent::Tool(ToolEvent {
                id,
                kind: ToolEventKind::Start { name, input },
            }) => {
                assert_eq!(id, "call_1");
                assert_eq!(name.as_deref(), Some("Bash"));
                let input = input.as_deref().expect("input");
                assert!(input.contains("\"command\""));
            }
            other => panic!("expected Tool Start, got {other:?}"),
        }
    }

    #[test]
    fn maps_tool_call_update_completed_to_result() {
        let env = envelope(json!({"update": {
            "sessionUpdate": "tool_call_update",
            "toolCallId": "call_1",
            "status": "completed",
            "content": [{"type": "content", "content": {"type": "text", "text": "file list"}}],
        }}));
        let events = map_session_update(&env).expect("events");
        match &events[0] {
            NormalizedEvent::Tool(ToolEvent {
                kind: ToolEventKind::Result { content, is_error },
                ..
            }) => {
                assert!(!*is_error);
                assert_eq!(content.as_deref(), Some("file list"));
            }
            other => panic!("expected Tool Result, got {other:?}"),
        }
    }

    #[test]
    fn drops_in_progress_tool_updates() {
        let env = envelope(json!({"update": {
            "sessionUpdate": "tool_call_update",
            "toolCallId": "call_1",
            "status": "in_progress",
        }}));
        assert!(map_session_update(&env).is_none());
    }

    #[test]
    fn maps_failed_tool_update_with_error_flag() {
        let env = envelope(json!({"update": {
            "sessionUpdate": "tool_call_update",
            "toolCallId": "call_2",
            "status": "failed",
        }}));
        let events = map_session_update(&env).expect("events");
        match &events[0] {
            NormalizedEvent::Tool(ToolEvent {
                kind: ToolEventKind::Result { is_error, .. },
                ..
            }) => assert!(*is_error),
            other => panic!("expected Tool Result, got {other:?}"),
        }
    }

    #[test]
    fn maps_usage_update_with_context_occupancy() {
        let env = envelope(json!({"update": {
            "sessionUpdate": "usage_update",
            "used": 45_000,
            "size": 200_000,
            "cost": {"amount": 0.42, "currency": "USD"},
        }}));
        let events = map_session_update(&env).expect("events");
        match &events[0] {
            NormalizedEvent::Usage(u) => {
                assert_eq!(u.kind, "turn");
                assert_eq!(u.context_tokens, Some(45_000));
                assert_eq!(u.cost_usd, Some(0.42));
                // Window size rides in the model slot as "__ctx__used/size".
                assert_eq!(u.model.as_deref(), Some("__ctx__45000/200000"));
            }
            other => panic!("expected Usage, got {other:?}"),
        }
    }

    #[test]
    fn maps_compaction_completed_to_status_with_summary() {
        let env = envelope(json!({"update": {
            "sessionUpdate": "compaction_update",
            "compactionId": "c1",
            "status": "completed",
            "summary": [{"type": "text", "text": "kept the plan"}],
        }}));
        let events = map_session_update(&env).expect("events");
        match &events[0] {
            NormalizedEvent::CompactionStatus {
                status,
                summary,
                error,
            } => {
                assert_eq!(status, "completed");
                assert_eq!(summary.as_deref(), Some("kept the plan"));
                assert!(error.is_none());
            }
            other => panic!("expected CompactionStatus, got {other:?}"),
        }
    }

    #[test]
    fn maps_compaction_in_progress_without_boundary() {
        let env = envelope(json!({"update": {
            "sessionUpdate": "compaction_update",
            "compactionId": "c1",
            "status": "in_progress",
        }}));
        let events = map_session_update(&env).expect("events");
        match &events[0] {
            NormalizedEvent::CompactionStatus { status, .. } => {
                assert_eq!(status, "in_progress");
            }
            other => panic!("expected CompactionStatus, got {other:?}"),
        }
        assert!(
            !events
                .iter()
                .any(|e| matches!(e, NormalizedEvent::CompactBoundary { .. })),
            "in_progress must not mark the chat boundary"
        );
    }

    #[test]
    fn maps_plan_update_with_entries() {
        let env = envelope(json!({"update": {
            "sessionUpdate": "plan",
            "entries": [
                {"content": "Read the schema", "priority": "high", "status": "completed"},
                {"content": "Write the mapper", "priority": "medium", "status": "in_progress"},
            ],
        }}));
        let events = map_session_update(&env).expect("events");
        match &events[0] {
            NormalizedEvent::PlanUpdate { entries } => {
                assert_eq!(entries.len(), 2);
                assert_eq!(entries[0].content, "Read the schema");
                assert_eq!(entries[0].status, "completed");
                assert_eq!(entries[1].status, "in_progress");
            }
            other => panic!("expected PlanUpdate, got {other:?}"),
        }
    }

    #[test]
    fn maps_notice_with_severity() {
        let env = envelope(json!({"update": {
            "sessionUpdate": "notice",
            "severity": "warning",
            "title": "Context nearly full",
            "description": "Consider /compact",
        }}));
        let events = map_session_update(&env).expect("events");
        match &events[0] {
            NormalizedEvent::Notice {
                severity,
                title,
                description,
            } => {
                assert_eq!(severity, "warning");
                assert_eq!(title, "Context nearly full");
                assert_eq!(description.as_deref(), Some("Consider /compact"));
            }
            other => panic!("expected Notice, got {other:?}"),
        }
    }

    #[test]
    fn maps_subagent_update_patch() {
        let env = envelope(json!({"update": {
            "sessionUpdate": "subagent_update",
            "sessionId": "child-1",
            "title": "Explore agent",
            "state": {"state": "running"},
        }}));
        let events = map_session_update(&env).expect("events");
        match &events[0] {
            NormalizedEvent::SubagentUpdate {
                session_id,
                title,
                state,
                ..
            } => {
                assert_eq!(session_id, "child-1");
                assert_eq!(title.as_deref(), Some("Explore agent"));
                assert_eq!(state.as_deref(), Some("running"));
            }
            other => panic!("expected SubagentUpdate, got {other:?}"),
        }
    }

    #[test]
    fn maps_tool_call_in_progress_content_as_update() {
        let env = envelope(json!({"update": {
            "sessionUpdate": "tool_call_update",
            "toolCallId": "tc-1",
            "status": "in_progress",
            "content": [{"type": "content", "content": {"type": "text", "text": "partial out"}}],
        }}));
        let events = map_session_update(&env).expect("events");
        match &events[0] {
            NormalizedEvent::Tool(ToolEvent {
                kind: ToolEventKind::Update { content },
                ..
            }) => assert_eq!(content, "partial out"),
            other => panic!("expected Tool Update, got {other:?}"),
        }
    }

    #[test]
    fn ignores_unmodeled_updates() {
        for kind in [
            "user_message_chunk",
            "available_commands_update",
            "session_message",
            "session_message_chunk",
        ] {
            let env = envelope(json!({"update": {"sessionUpdate": kind}}));
            assert!(map_session_update(&env).is_none(), "{kind} must be ignored");
        }
    }

    #[test]
    fn registry_merges_user_over_builtin_and_rejects_invalid() {
        load_registry(vec![
            AcpAgentConfig {
                key: "  ".into(),
                label: "".into(),
                command: "noop".into(),
                args: vec![],
                env: HashMap::new(),
                probe_message: "ping".into(),
            },
            AcpAgentConfig {
                key: "myagent".into(),
                label: "".into(), // falls back to key
                command: "my-agent-bin".into(),
                args: vec!["--acp".into()],
                env: HashMap::new(),
                probe_message: "ping".into(),
            },
        ]);
        let agents = registry_agents();
        assert!(agents
            .iter()
            .any(|a| a.key == "myagent" && a.label == "myagent"));
        // builtin gemini is always re-added
        assert!(agents.iter().any(|a| a.key == "gemini"));
        // normalize resolves registry ids
        assert!(normalize_engine_id("acp/myagent").is_ok());
        assert!(normalize_engine_id("acp/nonexistent").is_err());
    }

    #[test]
    fn permission_option_selection_prefers_allow_and_reject_kinds() {
        // Simulate handle_permission_request's option-picking logic directly.
        let options = vec![
            json!({"optionId": "opt_yes", "name": "Allow", "kind": "allow_once"}),
            json!({"optionId": "opt_no", "name": "Reject", "kind": "reject_once"}),
        ];
        let mut allow_id: Option<String> = None;
        let mut reject_id: Option<String> = None;
        for opt in &options {
            let kind = opt.get("kind").and_then(Value::as_str).unwrap_or("");
            let id = opt.get("optionId").and_then(Value::as_str).unwrap_or("");
            if kind == "allow_once" || kind == "allow_always" {
                allow_id.get_or_insert(id.to_string());
            } else if kind == "reject_once" || kind == "reject_always" {
                reject_id.get_or_insert(id.to_string());
            }
        }
        assert_eq!(allow_id.as_deref(), Some("opt_yes"));
        assert_eq!(reject_id.as_deref(), Some("opt_no"));
    }

    #[test]
    fn engine_id_roundtrip() {
        assert!(is_acp_engine_id("acp/gemini"));
        assert!(!is_acp_engine_id("claude"));
        assert_eq!(acp_key_of("acp/gemini"), Some("gemini"));
        assert_eq!(acp_engine_id("gemini"), "acp/gemini");
    }

    // -------------------------------------------------------------------
    // Live end-to-end tests against a real ACP agent. These spawn the
    // actual `claude-agent-acp` wrapper (which shells out to a real
    // Claude backend) and drive Pixie's full Rust path: AcpSession::spawn
    // → initialize handshake → ensure_session → send_message →
    // read_acp_turn event mapping. They are #[ignore]d so `cargo test`
    // stays offline/deterministic; run with:
    //   cargo test -p pixie_lib acp_e2e -- --ignored --nocapture
    // -------------------------------------------------------------------

    #[cfg(test)]
    mod acp_e2e {
        use super::*;
        use crate::engine::persistent::TurnOutcome;
        use std::sync::Arc;
        use tokio::sync::Mutex as TokioMutex;

        fn live_agent() -> AcpAgentConfig {
            AcpAgentConfig {
                key: "claude".into(),
                label: "Claude Agent (ACP)".into(),
                command: "npx".into(),
                args: vec![
                    "-y".into(),
                    "@agentclientprotocol/claude-agent-acp@latest".into(),
                ],
                env: HashMap::new(),
                probe_message: "ping".into(),
            }
        }

        fn cwd_tmp() -> Option<String> {
            Some(std::env::temp_dir().to_string_lossy().to_string())
        }

        async fn collect_turn(
            session: &mut AcpSession,
            message: &str,
        ) -> (Vec<NormalizedEvent>, TurnOutcome) {
            session
                .ensure_session(cwd_tmp().as_deref(), None, &[])
                .await
                .expect("ensure_session");
            let prompt_id = session
                .send_message(message, &[])
                .await
                .expect("send_message");
            let ctx = session.turn_ctx();
            let events: Arc<TokioMutex<Vec<NormalizedEvent>>> = Arc::default();
            let sink = Arc::clone(&events);
            let outcome = read_acp_turn(
                &ctx,
                prompt_id,
                move |evs| {
                    if let Ok(mut q) = sink.try_lock() {
                        q.extend_from_slice(evs);
                    }
                },
                || false,
                || {},
            )
            .await;
            let collected = Arc::try_unwrap(events)
                .map(|m| m.into_inner())
                .unwrap_or_default();
            (collected, outcome)
        }

        /// Full happy path: spawn → handshake → session → prompt → events.
        /// Asserts the real wire produced text, thinking, usage-with-window,
        /// and a clean `end_turn`.
        #[tokio::test(flavor = "multi_thread")]
        #[ignore = "spawns a real agent process and spends real tokens"]
        async fn acp_e2e_full_turn() {
            let mut session = AcpSession::spawn(live_agent(), cwd_tmp().as_deref())
                .await
                .expect("spawn + initialize");
            assert!(
                session.capabilities.load_session,
                "claude-agent-acp advertises loadSession"
            );

            let (events, outcome) =
                collect_turn(&mut session, "Reply with exactly: PIXIE-E2E-OK").await;

            match &outcome {
                TurnOutcome::Done(final_text) => {
                    assert!(
                        final_text.contains("PIXIE-E2E-OK"),
                        "final text: {final_text:?}"
                    );
                }
                other => panic!("expected Done, got {other:?}"),
            }

            let text: String = events
                .iter()
                .filter_map(|e| match e {
                    NormalizedEvent::TextDelta { text, .. } => Some(text.clone()),
                    _ => None,
                })
                .collect();
            assert!(text.contains("PIXIE-E2E-OK"), "streamed text: {text:?}");
            // Thinking is model-behavior dependent — the agent may skip it on a
            // trivial prompt. Absence is not a failure (the offline mapping
            // tests already cover thought-chunk → ThinkingText); just report
            // what arrived, and require that thinking, when present, is text
            // (non-empty), since the mapping never emits ThinkingTokens for ACP.
            let thinking_chunks = events
                .iter()
                .filter(|e| matches!(e, NormalizedEvent::ThinkingText { .. }))
                .count();
            println!("thinking chunks seen: {thinking_chunks}");
            assert!(
                !events
                    .iter()
                    .any(|e| matches!(e, NormalizedEvent::ThinkingTokens { .. })),
                "ACP mapping should never emit ThinkingTokens"
            );
            let usage = events
                .iter()
                .filter_map(|e| match e {
                    NormalizedEvent::Usage(u) if u.kind == "turn" => Some(u.clone()),
                    _ => None,
                })
                .next_back();
            let usage = usage.expect("expected a turn usage event");
            assert!(usage.context_tokens.unwrap_or(0) > 0, "usage: {usage:?}");
            assert!(
                usage.model.as_deref().unwrap_or("").starts_with("__ctx__"),
                "context window rides in model slot: {usage:?}"
            );

            // Second turn on the SAME process: session is kept, context grows.
            let (events2, outcome2) = collect_turn(
                &mut session,
                "What did I ask you to reply with? One short sentence.",
            )
            .await;
            assert!(
                matches!(outcome2, TurnOutcome::Done(_)),
                "turn 2: {outcome2:?}"
            );
            let text2: String = events2
                .iter()
                .filter_map(|e| match e {
                    NormalizedEvent::TextDelta { text, .. } => Some(text.clone()),
                    _ => None,
                })
                .collect();
            assert!(
                text2.to_uppercase().contains("E2E") || text2.to_uppercase().contains("PIXIE"),
                "turn 2 should recall turn 1 via session/load-free continuity: {text2:?}"
            );
        }

        /// `cancel()` mid-turn must surface as `TurnOutcome::Stopped`.
        #[tokio::test(flavor = "multi_thread")]
        #[ignore = "spawns a real agent process"]
        async fn acp_e2e_cancel_mid_turn() {
            let mut session = AcpSession::spawn(live_agent(), cwd_tmp().as_deref())
                .await
                .expect("spawn + initialize");
            session
                .ensure_session(cwd_tmp().as_deref(), None, &[])
                .await
                .expect("ensure_session");
            let prompt_id = session
                .send_message(
                    "Count from 1 to 500, one number per line, starting at 1. Do not skip ahead and do not summarize; just the numbers.",
                    &[],
                )
                .await
                .expect("send_message");
            let ctx = session.turn_ctx();
            // Write session/cancel with the true session id mid-turn, exactly
            // what AcpSession::cancel does, while the turn reader is running.
            // Cancel as soon as the first streamed output arrives so the
            // request reliably lands mid-turn (a fixed delay races a fast
            // model and can land after `end_turn`).
            let cancel_session_id = session.acp_session_id.clone().expect("session id");
            let ctx2 = session.turn_ctx();
            let (notify_tx, notify_rx) = tokio::sync::oneshot::channel::<()>();
            let notify_tx = std::sync::Mutex::new(Some(notify_tx));
            let writer = tokio::spawn(async move {
                let _ = notify_rx.await;
                tokio::time::sleep(std::time::Duration::from_millis(150)).await;
                let msg = OutgoingMessage {
                    jsonrpc: "2.0",
                    id: None,
                    method: "session/cancel".into(),
                    params: Some(json!({"sessionId": cancel_session_id})),
                };
                let line = serde_json::to_string(&msg).unwrap();
                let mut stdin = ctx2.stdin.lock().await;
                use tokio::io::AsyncWriteExt;
                let _ = stdin.write_all(line.as_bytes()).await;
                let _ = stdin.write_all(b"\n").await;
                let _ = stdin.flush().await;
            });
            let outcome = read_acp_turn(
                &ctx,
                prompt_id,
                |_| {
                    if let Ok(mut guard) = notify_tx.lock() {
                        if let Some(tx) = guard.take() {
                            let _ = tx.send(());
                        }
                    }
                },
                || false,
                || {},
            )
            .await;
            writer.await.ok();
            assert!(
                matches!(outcome, TurnOutcome::Stopped { .. }),
                "cancel should yield Stopped, got {outcome:?}"
            );
        }

        /// The tool-call path: ask the agent to run a tool (it may request
        /// permission — the turn reader auto-answers, we assert a Tool event
        /// with real content arrives).
        #[tokio::test(flavor = "multi_thread")]
        #[ignore = "spawns a real agent process and spends real tokens"]
        async fn acp_e2e_tool_call() {
            let mut session = AcpSession::spawn(live_agent(), cwd_tmp().as_deref())
                .await
                .expect("spawn + initialize");
            let dir = std::env::temp_dir().join("pixie-acp-e2e");
            std::fs::create_dir_all(&dir).expect("mkdir");
            std::fs::write(dir.join("e2e-marker.txt"), "pixie-marker-12345").expect("write");
            let dir_s = dir.to_string_lossy().to_string();
            session
                .ensure_session(Some(&dir_s), None, &[])
                .await
                .expect("ensure_session");
            let prompt_id = session
                .send_message(
                    "Read the file e2e-marker.txt in the current directory and reply with its exact contents.",
                    &[],
                )
                .await
                .expect("send_message");
            let ctx = session.turn_ctx();
            let events: Arc<TokioMutex<Vec<NormalizedEvent>>> = Arc::default();
            let sink = Arc::clone(&events);
            let outcome = read_acp_turn(
                &ctx,
                prompt_id,
                move |evs| {
                    if let Ok(mut q) = sink.try_lock() {
                        q.extend_from_slice(evs);
                    }
                },
                || false,
                || {},
            )
            .await;
            let collected = Arc::try_unwrap(events)
                .map(|m| m.into_inner())
                .unwrap_or_default();
            assert!(matches!(outcome, TurnOutcome::Done(_)), "{outcome:?}");
            assert!(
                collected
                    .iter()
                    .any(|e| matches!(e, NormalizedEvent::Tool(_))),
                "expected at least one tool event; got {collected:?}"
            );
            let text: String = collected
                .iter()
                .filter_map(|e| match e {
                    NormalizedEvent::TextDelta { text, .. } => Some(text.clone()),
                    _ => None,
                })
                .collect();
            assert!(text.contains("pixie-marker-12345"), "text: {text:?}");
        }
    }
}
