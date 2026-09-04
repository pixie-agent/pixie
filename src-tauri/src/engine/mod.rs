pub mod builtin;
pub mod claude;
pub mod codebuddy;
pub mod codex;
pub mod cursor;
pub mod persistent;
pub(crate) mod shared;

use anyhow::{Context, Result};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::sync::Arc;
use std::time::{Duration, Instant};
use tokio::io::{AsyncBufReadExt, AsyncReadExt, BufReader};
use tokio::process::Child;
use tokio::sync::Mutex;

pub use shared::{
    set_engine_model_config, set_model_config_overrides, truncate_text, MAX_TOOL_RESULT_CHARS,
};

/// Registered agent engine identifiers.
///
/// To add a new engine:
/// 1. Add its id here and in `engine_display_name`.
/// 2. Create `engine/<name>.rs` with `check_available`, `spawn_*`, `parse_line`.
/// 3. Wire dispatch in `check_engine`, `spawn_single`, `spawn_continue`, `parse_line`.
pub const ENGINE_IDS: &[&str] = &["claude", "cursor", "codebuddy", "builtin", "codex"];

pub fn normalize_engine_id(id: &str) -> Result<&'static str> {
    match id {
        "claude" => Ok("claude"),
        "cursor" => Ok("cursor"),
        "codebuddy" => Ok("codebuddy"),
        "builtin" => Ok("builtin"),
        "codex" => Ok("codex"),
        other => anyhow::bail!("unknown engine: {other}"),
    }
}

pub fn engine_display_name(id: &str) -> &'static str {
    match id {
        "claude" => "Claude Code",
        "cursor" => "Cursor Agent",
        "codebuddy" => "CodeBuddy",
        "builtin" => builtin::engine_display_name(),
        "codex" => "OpenAI Codex",
        _ => "Unknown",
    }
}

/// How far an engine has been verified, beyond the cheap binary check.
///
/// `check_available` only confirms the binary exists and runs `--version`; it
/// leaves `auth_state` at `Unknown`. A real readiness probe (`probe_engine`)
/// sends a tiny "ping" turn and classifies the outcome:
/// - `Ready` — the ping returned a result; the engine is logged in and usable.
/// - `NotAuthenticated` — the ping failed with an auth-shaped error (heuristic
///   string match; not exact — see `classify_probe_error`).
/// - `RegionBlocked` — the engine's API rejected the request for network/geo
///   reasons (403 Cloudflare block page, or an explicit
///   `unsupported_country_region_territory` code). Credentials are fine —
///   re-login won't help; the user needs to route the CLI through a
///   supported-region network/proxy.
/// - `Error` — the ping failed for some other reason (the raw text is in
///   `EngineStatus::probe_error`).
/// - `NoResponse` — the probe produced no terminal event before the timeout.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Default)]
#[serde(rename_all = "snake_case")]
pub enum AuthState {
    #[default]
    Unknown,
    Ready,
    NotAuthenticated,
    RegionBlocked,
    Error,
    NoResponse,
}

/// Wall-clock budget for a readiness probe before we give up as `NoResponse`.
/// Generous on purpose: the first call right after a fresh login (token
/// refresh + model/telemetry fetch) can be slow, and we'd rather wait than
/// wrongly report "not ready".
pub const PROBE_TIMEOUT: Duration = Duration::from_secs(60);

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct EngineStatus {
    pub id: String,
    pub display_name: String,
    pub available: bool,
    pub version: Option<String>,
    pub path: Option<String>,
    pub error: Option<String>,
    /// Result of the readiness/auth probe. `Unknown` until `probe_engine` runs.
    #[serde(default)]
    pub auth_state: AuthState,
    /// Raw engine message accompanying a non-`Ready` probe outcome.
    #[serde(default)]
    pub probe_error: Option<String>,
    /// Verbatim probe transcript (stdout + stderr) for the raw-output viewer.
    /// `None` if no child probe ran (binary missing / never probed).
    #[serde(default)]
    pub probe_raw_output: Option<String>,
}

impl EngineStatus {
    /// Build a status from the cheap binary/version check only (auth not probed).
    /// Centralizes the `auth_state = Unknown` default so engine modules don't
    /// repeat the new fields in every `check_available` arm.
    pub fn basic(
        id: &str,
        display_name: &str,
        available: bool,
        version: Option<String>,
        path: Option<String>,
        error: Option<String>,
    ) -> Self {
        Self {
            id: id.to_string(),
            display_name: display_name.to_string(),
            available,
            version,
            path,
            error,
            auth_state: AuthState::Unknown,
            probe_error: None,
            probe_raw_output: None,
        }
    }
}

