//! Persistent (long-lived) agent sessions.
//!
//! Instead of spawning a new CLI process for every user message and reconnecting
//! via `--resume`, we keep the CLI process alive and pipe subsequent messages
//! through its stdin using `--input-format stream-json`. This eliminates the
//! overhead of re-loading session history on every turn.
//!
//! Only Claude and CodeBuddy support `--input-format stream-json`. Cursor Agent
//! falls back to the per-message `--resume` model.

use anyhow::{Context, Result};
use std::collections::HashMap;
use std::sync::Arc;
use std::time::{Duration, Instant};
use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader};
use tokio::process::{Child, ChildStdin, ChildStdout};
use tokio::sync::Mutex;

use super::shared::{self, detach_from_controlling_terminal};
use super::{parse_line, NormalizedEvent};

// ---------------------------------------------------------------------------
// Tunables for long-running turn resilience
// ---------------------------------------------------------------------------

/// How long a single `read_line` may block before we consider the stream
/// stalled. A healthy CLI emits heartbeat/progress lines frequently, so a
/// silence longer than this strongly implies the process is wedged (OOM,
/// network partition, OS suspend/resume, etc.). On timeout we re-check whether
/// the child is still alive and otherwise let the caller decide to retry.
pub const READ_HEARTBEAT_TIMEOUT: Duration = Duration::from_secs(180);

/// Hard ceiling on how many times a single turn will be transparently retried
/// after an unexpected EOF/read error before surfacing the failure to the user.
pub const MAX_TURN_RETRIES: usize = 2;

/// How many consecutive heartbeat timeouts (each `READ_HEARTBEAT_TIMEOUT` long)
/// we tolerate before declaring an alive-but-silent process wedged and treating
/// it as a crash. This bounds the worst case: a process that hangs without
/// exiting or emitting anything is recovered via `--resume` instead of looping
/// forever. With the defaults (180s × 3) a genuinely-thinking agent gets ~9
/// minutes of silence per attempt before we give up on that attempt — far
/// beyond any normal tool/think duration — while a truly stuck process is
/// still recovered in bounded time.
pub const MAX_HEARTBEAT_TIMEOUTS: usize = 3;

/// A structured outcome of one read attempt, used so the caller can distinguish
/// a clean final result from a recoverable mid-turn crash (and decide whether
/// to retry with `--resume`).
///
/// The `partial` fields preserve whatever text was streamed before a
/// stop/crash; callers that want to surface partial results (rather than
/// discarding them on retry) can use them. The persistent path currently
/// retries and so discards `partial`, hence the `allow(dead_code)`.
#[derive(Debug)]
#[allow(dead_code)]
pub enum TurnOutcome {
    /// The turn completed normally (a `result`/final event was received).
    Done(String),
    /// The CLI emitted an explicit error event and then ended the turn. This is
    /// a *terminal* outcome (the model/CLI gave up — e.g. rate limit, content
    /// filter, upstream API error) — it must NOT be retried (re-sending the
    /// same message would just hit the same error again) and it must NOT emit
    /// `agent-done`, because the error event was already forwarded to the
    /// frontend via `on_events` (which emitted `agent-error` and marked the
    /// message as errored). The streamed partial text is preserved for callers
    /// that want to surface it.
    Errored(String),
    /// The user (or a model swap) deliberately stopped this turn. The streamed
    /// partial output is preserved in `partial`.
    Stopped { partial: String },
    /// The CLI process died unexpectedly mid-turn. `partial` holds whatever was
    /// streamed before the crash; `reason` is a human-readable diagnosis
    /// (exit code / EOF / read error) suitable for logs and retries.
    Crashed { partial: String, reason: String },
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/// Idle sessions are shut down after this duration.
pub const IDLE_TIMEOUT: Duration = Duration::from_secs(1800); // 30 minutes

/// Maximum number of persistent sessions kept alive simultaneously.
pub const MAX_SESSIONS: usize = 10;

// ---------------------------------------------------------------------------
// PersistentSession
// ---------------------------------------------------------------------------

/// A long-lived CLI agent process whose stdin stays open for multi-turn input.
#[allow(dead_code)]
pub struct PersistentSession {
    pub session_id: String,
    pub engine_id: String,
    pub last_active: Instant,
    /// The model override used when spawning this session. Used to detect when
    /// the per-conversation model has changed and the session must be respawned.
    pub model_override: Option<String>,

