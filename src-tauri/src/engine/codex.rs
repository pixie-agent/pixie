use super::{shared, EngineStatus, NormalizedEvent, ToolEvent, ToolEventKind, UsageInfo};
use anyhow::{Context, Result};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::path::PathBuf;
use std::process::Stdio;
use tokio::process::Child;

const CODEX_BINARY_NAMES: &[&str] = &["codex"];

const ENV_PREFIXES: &[&str] = &["CODEX_", "OPENAI_", "GITHUB_"];

pub async fn collect_env() -> HashMap<String, String> {
    shared::collect_env("codex", ENV_PREFIXES, shared::ENV_EXACT).await
}

pub fn find_codex_binary() -> Result<PathBuf> {
    shared::find_binary(CODEX_BINARY_NAMES, "codex CLI")
}

pub async fn get_codex_version() -> Result<String> {
    let binary = find_codex_binary()?;
    let env = collect_env().await;
    let output = shared::run_with_env(&binary, &["--version"], &env).await?;
    if !output.status.success() {
        anyhow::bail!("codex --version returned non-zero exit status");
    }
    Ok(String::from_utf8_lossy(&output.stdout).trim().to_string())
}

/// List known Codex models.
/// Codex supports various OpenAI models; we provide common ones here.
pub async fn list_models() -> Vec<(String, String)> {
    log::info!("[list_models] codex: starting");
    let models = vec![
        ("gpt-4o".to_string(), "GPT-4o".to_string()),
        ("gpt-4o-mini".to_string(), "GPT-4o Mini".to_string()),
        ("o1".to_string(), "o1".to_string()),
        ("o1-mini".to_string(), "o1 Mini".to_string()),
        ("o3".to_string(), "o3".to_string()),
        ("gpt-4-turbo".to_string(), "GPT-4 Turbo".to_string()),
        ("gpt-4".to_string(), "GPT-4".to_string()),
        ("gpt-3.5-turbo".to_string(), "GPT-3.5 Turbo".to_string()),
    ];
    log::info!("[list_models] codex: returning {} models", models.len());
    models
}

pub async fn check_available() -> EngineStatus {
    match find_codex_binary() {
        Ok(path) => {
            let path_str = path.display().to_string();
            match get_codex_version().await {
                Ok(version) => EngineStatus::basic(
                    "codex",
                    "OpenAI Codex",
                    true,
                    Some(version),
                    Some(path_str),
                    None,
                ),
                Err(e) => EngineStatus::basic(
                    "codex",
                    "OpenAI Codex",
                    true,
                    None,
                    Some(path_str),
                    Some(e.to_string()),
                ),
            }
        }
        Err(e) => EngineStatus::basic(
            "codex",
            "OpenAI Codex",
            false,
            None,
            None,
            Some(e.to_string()),
        ),
    }
}

/// Spawn a one-shot Codex process for the readiness probe.
/// Uses minimal flags with a tiny prompt.
pub async fn spawn_probe() -> Result<Child> {
    let binary = find_codex_binary()?;
    let env = collect_env().await;
    let args: Vec<String> = vec![
        "exec".into(),
        "--json".into(),
        "--ephemeral".into(),
        "--dangerously-bypass-approvals-and-sandbox".into(),
    ];
    shared::spawn_probe_child(binary, &args, "ping", None, &env).await
}

/// Spawn the one-click login flow (`codex login`), which opens a browser.
pub async fn spawn_login() -> Result<()> {
    let binary = find_codex_binary()?;
    let env = collect_env().await;
    let args: Vec<String> = vec!["login".into()];
    shared::spawn_detached(binary, &args, &env).await
}

async fn spawn_with_args(
    args: Vec<String>,
    message: &str,
    cwd: Option<&str>,
    model_override: Option<&str>,
) -> Result<Child> {
    let binary = find_codex_binary()?;
    let env = collect_env().await;

    let mut cmd = shared::engine_command(&binary);
    cmd.args(args)
        .arg(message)
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::null());

    if let Some(dir) = cwd {
        cmd.current_dir(dir);
    }

    // Add model override if provided
    if let Some(model) = model_override.filter(|s| !s.is_empty()) {
        cmd.arg("-m").arg(model);
    }

    for (k, v) in &env {
        cmd.env(k, v);
    }

    // Detach from the controlling terminal
    shared::detach_from_controlling_terminal(&mut cmd);

    cmd.spawn().context("failed to spawn codex process")
}