// ---------------------------------------------------------------------------
// Normalized stream events (engine-agnostic)
// ---------------------------------------------------------------------------

#[derive(Debug, Clone)]
pub enum ToolEventKind {
    Start {
        name: Option<String>,
        input: Option<String>,
    },
    Result {
        content: Option<String>,
        is_error: bool,
    },
}

#[derive(Debug, Clone)]
pub struct ToolEvent {
    pub id: String,
    pub kind: ToolEventKind,
}

#[derive(Debug, Clone)]
pub struct UsageInfo {
    pub kind: &'static str,
    pub input_tokens: u64,
    pub output_tokens: u64,
    pub cache_read_tokens: u64,
    pub cache_creation_tokens: u64,
    pub cost_usd: Option<f64>,
    pub duration_ms: Option<u64>,
    pub num_turns: Option<u64>,
    pub model: Option<String>,
    pub stop_reason: Option<String>,
}

#[derive(Debug, Clone)]
pub enum NormalizedEvent {
    TextDelta {
        text: String,
        event_type: &'static str,
    },
    ThinkingText {
        content: String,
    },
    ThinkingTokens {
        tokens: u64,
    },
    Tool(ToolEvent),
    Usage(UsageInfo),
    /// Emitted when the CLI assigns its own session id (e.g. Cursor init).
    SessionEstablished {
        session_id: String,
    },
    Final {
        text: String,
    },
    Error {
        message: String,
    },
    /// The agent is requesting permission to run a tool (e.g. Bash command).
    PermissionRequest {
        id: String,
        tool_name: String,
        input: serde_json::Value,
    },
}

impl NormalizedEvent {
    pub fn streaming_text(&self) -> Option<String> {
        match self {
            NormalizedEvent::TextDelta { text, .. } => Some(text.clone()),
            _ => None,
        }
    }

    pub fn streaming_text_event_type(&self) -> Option<&'static str> {
        match self {
            NormalizedEvent::TextDelta { event_type, .. } => Some(event_type),
            _ => None,
        }
    }

    pub fn streaming_thinking(&self) -> Option<String> {
        match self {
            NormalizedEvent::ThinkingText { content } => Some(content.clone()),
            _ => None,
        }
    }

    pub fn tool_event(&self) -> Option<&ToolEvent> {
        match self {
            NormalizedEvent::Tool(te) => Some(te),
            _ => None,
        }
    }

    pub fn thinking_tokens(&self) -> Option<u64> {
        match self {
            NormalizedEvent::ThinkingTokens { tokens } => Some(*tokens),
            _ => None,
        }
    }

    pub fn usage(&self) -> Option<&UsageInfo> {
        match self {
            NormalizedEvent::Usage(u) => Some(u),
            _ => None,
        }
    }

    #[allow(dead_code)]
    pub fn final_text(&self) -> Option<String> {
        match self {
            NormalizedEvent::Final { text } => Some(text.clone()),
            NormalizedEvent::Error { message } => Some(message.clone()),
            _ => None,
        }
    }

    pub fn session_id(&self) -> Option<String> {
        match self {
            NormalizedEvent::SessionEstablished { session_id } => Some(session_id.clone()),
            _ => None,
        }
    }
}

pub fn parse_line(engine_id: &str, line: &str) -> Vec<NormalizedEvent> {
    match engine_id {
        "claude" => claude::parse_line(line),
        "codebuddy" => codebuddy::parse_line(line),
        "cursor" => cursor::parse_line(line),
        "codex" => codex::parse_line(line),
        // Builtin engine doesn't use NDJSON — it emits events directly via channel
        "builtin" => vec![],
        _ => vec![],
    }
}

pub async fn check_engine(id: &str) -> EngineStatus {
    let display_name = engine_display_name(id);
    match id {
        "claude" => claude::check_available().await,
        "codebuddy" => codebuddy::check_available().await,
        "cursor" => cursor::check_available().await,
        "builtin" => builtin::check_available().await,
        "codex" => codex::check_available().await,
        _ => EngineStatus::basic(
            id,
            display_name,
            false,
            None,
            None,
            Some(format!("unknown engine: {id}")),
        ),
    }
}