    child: Child,
    stdin: ChildStdin,
    /// The stdout reader is stored behind a Mutex so that the streaming task
    /// (which reads lines) can run independently of `send_message` (which
    /// writes to stdin).
    stdout: Arc<Mutex<BufReader<ChildStdout>>>,
}

/// Lowercase extension of `path` ("" when none).
fn ext_of(path: &str) -> String {
    std::path::Path::new(path)
        .extension()
        .and_then(|e| e.to_str())
        .unwrap_or("")
        .to_lowercase()
}

/// MIME type for extensions Claude/CodeBuddy accept as **native** image content
/// blocks. Returns `None` for everything else (incl. svg/bmp/ico) so those fall
/// back to a `@mention` text block instead of an invalid image block.
fn media_type_for_ext(ext: &str) -> Option<&'static str> {
    match ext {
        "png" => Some("image/png"),
        "jpg" | "jpeg" => Some("image/jpeg"),
        "gif" => Some("image/gif"),
        "webp" => Some("image/webp"),
        _ => None,
    }
}

/// JSONL message format for `--input-format stream-json`.
///
/// Builds the `content` array from the text and any image attachments. Images
/// whose extension maps to a native block are read from disk and embedded as
/// `{"type":"image",...}` base64 blocks — the most reliable vision path, since
/// it bypasses the engine's `@`-mention→read resolution. Images we can't send
/// natively (unsupported type, or unreadable) degrade to a `@<path>` text block
/// so the engine still gets them via the existing mention behavior. A text block
/// is omitted when the body is empty (image-only turns are valid); the array is
/// never left empty.
fn format_user_message(text: &str, images: &[String]) -> String {
    use base64::{engine::general_purpose::STANDARD, Engine};
    use serde_json::{json, Value};

    let mut content: Vec<Value> = Vec::new();
    if !text.is_empty() {
        content.push(json!({"type": "text", "text": text}));
    }
    for path in images {
        match media_type_for_ext(&ext_of(path)) {
            Some(media_type) => match std::fs::read(path) {
                Ok(bytes) => {
                    let data = STANDARD.encode(&bytes);
                    content.push(json!({
                        "type": "image",
                        "source": {"type": "base64", "media_type": media_type, "data": data}
                    }));
                }
                Err(e) => {
                    log::warn!(
                        "[persistent] failed to read image {path}: {e}; sending as @mention"
                    );
                    content.push(json!({"type": "text", "text": format!("@{path}")}));
                }
            },
            None => {
                // Unsupported native-image type — keep the current @mention behavior.
                content.push(json!({"type": "text", "text": format!("@{path}")}));
            }
        }
    }
    if content.is_empty() {
        content.push(json!({"type": "text", "text": ""}));
    }
    json!({"type": "user", "message": {"role": "user", "content": content}}).to_string()
}

