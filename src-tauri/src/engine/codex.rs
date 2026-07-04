use super::{shared, EngineStatus, NormalizedEvent, UsageInfo};
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
pub async fn spawn_headless(
    _session_id: &str,
    message: &str,
    cwd: Option<&str>,
) -> Result<Child> {
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
// Codex uses a different format than Claude:
// - {"type":"turn.started"}
// - {"type":"item.completed","item":{"type":"agent_message","text":"..."}}
// - {"type":"turn.completed","usage":{...}}
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

    #[serde(rename = "item.completed")]
    ItemCompleted {
        item: CodexItem,
    },

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
    text: Option<String>,
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

impl CodexStreamEvent {
    fn streaming_text(&self) -> Option<String> {
        match self {
            CodexStreamEvent::ItemCompleted { item } => item.text.clone(),
            _ => None,
        }
    }

    fn session_id(&self) -> Option<String> {
        match self {
            CodexStreamEvent::ThreadStarted { thread_id } => thread_id.clone(),
            _ => None,
        }
    }

    fn is_final(&self) -> bool {
        matches!(self, CodexStreamEvent::TurnCompleted { .. })
    }

    fn is_error(&self) -> bool {
        matches!(self, CodexStreamEvent::Error { .. })
    }

    fn final_text(&self) -> Option<String> {
        match self {
            CodexStreamEvent::TurnCompleted { .. } => None, // Text comes from ItemCompleted
            CodexStreamEvent::Error { error } => error
                .message
                .clone()
                .or_else(|| Some("Unknown error".to_string())),
            _ => None,
        }
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

    // Handle session establishment from thread.started events
    if let Some(session_id) = evt.session_id() {
        out.push(NormalizedEvent::SessionEstablished {
            session_id,
        });
    }

    // Handle text from item.completed events
    if let Some(text) = evt.streaming_text() {
        // Check if this is an agent_message (final response)
        let is_agent_message = matches!(&evt, CodexStreamEvent::ItemCompleted { item } if item.item_type == "agent_message");
        
        if is_agent_message {
            // For agent_message, emit only a Final event (not streaming)
            out.push(NormalizedEvent::Final {
                text,
            });
        } else {
            // For other item types, emit as TextDelta
            out.push(NormalizedEvent::TextDelta {
                text,
                event_type: "delta",
            });
        }
    }

    // Handle usage from turn.completed events
    if let Some(u) = evt.usage() {
        out.push(NormalizedEvent::Usage(u));
    }

    // Handle errors
    if evt.is_error() {
        if let Some(text) = evt.final_text() {
            out.push(NormalizedEvent::Error { message: text });
        }
    }

    out
}