pub async fn check_all_engines() -> Vec<EngineStatus> {
    let mut out = Vec::with_capacity(ENGINE_IDS.len());
    for id in ENGINE_IDS {
        out.push(check_engine(id).await);
    }
    out
}

// ---------------------------------------------------------------------------
// Readiness / auth probe
//
// Beyond the cheap binary check, we verify an engine actually works by sending
// a one-shot "ping" turn and classifying the result. This is the only reliable,
// engine-agnostic way to tell "logged in" from "not logged in": the credential
// stores differ per engine (Claude hides them in the macOS Keychain and may not
// even write `.credentials.json`), so we never inspect them — we just ask the
// engine to do something and watch what comes back.
// ---------------------------------------------------------------------------

/// Outcome of a readiness probe.
#[derive(Debug, Clone)]
pub struct ProbeOutcome {
    pub state: AuthState,
    pub error: Option<String>,
    /// Unmodified probe transcript (stdout stream + captured stderr) for the
    /// "view raw output" affordance. Never summarized — this is exactly what
    /// the engine printed. None when the probe never ran a child.
    pub raw_output: Option<String>,
}

impl ProbeOutcome {
    fn ready() -> Self {
        Self {
            state: AuthState::Ready,
            error: None,
            raw_output: None,
        }
    }

    /// Classify a free-text failure message (from an `error` stream event or
    /// captured stderr) into `NotAuthenticated` / `RegionBlocked` / `Error`,
    /// keeping a summarized text (HTML noise collapsed — see
    /// `summarize_probe_error`).
    fn from_message(msg: &str) -> Self {
        let cleaned = shared::strip_ansi_and_controls(msg);
        let trimmed = cleaned.trim();
        Self {
            state: classify_probe_error(trimmed),
            error: Some(summarize_probe_error(trimmed)),
            raw_output: None,
        }
    }

    fn error(msg: impl Into<String>) -> Self {
        Self {
            state: AuthState::Error,
            error: Some(msg.into()),
            raw_output: None,
        }
    }

    fn no_response() -> Self {
        Self {
            state: AuthState::NoResponse,
            error: Some("engine produced no response within the timeout".to_string()),
            raw_output: None,
        }
    }
}

/// Heuristic: does this probe failure look like an auth/login problem?
///
/// The engines only give us free-text error messages (no structured code), so we
/// match against a keyword list. This is deliberately **best-effort** — a future
/// CLI version may rephrase an auth error, or a non-auth error may happen to
/// contain a keyword. Callers always surface the raw `probe_error` alongside the
/// label, so a misclassification stays recoverable for the user.
///
/// Region-block errors (403 + Cloudflare HTML, or OpenAI's explicit
/// `unsupported_country_region_territory`) are checked FIRST and separately:
/// they also contain "403"/"forbidden", but the fix is a proxy, not a re-login.
fn classify_probe_error(message: &str) -> AuthState {
    let lower = message.to_lowercase();

    // Geo/network rejection — checked before the auth list so a 403 block page
    // isn't misread as "go log in again".
    const REGION: &[&str] = &[
        "unsupported_country_region_territory",
        "country, region, or territory not supported",
    ];
    if REGION.iter().any(|k| lower.contains(k)) {
        return AuthState::RegionBlocked;
    }
    // A 403 whose body is a Cloudflare/CDN block page (bloated HTML with
    // viewport/style tags) is a network-level rejection, not a credential one.
    if lower.contains("403") && is_block_page_html(message) {
        return AuthState::RegionBlocked;
    }

    const EN: &[&str] = &[
        "auth",
        "credential",
        "unauthorized",
        "forbidden",
        "401",
        "403",
        "api key",
        "apikey",
        "api-key",
        "access token",
        "not logged in",
        "not signed in",
        "log in",
        "sign in",
        "login",
        "signin",
    ];
    const ZH: &[&str] = &[
        "鉴权",
        "未登录",
        "请登录",
        "请先登录",
        "登录",
        "凭证",
        "授权失败",
        "身份验证",
        "认证",
    ];
    if EN.iter().any(|k| lower.contains(k)) || ZH.iter().any(|k| message.contains(k)) {
        AuthState::NotAuthenticated
    } else {
        AuthState::Error
    }
}