/// Spawn an interactive Codex process.
///
/// NOTE: we deliberately do NOT pass `--ephemeral` here. `--ephemeral` skips
/// persisting the session rollout to `~/.codex/sessions/`, which would make the
/// `thread_id` we capture from `thread.started` unresumable — `codex exec resume
/// <thread_id>` then fails with "no rollout found for thread id". Persisting the
/// session is what lets `spawn_continue` resume this conversation on the next
/// turn. (`spawn_probe` and `spawn_headless` legitimately use `--ephemeral`
/// since those are one-shot runs that never need resuming.)
pub async fn spawn_single(
    _session_id: &str,
    message: &str,
    cwd: Option<&str>,
    model: Option<&str>,
) -> Result<Child> {
    spawn_with_args(
        vec![
            "exec".into(),
            "--json".into(),
            "--dangerously-bypass-approvals-and-sandbox".into(),
        ],
        message,
        cwd,
        model,
    )
    .await
}

pub async fn spawn_continue(
    session_id: &str,
    message: &str,
    cwd: Option<&str>,
    model: Option<&str>,
) -> Result<Child> {
    let binary = find_codex_binary()?;
    let env = collect_env().await;

    let mut cmd = shared::engine_command(&binary);
    // codex exec resume <session_id> <message>
    cmd.args([
        "exec".into(),
        "resume".into(),
        session_id.to_string(),
        "--json".into(),
        "--dangerously-bypass-approvals-and-sandbox".into(),
    ])
    .arg(message)
    // The prompt is the trailing positional arg. stdin MUST be null: codex
    // appends any piped stdin as a `<stdin>` block (and prints "Reading
    // additional input from stdin..."), which would block or pollute the
    // prompt when launched from the Tauri app.
    .stdin(Stdio::null())
    .stdout(Stdio::piped())
    .stderr(Stdio::null());

    if let Some(dir) = cwd {
        cmd.current_dir(dir);
    }

    // Add model override if provided
    if let Some(model) = model.filter(|s| !s.is_empty()) {
        cmd.arg("-m").arg(model);
    }

    for (k, v) in &env {
        cmd.env(k, v);
    }

    // Detach from the controlling terminal
    shared::detach_from_controlling_terminal(&mut cmd);

    cmd.spawn().context("failed to spawn codex process")
}

/// Spawn a headless Codex process for scheduled tasks.
pub async fn spawn_headless(_session_id: &str, message: &str, cwd: Option<&str>) -> Result<Child> {
    spawn_with_args(
        vec![
            "exec".into(),
            "--json".into(),
            "--ephemeral".into(),
            "--dangerously-bypass-approvals-and-sandbox".into(),
        ],
        message,
        cwd,
        None,
    )
    .await
}

// ---------------------------------------------------------------------------
// Codex stream-json parsing
//
// Codex emits one JSON object per line. The shape we care about:
// - {"type":"thread.started","thread_id":"<uuid>"}     — session id (for resume)
// - {"type":"turn.started"} / {"type":"turn.completed","usage":{...}}
// - {"type":"item.started","item":{...}}               — tool call begins
// - {"type":"item.completed","item":{...}}             — tool result OR final text
// - {"type":"error","error":{...}}
//
// Item `type`s seen from codex 0.142.x:
// - `agent_message`     — the agent's final answer (only on item.completed); has `text`
// - `command_execution` — a shell command; has `command`, `aggregated_output`, `exit_code`
//   (codex does file edits, searches, etc. through the shell, so this is the workhorse)
// Other item types (file_change, web_search, mcp_tool_call, ...) are surfaced as
// generic tool steps using their `type` as the name.
// ---------------------------------------------------------------------------

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "type")]
enum CodexStreamEvent {
    #[serde(rename = "turn.started")]
    TurnStarted,

    #[serde(rename = "turn.completed")]
    TurnCompleted {
        #[serde(default)]
        usage: Option<CodexUsage>,
    },

    #[serde(rename = "item.started")]
    ItemStarted { item: CodexItem },

    #[serde(rename = "item.completed")]
    ItemCompleted { item: CodexItem },

    #[serde(rename = "error")]
    Error { error: ErrorData },

    #[serde(rename = "thread.started")]
    ThreadStarted {
        #[serde(default)]
        thread_id: Option<String>,
    },
}