/// Format a permission response for `--input-format stream-json`.
/// When the agent emits a `permission_request`, the integrator must respond
/// with either `allow` or `deny`.
fn format_permission_response(allow: bool, message: Option<&str>) -> String {
    let behavior = if allow { "allow" } else { "deny" };
    match message {
        Some(msg) => {
            let escaped = msg
                .replace('\\', "\\\\")
                .replace('"', "\\\"")
                .replace('\n', "\\n");
            format!(
                r#"{{"type":"permission_response","behavior":"{behavior}","message":"{escaped}"}}"#
            )
        }
        None => format!(r#"{{"type":"permission_response","behavior":"{behavior}"}}"#),
    }
}

impl PersistentSession {
    /// Spawn a persistent CLI process with `--input-format stream-json`.
    ///
    /// If `resume` is true, the session is reconnected via `--resume`.
    /// If `resume` is false, a new session is created via `--session-id`.
    pub async fn spawn(
        engine_id: &str,
        session_id: &str,
        resume: bool,
        cwd: Option<&str>,
        model_override: Option<&str>,
    ) -> Result<Self> {
        let (binary, args, env) =
            build_persistent_command(engine_id, session_id, resume, model_override).await?;

        let mut cmd = shared::engine_command(&binary);
        cmd.args(&args)
            .stdin(std::process::Stdio::piped()) // stdin stays open
            .stdout(std::process::Stdio::piped())
            .stderr(std::process::Stdio::null());

        if let Some(dir) = cwd {
            cmd.current_dir(dir);
        }

        for (k, v) in &env {
            cmd.env(k, v);
        }

        detach_from_controlling_terminal(&mut cmd);

        let mut child = cmd
            .spawn()
            .with_context(|| format!("failed to spawn persistent {engine_id} process"))?;

        let stdin = child.stdin.take().context("stdin not captured")?;
        let stdout = child.stdout.take().context("stdout not captured")?;
        let stdout = Arc::new(Mutex::new(BufReader::new(stdout)));

        Ok(Self {
            session_id: session_id.to_string(),
            engine_id: engine_id.to_string(),
            last_active: Instant::now(),
            model_override: model_override.map(|s| s.to_string()),
            child,
            stdin,
            stdout,
        })
    }

    /// Write a user message (plus any image attachments) to the process stdin.
    /// `images` are absolute paths embedded as native image content blocks when
    /// supported (see `format_user_message`).
    pub async fn send_message(&mut self, message: &str, images: &[String]) -> Result<()> {
        let jsonl = format_user_message(message, images);
        self.stdin
            .write_all(jsonl.as_bytes())
            .await
            .with_context(|| "failed to write message to stdin")?;
        self.stdin
            .write_all(b"\n")
            .await
            .with_context(|| "failed to write newline to stdin")?;
        self.stdin
            .flush()
            .await
            .with_context(|| "failed to flush stdin")?;
        self.last_active = Instant::now();
        Ok(())
    }

    /// Write a permission response to the process stdin (approve or deny a
    /// tool permission request). The CLI emits a `permission_request` event
    /// and blocks until it receives this response via stdin.
    pub async fn respond_permission(&mut self, allow: bool, message: Option<&str>) -> Result<()> {
        let jsonl = format_permission_response(allow, message);
        log::info!(
            "[respond_permission] writing permission response: allow={}",
            allow
        );
        self.stdin
            .write_all(jsonl.as_bytes())
            .await
            .with_context(|| "failed to write permission response to stdin")?;
        self.stdin
            .write_all(b"\n")
            .await
            .with_context(|| "failed to write newline to stdin")?;
        self.stdin
            .flush()
            .await
            .with_context(|| "failed to flush stdin")?;
        self.last_active = Instant::now();
        Ok(())
    }

    /// Check if the child process is still alive (non-blocking).
    pub fn is_alive(&mut self) -> bool {
        match self.child.try_wait() {
            Ok(Some(_status)) => false, // exited
            Ok(None) => true,           // still running
            Err(_) => false,            // error → assume dead
        }
    }

    /// Produce a human-readable diagnosis of *why* the child is no longer
    /// producing output. Reaps the child if it has exited so we can read its
    /// exit status. Safe to call repeatedly (returns the same status once
    /// reaped).
    pub async fn diagnose_exit(&mut self) -> String {
        match self.child.try_wait() {
            Ok(Some(status)) => {
                if status.success() {
                    "process exited cleanly (stdout closed before final event)".to_string()
                } else {
                    #[cfg(unix)]
                    {
                        use std::os::unix::process::ExitStatusExt;
                        if let Some(sig) = status.signal() {
                            return format!(
                                "process killed by signal {sig} (likely OOM, manual kill, or crash)"
                            );
                        }
                    }
                    format!(
                        "process exited with status {} (crashed)",
                        status.code().unwrap_or(-1)
                    )
                }
            }
            Ok(None) => {
                // Still alive but stdout is closed/wedged — the process is stuck
                // without producing output. Most common causes: network
                // partition to the model API, OS suspend/resume, or an
                // internal deadlock in the CLI.
                "process still alive but stdout stalled (no output for an extended period)"
                    .to_string()
            }
            Err(e) => format!("failed to query process status: {e}"),
        }
    }

    /// Best-effort health probe used before reusing a cached session: confirms
    /// the child is running. A session that is alive but mid-turn (stdout lock
    /// held) is treated as healthy — we simply must not reuse it concurrently.
    #[allow(dead_code)]
    pub async fn is_healthy(&mut self) -> bool {
        self.is_alive()
    }

    /// Get the PID of the child process.
    pub fn pid(&self) -> Option<u32> {
        self.child.id()
    }

    /// Gracefully shut down the session by closing stdin (the CLI exits when
    /// stdin closes in `--print` mode).
    #[allow(dead_code)]
    pub async fn shutdown(&mut self) {
        // Drop stdin → the CLI sees EOF on stdin and exits.
        let _ = self.stdin.shutdown().await;
        // Wait briefly for the process to exit.
        let _ = tokio::time::timeout(Duration::from_secs(5), self.child.wait()).await;
    }

    /// Kill the process immediately (SIGKILL).
    pub async fn kill(&mut self) {
        let _ = self.child.kill().await;
        let _ = self.child.wait().await;
    }

    /// Get a reference to the shared stdout reader for streaming reads.
    pub fn stdout(&self) -> Arc<Mutex<BufReader<ChildStdout>>> {
        Arc::clone(&self.stdout)
    }
}

impl Drop for PersistentSession {
    fn drop(&mut self) {
        // Best-effort: try to kill on drop if still running.
        // We can't do async here, so we just signal intent.
        if let Some(id) = self.child.id() {
            // Send SIGTERM on Unix. The process will be reaped by the OS
            // when the parent (us) exits, or by the next wait().
            #[cfg(unix)]
            unsafe {
                libc::kill(id as i32, libc::SIGTERM);
            }
        }
    }
}

// ---------------------------------------------------------------------------
// SessionMap — global state
// ---------------------------------------------------------------------------

pub type SessionMap = Arc<Mutex<HashMap<String, PersistentSession>>>;

pub fn init_session_map() -> SessionMap {
    Arc::new(Mutex::new(HashMap::new()))
}

// ---------------------------------------------------------------------------
// Build the CLI command for a persistent session
// ---------------------------------------------------------------------------

async fn build_persistent_command(
    engine_id: &str,
    session_id: &str,
    resume: bool,
    model_override: Option<&str>,
) -> Result<(
    std::path::PathBuf,
    Vec<String>,
    std::collections::HashMap<String, String>,
)> {
    match engine_id {
        "claude" => {
            let binary = super::claude::find_claude_binary()?;
            let mut env = super::claude::collect_env().await;
            let mut args = vec![
                "--print".into(),
                "--output-format".into(),
                "stream-json".into(),
                "--verbose".into(),
                "--input-format".into(),
                "stream-json".into(),
                "--permission-mode".into(),
                "bypassPermissions".into(),
            ];
            if resume {
                args.push("--resume".into());
            } else {
                args.push("--session-id".into());
            }
            args.push(session_id.into());
            // Per-conversation model override takes precedence over ANTHROPIC_MODEL env var.
            if let Some(model) = model_override.filter(|s| !s.is_empty()) {
                env.insert("ANTHROPIC_MODEL".to_string(), model.to_string());
            }
            Ok((binary, args, env))
        }
        "codebuddy" => {
            let binary = super::codebuddy::find_codebuddy_binary()?;
            let env = super::codebuddy::collect_env().await;
            let mut args = vec![
                "--print".into(),
                "--output-format".into(),
                "stream-json".into(),
                "--input-format".into(),
                "stream-json".into(),
                "--include-partial-messages".into(),
                "--permission-mode".into(),
                "bypassPermissions".into(),
            ];
            if resume {
                args.push("--resume".into());
            } else {
                args.push("--session-id".into());
            }
            args.push(session_id.into());
            // Per-conversation model override takes precedence over CODEBUDDY_MODEL env var.
            let model = model_override.filter(|s| !s.is_empty()).or_else(|| {
                env.get("CODEBUDDY_MODEL")
                    .filter(|s| !s.is_empty())
                    .map(String::as_str)
            });
            if let Some(model) = model {
                args.push("--model".into());
                args.push(model.to_string());
            }
            Ok((binary, args, env))
        }
        other => anyhow::bail!("persistent sessions not supported for engine: {other}"),
    }
}

// ---------------------------------------------------------------------------
// Stream reading for persistent sessions
// ---------------------------------------------------------------------------

/// Read from a persistent session's stdout until a `result` event is received
/// (which signals the end of one turn). The reader is shared via Arc<Mutex<>>,
/// so multiple turns can be read sequentially.
///
/// `is_stopped` is polled before every read so a user-initiated stop (or a
/// mid-stream model swap) is detected promptly even when the CLI hasn't yet
/// closed its stdout. When stopped, the partial text streamed so far is
/// preserved in [`TurnOutcome::Stopped`].
///
/// Instead of `bail!`-ing on EOF/read errors (the old behavior surfaced the
/// opaque "persistent session stdout closed unexpectedly" to users), this now
/// returns [`TurnOutcome::Crashed`] with a diagnosis, letting the caller retry
/// the turn transparently with `--resume`.
pub async fn read_persistent_turn<F, S>(
    engine_id: &str,
    stdout: Arc<Mutex<BufReader<ChildStdout>>>,
    mut on_events: F,
    is_stopped: S,
) -> TurnOutcome
where
    F: FnMut(&[NormalizedEvent]),
    S: Fn() -> bool,
{
    let mut guard = stdout.lock().await;
    let mut final_text = String::new();
    let mut consecutive_heartbeat_timeouts = 0usize;
    let mut ended_with_error = false;

    loop {
        // Check the stop flag first — a stop may have been requested while we
        // were between lines. This makes a stop responsive even when the CLI
        // is mid-tool and not emitting new lines for a while.
        if is_stopped() {
            return TurnOutcome::Stopped {
                partial: std::mem::take(&mut final_text),
            };
        }

        let mut line = String::new();
        // Bound the blocking read so a wedged CLI (no output, no exit — e.g.
        // network partition to the model API, OS suspend) is detected instead
        // of hanging the turn forever. On timeout we re-check `is_stopped` and
        // loop; if the child has actually died, the next read returns EOF.
        let read_result =
            tokio::time::timeout(READ_HEARTBEAT_TIMEOUT, guard.read_line(&mut line)).await;
        match read_result {
            Err(_) => {
                // Timed out waiting for a line. This is not itself fatal — the
                // CLI may just be thinking for a long time — so we normally loop:
                // the next iteration re-checks `is_stopped`, and if the child
                // has died the subsequent read returns EOF. But a process that
                // stays alive yet emits nothing for many heartbeats is wedged
                // (network partition, OS suspend, internal deadlock); after a
                // bounded number of consecutive timeouts we treat it as a crash
                // so the caller can recover via `--resume`.
                consecutive_heartbeat_timeouts += 1;
                if consecutive_heartbeat_timeouts >= MAX_HEARTBEAT_TIMEOUTS {
                    log::error!(
                        "[persistent] stdout stalled for {} consecutive heartbeats (~{:?} total, engine={}); treating as crash",
                        consecutive_heartbeat_timeouts,
                        READ_HEARTBEAT_TIMEOUT * consecutive_heartbeat_timeouts as u32,
                        engine_id
                    );
                    return TurnOutcome::Crashed {
                        partial: std::mem::take(&mut final_text),
                        reason: format!(
                            "agent produced no output for ~{:?} (process appears hung)",
                            READ_HEARTBEAT_TIMEOUT * consecutive_heartbeat_timeouts as u32
                        ),
                    };
                }
                log::warn!(
                    "[persistent] no stdout output for {:?} (engine={}); heartbeat timeout {}/{} — will keep waiting unless stopped",
                    READ_HEARTBEAT_TIMEOUT,
                    engine_id,
                    consecutive_heartbeat_timeouts,
                    MAX_HEARTBEAT_TIMEOUTS
                );
                continue;
            }
            Ok(Ok(0)) => {
                // EOF — the process has closed stdout (likely died).
                return TurnOutcome::Crashed {
                    partial: std::mem::take(&mut final_text),
                    reason: "session stdout closed unexpectedly (EOF)".to_string(),
                };
            }
            Ok(Ok(_)) => {
                // We got a line — the stream is alive. Reset the stall counter.
                consecutive_heartbeat_timeouts = 0;
            }
            Ok(Err(e)) => {
                return TurnOutcome::Crashed {
                    partial: std::mem::take(&mut final_text),
                    reason: format!("error reading session stdout: {e}"),
                };
            }
        }

        let line = line.trim();
        if line.is_empty() || shared::is_ignorable_stream_line(line) {
            continue;
        }

        let events = parse_line(engine_id, line);
        if events.is_empty() {
            continue;
        }

        let mut is_final = false;
        classify_events(
            &events,
            &mut final_text,
            &mut is_final,
            &mut ended_with_error,
        );

        on_events(&events);

        if is_final {
            break;
        }
    }

    if ended_with_error {
        TurnOutcome::Errored(final_text)
    } else {
        TurnOutcome::Done(final_text)
    }
}

/// Inspect a batch of normalized events from one streamed line and update the
/// turn's accumulators:
/// - `final_text` is overwritten when a `Final` event arrives.
/// - `is_final` is set when the batch contains a terminal event (`Final` or
///   `Error`), signaling the read loop to stop.
/// - `ended_with_error` is set when the terminal event was an `Error` (so the
///   caller returns `TurnOutcome::Errored` instead of `Done`, and refrains from
///   emitting `agent-done`).
///
/// Extracted from `read_persistent_turn` so the classification rule can be
/// unit-tested without spawning a real CLI process.
fn classify_events(
    events: &[NormalizedEvent],
    final_text: &mut String,
    is_final: &mut bool,
    ended_with_error: &mut bool,
) {
    for evt in events {
        match evt {
            NormalizedEvent::Final { text } => {
                *final_text = text.clone();
                *is_final = true;
            }
            NormalizedEvent::Error { message: _ } => {
                // The CLI reported an error event — the model/CLI gave up on
                // this turn (rate limit, content filter, upstream API error,
                // etc.). This is a *terminal* outcome, not a crash: we must not
                // retry it (re-sending would hit the same error), and we must
                // not treat it as a clean Done. The error event is forwarded
                // to the frontend by the caller's `on_events` (emitting
                // `agent-error`), so the caller must NOT also emit `agent-done`.
                *ended_with_error = true;
                *is_final = true;
            }
            _ => {}
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn classify_final_event_marks_done_not_errored() {
        let events = vec![NormalizedEvent::Final {
            text: "all done".to_string(),
        }];
        let mut final_text = String::new();
        let mut is_final = false;
        let mut ended_with_error = false;
        classify_events(
            &events,
            &mut final_text,
            &mut is_final,
            &mut ended_with_error,
        );
        assert!(is_final);
        assert!(!ended_with_error, "Final must not set ended_with_error");
        assert_eq!(final_text, "all done");
    }

    #[test]
    fn classify_error_event_marks_errored_not_done() {
        // Regression guard: an explicit CLI Error event must terminate the turn
        // as Errored (terminal, not retried, no agent-done), NOT as a clean
        // Done. The old code treated this as Done and then emitted agent-done,
        // which flipped the frontend message from "error" back to "done" and
        // masked the failure from the user.
        let events = vec![NormalizedEvent::Error {
            message: "rate limited".to_string(),
        }];
        let mut final_text = String::new();
        let mut is_final = false;
        let mut ended_with_error = false;
        classify_events(
            &events,
            &mut final_text,
            &mut is_final,
            &mut ended_with_error,
        );
        assert!(is_final, "Error must terminate the turn");
        assert!(
            ended_with_error,
            "Error must set ended_with_error so the caller returns Errored"
        );
    }

    #[test]
    fn classify_non_terminal_events_do_not_end_turn() {
        let events = vec![NormalizedEvent::TextDelta {
            text: "streaming...".to_string(),
            event_type: "delta",
        }];
        let mut final_text = String::new();
        let mut is_final = false;
        let mut ended_with_error = false;
        classify_events(
            &events,
            &mut final_text,
            &mut is_final,
            &mut ended_with_error,
        );
        assert!(!is_final);
        assert!(!ended_with_error);
        // TextDelta does not overwrite final_text (only Final does).
        assert_eq!(final_text, "");
    }

    #[test]
    fn classify_final_after_error_still_counts_as_errored() {
        // If a Final event arrives in the same batch as an Error, the error
        // wins (ended_with_error stays true) so we never mask an error with a
        // clean Done.
        let events = vec![
            NormalizedEvent::Error {
                message: "oops".to_string(),
            },
            NormalizedEvent::Final {
                text: "partial".to_string(),
            },
        ];
        let mut final_text = String::new();
        let mut is_final = false;
        let mut ended_with_error = false;
        classify_events(
            &events,
            &mut final_text,
            &mut is_final,
            &mut ended_with_error,
        );
        assert!(is_final);
        assert!(ended_with_error);
        assert_eq!(final_text, "partial");
    }
}