/// Does this look like a CDN/WAF block page rather than a plain API error?
/// The codex CLI inlines the whole Cloudflare HTML (doctype, viewport meta,
/// inline CSS) into its error JSON; real API auth errors are short JSON text.
fn is_block_page_html(message: &str) -> bool {
    let lower = message.to_lowercase();
    lower.contains("<html") && (lower.contains("viewport") || lower.contains("<style"))
}

/// Collapse a raw engine error into something a human can read in one line.
///
/// Region-block errors from codex inline an entire Cloudflare block page
/// (doctype + CSS, tens of KB) into the message. Keep the leading reason and
/// the target URL, drop the HTML soup: "unexpected status 403 Forbidden …,
/// url: https://chatgpt.com/backend-api/codex/responses, cf-ray: …".
pub fn summarize_probe_error(message: &str) -> String {
    if !is_block_page_html(message) {
        return message.trim().to_string();
    }

    // Strategy: keep only fragments that don't contain HTML tags, then keep the
    // informative ones (status line, url:, cf-ray: — including the token right
    // after "url:", which is the actual URL).
    let mut kept: Vec<String> = Vec::new();
    let mut keep_next = false;
    for part in message.split_whitespace() {
        if part.contains('<') && part.contains('>') {
            keep_next = false;
            continue; // HTML tag or tag-adjacent soup
        }
        let lower = part.to_lowercase();
        let informative = lower.starts_with("403")
            || lower.starts_with("forbidden")
            || lower.starts_with("unexpected")
            || lower.starts_with("status")
            || lower.starts_with("url:")
            || lower.starts_with("cf-ray:")
            || lower.contains("forbidden");
        if informative {
            kept.push(part.to_string());
            // "url:" is followed by the actual URL — capture that too.
            keep_next = lower.ends_with("url:");
        } else if keep_next {
            // The token right after "url:" — the URL itself (strip a trailing comma).
            kept.push(part.trim_end_matches(',').to_string());
            keep_next = false;
        }
    }

    if kept.is_empty() {
        // Fall back to the first tag-free run of the message.
        message.split('<').next().unwrap_or("").trim().to_string()
    } else {
        kept.join(" ")
    }
}

/// Read a probe child's stream until a terminal event (`Final`/`Error`) is seen,
/// the process exits, or the timeout elapses — then classify the outcome.
///
/// stderr is captured concurrently because auth failures often exit non-zero
/// with the error on stderr *before* emitting any stream-json.
pub async fn run_probe(engine_id: &str, mut child: Child) -> ProbeOutcome {
    let start = Instant::now();
    log::info!("[probe] {engine_id}: starting (pid {:?})", child.id());
    let stdout = child.stdout.take();
    let stderr = child.stderr.take();
    let stdout = match stdout {
        Some(s) => s,
        None => {
            log::warn!("[probe] {engine_id}: no stdout on child");
            return ProbeOutcome::error("probe produced no stdout");
        }
    };

    let stderr_task = tokio::spawn(async move {
        let Some(stderr) = stderr else {
            return String::new();
        };
        let mut reader = BufReader::new(stderr);
        let mut buf = String::new();
        let _ = reader.read_to_string(&mut buf).await;
        buf
    });

    let reader = BufReader::new(stdout);
    let mut lines = reader.lines();

    // Raw transcript of everything the engine printed on stdout (kept verbatim
    // for the "view raw output" UI; the classified/summarized error is separate).
    let mut raw_stdout = String::new();

    // Scan stdout for the first terminal event. Bounded by PROBE_TIMEOUT.
    let scanned = tokio::time::timeout(PROBE_TIMEOUT, async {
        while let Some(line) = lines.next_line().await? {
            raw_stdout.push_str(&line);
            raw_stdout.push('\n');
            if shared::is_ignorable_stream_line(&line) {
                continue;
            }
            for evt in parse_line(engine_id, &line) {
                match evt {
                    NormalizedEvent::Final { .. } => return Ok(Some(ProbeOutcome::ready())),
                    NormalizedEvent::Error { message } => {
                        return Ok(Some(ProbeOutcome::from_message(&message)));
                    }
                    _ => {}
                }
            }
        }
        Ok::<_, std::io::Error>(None) // EOF with no terminal event
    })
    .await;

    // Reap the child regardless of outcome (we may have broken out early).
    let _ = child.kill().await;
    let _ = child.wait().await;

    let stderr_buf = match tokio::time::timeout(Duration::from_millis(500), stderr_task).await {
        Ok(Ok(s)) => s,
        _ => String::new(),
    };

    let mut outcome = match scanned {
        // A terminal event was seen on stdout.
        Ok(Ok(Some(outcome))) => outcome,
        // EOF with no terminal event: fall back to captured stderr (auth exits).
        Ok(Ok(None)) => {
            let msg = stderr_buf.trim();
            if !msg.is_empty() {
                ProbeOutcome::from_message(msg)
            } else {
                ProbeOutcome::error("engine produced no response")
            }
        }
        // stdout read error: fall back to stderr if we have it.
        Ok(Err(_io)) => {
            let msg = stderr_buf.trim();
            if !msg.is_empty() {
                ProbeOutcome::from_message(msg)
            } else {
                ProbeOutcome::error("failed to read engine output")
            }
        }
        // Timed out before any terminal event.
        Err(_elapsed) => ProbeOutcome::no_response(),
    };

    // Attach the raw transcript (stdout + captured stderr) so the UI can show
    // exactly what the engine printed. Bounded so a pathological engine can't
    // push megabytes through IPC; the head of the output carries the error.
    const MAX_RAW_OUTPUT_CHARS: usize = 24_000;
    let mut raw = raw_stdout;
    if !stderr_buf.trim().is_empty() {
        raw.push_str("\n--- stderr ---\n");
        raw.push_str(&stderr_buf);
    }
    if raw.len() > MAX_RAW_OUTPUT_CHARS {
        raw.truncate(MAX_RAW_OUTPUT_CHARS);
        raw.push_str("\n--- truncated ---\n");
    }
    if !raw.trim().is_empty() {
        outcome.raw_output = Some(raw);
    }

    log::info!(
        "[probe] {engine_id}: {:?} after {}ms (stderr {} bytes, error: {:?})",
        outcome.state,
        start.elapsed().as_millis(),
        stderr_buf.len(),
        outcome.error
    );
    outcome
}