#[derive(Debug, Clone, Serialize, Deserialize)]
struct CodexItem {
    id: Option<String>,
    #[serde(rename = "type")]
    item_type: String,
    // agent_message
    #[serde(default)]
    text: Option<String>,
    // command_execution
    #[serde(default)]
    command: Option<String>,
    #[serde(default)]
    aggregated_output: Option<String>,
    #[serde(default)]
    exit_code: Option<i64>,
    #[serde(default)]
    status: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
struct CodexUsage {
    #[serde(default)]
    input_tokens: Option<u64>,
    #[serde(default)]
    output_tokens: Option<u64>,
    #[serde(default)]
    cached_input_tokens: Option<u64>,
    #[serde(default)]
    reasoning_output_tokens: Option<u64>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
struct ErrorData {
    #[serde(default)]
    message: Option<String>,
    #[serde(default)]
    code: Option<String>,
}

impl CodexItem {
    fn is_agent_message(&self) -> bool {
        self.item_type == "agent_message"
    }

    /// Display name surfaced to the UI. `command_execution` maps to `bash` so
    /// the frontend renders it as "Run command" with `input.command` (matching
    /// Claude/Cursor); anything else uses its codex `type` as the name.
    fn tool_name(&self) -> String {
        match self.item_type.as_str() {
            "command_execution" => "bash".to_string(),
            other => other.to_string(),
        }
    }

    /// JSON-serialized input for the tool's Start event (the frontend parses it).
    fn tool_input_json(&self) -> Option<String> {
        match self.item_type.as_str() {
            "command_execution" => self
                .command
                .as_ref()
                .map(|c| serde_json::json!({ "command": c }).to_string()),
            _ => None,
        }
    }

    /// (output text, is_error) for the tool's Result event.
    fn tool_result(&self) -> (Option<String>, bool) {
        let content = self.aggregated_output.clone();
        let is_error = self
            .exit_code
            .map(|c| c != 0)
            .unwrap_or_else(|| self.status.as_deref() == Some("failed"));
        (content, is_error)
    }
}

impl CodexStreamEvent {
    fn session_id(&self) -> Option<String> {
        match self {
            CodexStreamEvent::ThreadStarted { thread_id } => thread_id.clone(),
            _ => None,
        }
    }

    fn error_message(&self) -> Option<String> {
        match self {
            CodexStreamEvent::Error { error } => Some(
                error
                    .message
                    .clone()
                    .unwrap_or_else(|| "Unknown error".to_string()),
            ),
            _ => None,
        }
    }

    /// Normalize an `item.started` / `item.completed` event into tool/text events.
    /// - agent_message (completed) → Final
    /// - any other item (a tool) → Tool Start on `item.started`, Tool Result on
    ///   `item.completed`
    fn item_events(&self) -> Vec<NormalizedEvent> {
        let (item, completed) = match self {
            CodexStreamEvent::ItemStarted { item } => (item, false),
            CodexStreamEvent::ItemCompleted { item } => (item, true),
            _ => return vec![],
        };

        // The agent's final answer only arrives on item.completed.
        if item.is_agent_message() {
            if completed {
                if let Some(text) = item.text.clone() {
                    return vec![NormalizedEvent::Final { text }];
                }
            }
            return vec![];
        }

        let id = item.id.clone().unwrap_or_default();
        let tool = if completed {
            let (content, is_error) = item.tool_result();
            ToolEvent {
                id,
                kind: ToolEventKind::Result { content, is_error },
            }
        } else {
            ToolEvent {
                id,
                kind: ToolEventKind::Start {
                    name: Some(item.tool_name()),
                    input: item.tool_input_json(),
                },
            }
        };
        vec![NormalizedEvent::Tool(tool)]
    }