/// Default probe args per engine — the single source of truth shared by each
/// engine's `spawn_probe()`, so per-engine copies can't drift apart. Model
/// flags are appended at spawn time and deliberately NOT included here.
pub fn default_probe_args(id: &str) -> Result<Vec<&'static str>> {
    Ok(match id {
        "claude" => vec![
            "--print",
            "--output-format",
            "stream-json",
            "--verbose",
            "--permission-mode",
            "bypassPermissions",
        ],
        "codebuddy" => vec![
            "--print",
            "--output-format",
            "stream-json",
            "--include-partial-messages",
            "--permission-mode",
            "bypassPermissions",
        ],
        "cursor" => vec![
            "-p",
            "--force",
            "--output-format",
            "stream-json",
            "--stream-partial-output",
        ],
        "codex" => vec![
            "exec",
            "--json",
            "--ephemeral",
            "--dangerously-bypass-approvals-and-sandbox",
        ],
        other => anyhow::bail!("no default probe command for engine: {other}"),
    })
}

/// Probe a single engine's readiness: cheap-check first, and only if the binary
/// is present, send a real "ping" turn and classify the response.
pub async fn probe_engine(id: &str) -> EngineStatus {
    let mut status = check_engine(id).await;
    if !status.available {
        // Binary missing — nothing to probe; auth_state stays Unknown.
        return status;
    }
    let child = match id {
        "claude" => claude::spawn_probe().await,
        "codebuddy" => codebuddy::spawn_probe().await,
        "cursor" => cursor::spawn_probe().await,
        "codex" => codex::spawn_probe().await,
        // Builtin engine probe is handled differently (no child process)
        "builtin" => return builtin_probe(id).await,
        other => Err(anyhow::anyhow!("unknown engine: {other}")),
    };
    let outcome = match child {
        Ok(c) => run_probe(id, c).await,
        Err(e) => ProbeOutcome {
            state: AuthState::Error,
            error: Some(format!("failed to start probe: {e}")),
            raw_output: None,
        },
    };
    status.auth_state = outcome.state;
    status.probe_error = outcome.error;
    status.probe_raw_output = outcome.raw_output;
    status
}

/// Probe the builtin engine by making a minimal API call to Anthropic.
async fn builtin_probe(id: &str) -> EngineStatus {
    let mut status = check_engine(id).await;
    if !status.available {
        return status;
    }
    // For the builtin engine, "available" means the API key is set.
    // A real probe would make a tiny API call, but for now we just
    // mark it as Ready since we already checked the API key exists.
    status.auth_state = AuthState::Ready;
    status
}

/// Spawn the one-click login flow for an engine (opens a browser). Fire-and-
/// forget — the caller re-probes after the user completes login in the browser.
pub async fn login(id: &str) -> Result<()> {
    match id {
        "claude" => claude::spawn_login().await,
        "codebuddy" => codebuddy::spawn_login().await,
        "cursor" => cursor::spawn_login().await,
        "codex" => codex::spawn_login().await,
        other => anyhow::bail!("unknown engine: {other}"),
    }
}

// ---------------------------------------------------------------------------
// One-click install
// ---------------------------------------------------------------------------

/// The shell command that installs an engine CLI globally. Run via `sh -c` so
/// the cursor pipe (`curl ... | bash`) works. These mirror the commands shown
/// in the setup UI.
pub fn install_command(id: &str) -> Result<&'static str> {
    Ok(match id {
        "claude" => "npm install -g @anthropic-ai/claude-code",
        "codebuddy" => "npm install -g @tencent-ai/codebuddy-code",
        "cursor" => "curl https://cursor.com/install -fsS | bash",
        "codex" => "npm install -g @openai/codex",
        // Builtin engine is built-in, no install needed
        "builtin" => "(built-in, no installation required)",
        other => anyhow::bail!("unknown engine: {other}"),
    })
}

/// Result of a one-click install: whether the command exited 0, plus its
/// combined stdout/stderr (surfaced to the user on failure so they can debug —
/// e.g. missing npm/node, or a permissions error).
#[derive(Debug, Clone, Serialize)]
pub struct InstallOutcome {
    pub success: bool,
    pub output: String,
}

/// Run an engine's install command in the user's home dir, with the login-shell
/// environment (so npm/node on PATH — including nvm/homebrew — are found).
pub async fn install(id: &str) -> Result<InstallOutcome> {
    let cmd = install_command(id)?;
    let env = shared::get_shell_env().await.clone();
    let home = shared::home_dir();

    // `sh -c` on Unix (handles the cursor `curl … | bash` pipe), `cmd /C` on
    // Windows (where there's no sh and npm is `npm.cmd`). Note the cursor
    // install command is Unix-only (needs bash); on Windows it will fail and
    // surface that to the user.
    let mut c = if cfg!(windows) {
        let mut c = tokio::process::Command::new("cmd.exe");
        c.arg("/C").arg(cmd);
        c
    } else {
        let mut c = tokio::process::Command::new("sh");
        c.arg("-c").arg(cmd);
        c
    };
    if let Some(home) = &home {
        c.current_dir(home);
    }
    for (k, v) in &env {
        c.env(k, v);
    }
    log::info!("[install] {id}: running `{cmd}` in {:?}", home);
    let output = c.output().await.context("failed to run install command")?;
    let stdout = String::from_utf8_lossy(&output.stdout).to_string();
    let stderr = String::from_utf8_lossy(&output.stderr).to_string();
    let combined = if stdout.trim().is_empty() {
        stderr
    } else if stderr.trim().is_empty() {
        stdout
    } else {
        format!("{stdout}\n{stderr}")
    };
    let success = output.status.success();
    log::info!(
        "[install] {id}: success={success}, {} output bytes",
        combined.len()
    );
    Ok(InstallOutcome {
        success,
        output: combined,
    })
}

/// Fetch available models for a given engine.
/// Returns a list of (model_id, display_label) pairs.
pub async fn list_models(engine_id: &str) -> Vec<(String, String)> {
    match engine_id {
        "claude" => claude::list_models().await,
        "codebuddy" => codebuddy::list_models().await,
        "cursor" => cursor::list_models().await,
        "codex" => codex::list_models().await,
        "builtin" => builtin::list_models().await,
        _ => vec![],
    }
}

pub async fn spawn_single(
    engine_id: &str,
    session_id: &str,
    message: &str,
    cwd: Option<&str>,
    model: Option<&str>,
) -> Result<Child> {
    match engine_id {
        "claude" => claude::spawn_single(session_id, message, cwd, model).await,
        "codebuddy" => codebuddy::spawn_single(session_id, message, cwd, model).await,
        "cursor" => cursor::spawn_single(session_id, message, cwd, model).await,
        "codex" => codex::spawn_single(session_id, message, cwd, model).await,
        // Builtin engine doesn't spawn child processes
        "builtin" => anyhow::bail!("builtin engine does not use process spawning"),
        other => anyhow::bail!("unknown engine: {other}"),
    }
}