    fn usage(&self) -> Option<UsageInfo> {
        match self {
            CodexStreamEvent::TurnCompleted { usage } => {
                let u = usage.as_ref()?;
                let input = u.input_tokens.unwrap_or(0);
                let output = u.output_tokens.unwrap_or(0);
                let cache_read = u.cached_input_tokens.unwrap_or(0);

                if input == 0 && output == 0 && cache_read == 0 {
                    return None;
                }

                Some(UsageInfo {
                    kind: "final",
                    input_tokens: input,
                    output_tokens: output,
                    cache_read_tokens: cache_read,
                    cache_creation_tokens: 0,
                    cost_usd: None,
                    duration_ms: None,
                    num_turns: None,
                    model: None,
                    stop_reason: None,
                })
            }
            _ => None,
        }
    }
}

fn parse_stream_line(line: &str) -> Option<CodexStreamEvent> {
    let line = line.trim();
    if line.is_empty() {
        return None;
    }

    // Try to parse as a Codex event
    if let Ok(evt) = serde_json::from_str::<CodexStreamEvent>(line) {
        return Some(evt);
    }

    None
}

pub fn parse_line(line: &str) -> Vec<NormalizedEvent> {
    if shared::is_ignorable_stream_line(line) {
        return vec![];
    }

    let Some(evt) = parse_stream_line(line) else {
        return vec![];
    };

    let mut out = Vec::new();

    // Session id from the initial thread.started event (used to resume later).
    if let Some(session_id) = evt.session_id() {
        out.push(NormalizedEvent::SessionEstablished { session_id });
    }

    // Tool calls (item.started/completed) and the final agent message.
    out.extend(evt.item_events());

    // Usage from turn.completed.
    if let Some(u) = evt.usage() {
        out.push(NormalizedEvent::Usage(u));
    }

    // Errors.
    if let Some(message) = evt.error_message() {
        out.push(NormalizedEvent::Error { message });
    }

    out
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_thread_started_as_session() {
        let line =
            r#"{"type":"thread.started","thread_id":"019f2ac9-ef7e-7801-b981-4a3afe9255db"}"#;
        let events = parse_line(line);
        assert_eq!(events.len(), 1);
        assert!(matches!(
            &events[0],
            NormalizedEvent::SessionEstablished { session_id }
                if session_id == "019f2ac9-ef7e-7801-b981-4a3afe9255db"
        ));
    }

    #[test]
    fn parses_command_execution_start_as_bash_tool() {
        // Real shape from codex 0.142.x: item.started carries the command.
        let line = r#"{"type":"item.started","item":{"id":"item_0","type":"command_execution","command":"/bin/zsh -lc ls","aggregated_output":"","exit_code":null,"status":"in_progress"}}"#;
        let events = parse_line(line);
        assert_eq!(events.len(), 1);
        match &events[0] {
            NormalizedEvent::Tool(ToolEvent {
                id,
                kind: ToolEventKind::Start { name, input },
            }) => {
                assert_eq!(id, "item_0");
                assert_eq!(name.as_deref(), Some("bash"));
                // input must be valid JSON the frontend can parse, carrying the command.
                let parsed: serde_json::Value =
                    serde_json::from_str(input.as_deref().unwrap()).unwrap();
                assert_eq!(parsed["command"], "/bin/zsh -lc ls");
            }
            other => panic!("expected Tool Start, got {other:?}"),
        }
    }

    #[test]
    fn parses_command_execution_completed_as_tool_result() {
        let line = r#"{"type":"item.completed","item":{"id":"item_0","type":"command_execution","command":"/bin/zsh -lc ls","aggregated_output":"README.md\nsrc\n","exit_code":0,"status":"completed"}}"#;
        let events = parse_line(line);
        assert_eq!(events.len(), 1);
        match &events[0] {
            NormalizedEvent::Tool(ToolEvent {
                id,
                kind: ToolEventKind::Result { content, is_error },
            }) => {
                assert_eq!(id, "item_0");
                assert_eq!(content.as_deref(), Some("README.md\nsrc\n"));
                assert!(!*is_error);
            }
            other => panic!("expected Tool Result, got {other:?}"),
        }
    }

    #[test]
    fn parses_failed_command_as_error_result() {
        let line = r#"{"type":"item.completed","item":{"id":"item_2","type":"command_execution","command":"/bin/zsh -lc false","aggregated_output":"","exit_code":1,"status":"completed"}}"#;
        let events = parse_line(line);
        match &events[0] {
            NormalizedEvent::Tool(ToolEvent {
                kind: ToolEventKind::Result { is_error, .. },
                ..
            }) => assert!(*is_error),
            other => panic!("expected Tool Result, got {other:?}"),
        }
    }

    #[test]
    fn parses_agent_message_as_final() {
        let line = r#"{"type":"item.completed","item":{"id":"item_1","type":"agent_message","text":"There are 6 .md files."}}"#;
        let events = parse_line(line);
        assert_eq!(events.len(), 1);
        assert!(matches!(
            &events[0],
            NormalizedEvent::Final { text } if text == "There are 6 .md files."
        ));
    }

    #[test]
    fn parses_turn_completed_usage() {
        let line = r#"{"type":"turn.completed","usage":{"input_tokens":12254,"cached_input_tokens":9600,"output_tokens":6,"reasoning_output_tokens":0}}"#;
        let events = parse_line(line);
        assert_eq!(events.len(), 1);
        match &events[0] {
            NormalizedEvent::Usage(u) => {
                assert_eq!(u.input_tokens, 12254);
                assert_eq!(u.output_tokens, 6);
                assert_eq!(u.cache_read_tokens, 9600);
            }
            other => panic!("expected Usage, got {other:?}"),
        }
    }

    #[test]
    fn ignores_empty_turn_started() {
        assert!(parse_line(r#"{"type":"turn.started"}"#).is_empty());
    }
}