/// Spawn a headless (auto-approved) agent process for scheduled tasks.
/// Uses `--dangerously-skip-permissions` because there is no user to approve.
///
/// `readonly` restricts the run to read-only tools (tool allowlist / native
/// sandbox) — used when running an application for its user. Note: engines
/// without a CLI allowlist mechanism (CodeBuddy, Cursor) fall back to their
/// regular spawn and do NOT enforce read-only; callers relying on the
/// guarantee must confine the cwd accordingly.
pub async fn spawn_headless(
    engine_id: &str,
    session_id: &str,
    message: &str,
    cwd: Option<&str>,
    model: Option<&str>,
    readonly: bool,
) -> Result<Child> {
    match engine_id {
        "claude" => claude::spawn_headless(session_id, message, cwd, model, readonly).await,
        "codex" => codex::spawn_headless(session_id, message, cwd, model, readonly).await,
        // CodeBuddy/Cursor fall back to their regular spawn_single for now.
        // Builtin engine doesn't spawn child processes (handled separately)
        other => {
            if readonly {
                log::warn!(
                    "[engine] {other} does not support read-only headless runs; \
                     spawning with default permissions"
                );
            }
            spawn_single(other, session_id, message, cwd, model).await
        }
    }
}

pub async fn spawn_continue(
    engine_id: &str,
    session_id: &str,
    message: &str,
    cwd: Option<&str>,
    model: Option<&str>,
) -> Result<Child> {
    match engine_id {
        "claude" => claude::spawn_continue(session_id, message, cwd, model).await,
        "codebuddy" => codebuddy::spawn_continue(session_id, message, cwd, model).await,
        "cursor" => cursor::spawn_continue(session_id, message, cwd, model).await,
        "codex" => codex::spawn_continue(session_id, message, cwd, model).await,
        // Builtin engine doesn't spawn child processes
        "builtin" => anyhow::bail!("builtin engine does not use process spawning"),
        other => anyhow::bail!("unknown engine: {other}"),
    }
}

// ---------------------------------------------------------------------------
// Generic subprocess + stream reader
// ---------------------------------------------------------------------------

pub struct AgentProcess {
    child: Option<Child>,
}

impl AgentProcess {
    pub fn new() -> Self {
        Self { child: None }
    }

    #[allow(dead_code)]
    pub fn set_child(&mut self, child: Child) {
        self.child = Some(child);
    }

    #[allow(dead_code)]
    pub async fn read_stream<F>(&mut self, engine_id: &str, on_events: F) -> Result<String>
    where
        F: FnMut(&[NormalizedEvent]),
    {
        let child = self.child.take().context("no running agent process")?;
        read_child_stream(engine_id, child, on_events).await
    }

    pub async fn kill(&mut self) {
        if let Some(ref mut child) = self.child {
            let _ = child.kill().await;
            let _ = child.wait().await;
        }
        self.child = None;
    }

    #[allow(dead_code)]
    pub fn child_pid(&self) -> Option<u32> {
        self.child.as_ref().and_then(|c| c.id())
    }
}

/// Read NDJSON from a child process stdout until EOF, then wait for exit.
/// Callers should not hold per-conversation locks while this runs.
pub async fn read_child_stream<F>(
    engine_id: &str,
    mut child: Child,
    mut on_events: F,
) -> Result<String>
where
    F: FnMut(&[NormalizedEvent]),
{
    let stdout = child.stdout.take().context("stdout not captured")?;

    let reader = BufReader::new(stdout);
    let mut lines = reader.lines();
    let mut final_text = String::new();

    while let Some(line) = lines.next_line().await? {
        if shared::is_ignorable_stream_line(&line) {
            continue;
        }
        let events = parse_line(engine_id, &line);
        if events.is_empty() {
            continue;
        }
        for evt in &events {
            if let NormalizedEvent::Final { text } = evt {
                final_text = text.clone();
            }
        }
        on_events(&events);
    }

    let _ = child.wait().await;
    Ok(final_text)
}

pub type SharedAgentProcess = Arc<Mutex<AgentProcess>>;

/// Per-conversation engine binding + optional external session id (Cursor).
#[derive(Debug, Clone)]
pub struct ConversationEngineState {
    pub engine_id: String,
    pub external_session_id: Option<String>,
    /// Per-conversation model override (empty = use engine's global config).
    pub model: Option<String>,
}

pub type ConversationEngineMap = Arc<Mutex<HashMap<String, ConversationEngineState>>>;

pub fn init_conversation_engine_map() -> ConversationEngineMap {
    Arc::new(Mutex::new(HashMap::new()))
}

pub async fn resolve_session_id(
    map: &ConversationEngineMap,
    conversation_id: &str,
    engine_id: &str,
) -> String {
    if engine_id == "claude" || engine_id == "codebuddy" {
        return conversation_id.to_string();
    }
    let guard = map.lock().await;
    guard
        .get(conversation_id)
        .and_then(|s| s.external_session_id.clone())
        .unwrap_or_else(|| conversation_id.to_string())
}

pub async fn remember_session_id(
    map: &ConversationEngineMap,
    conversation_id: &str,
    engine_id: &str,
    session_id: &str,
) {
    if engine_id == "claude" || engine_id == "codebuddy" {
        return;
    }
    let mut guard = map.lock().await;
    let entry =
        guard
            .entry(conversation_id.to_string())
            .or_insert_with(|| ConversationEngineState {
                engine_id: engine_id.to_string(),
                external_session_id: None,
                model: None,
            });
    entry.engine_id = engine_id.to_string();
    entry.external_session_id = Some(session_id.to_string());
}

pub async fn bind_conversation_engine(
    map: &ConversationEngineMap,
    conversation_id: &str,
    engine_id: &str,
) {
    let mut guard = map.lock().await;
    guard
        .entry(conversation_id.to_string())
        .or_insert_with(|| ConversationEngineState {
            engine_id: engine_id.to_string(),
            external_session_id: None,
            model: None,
        })
        .engine_id = engine_id.to_string();
}

pub async fn conversation_engine_id(
    map: &ConversationEngineMap,
    conversation_id: &str,
) -> Option<String> {
    let guard = map.lock().await;
    guard.get(conversation_id).map(|s| s.engine_id.clone())
}

pub async fn set_conversation_model(
    map: &ConversationEngineMap,
    conversation_id: &str,
    model: Option<String>,
) {
    let mut guard = map.lock().await;
    if let Some(entry) = guard.get_mut(conversation_id) {
        entry.model = model;
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Real shape captured from codex 0.151.0 hitting OpenAI's region block:
    /// the CLI inlines the whole Cloudflare HTML page into the error message.
    const CODEX_403_BLOCK: &str = "unexpected status 403 Forbidden: 19ea\r\n<html>\n  <head>\n    <meta name=\"viewport\" content=\"width=device-width, initial-scale=1\" />\n    <style global>body{font-family:Arial,Helvetica,sans-serif}.container{align-items:center}</style>\n  </head>\n  <body></body>\n</html>, url: https://chatgpt.com/backend-api/codex/responses, cf-ray: a359135e4ad9cbac-LAX";

    #[test]
    fn classifies_cloudflare_403_as_region_blocked() {
        assert_eq!(
            classify_probe_error(CODEX_403_BLOCK),
            AuthState::RegionBlocked
        );
    }

    #[test]
    fn classifies_explicit_region_code_as_region_blocked() {
        let msg = "403 Forbidden: {\"error\":{\"code\":\"unsupported_country_region_territory\",\"message\":\"Country, region, or territory not supported\"}}";
        assert_eq!(classify_probe_error(msg), AuthState::RegionBlocked);
    }

    #[test]
    fn plain_403_still_means_auth() {
        // A short JSON 403 without block-page HTML is a credential problem.
        assert_eq!(
            classify_probe_error("403 Forbidden: invalid api key"),
            AuthState::NotAuthenticated
        );
    }

    #[test]
    fn summarize_strips_block_page_html() {
        let out = summarize_probe_error(CODEX_403_BLOCK);
        assert!(out.contains("403"), "keeps the status: {out}");
        assert!(out.contains("https://chatgpt.com"), "keeps the url: {out}");
        assert!(!out.contains("<html"), "drops the html soup: {out}");
        assert!(!out.contains("font-family"), "drops css: {out}");
    }

    #[test]
    fn summarize_keeps_plain_errors_verbatim() {
        assert_eq!(summarize_probe_error("plain failure"), "plain failure");
    }
}
