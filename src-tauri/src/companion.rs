//! Companion ("小精灵") — an ambient observer that watches ALL agent activity
//! (interactive conversations on any engine, scheduled tasks, loop tasks) and
//! powers a floating pet window: live activity list, OS notifications at
//! important moments, and a small-model Q&A about progress.
//!
//! Architecture contract with the rest of the app (keep this true):
//!   * This module is a PURE SUBSCRIBER. It never imports companion concerns
//!     into `lib.rs` code paths — it listens to the events the app already
//!     emits (`agent-*`, `task-run-*`, `loop-*`) via `Listener::listen_any`.
//!   * The only additions to existing code are generic observability events
//!     (`agent-turn-started`, `task-run-started`) plus command registration.
//!   * The activity registry is IN-MEMORY ONLY. Conversations that were
//!     running when the app died are dead — rebuilding from live events is
//!     the correct behavior, so nothing is persisted here except prefs and
//!     the pet's own chat history.
//!   * The pet's brain has NO hands by construction: a `BuiltinSession`
//!     built with an EMPTY tool set. It observes and speaks; it never acts.

use std::collections::HashMap;
use std::sync::{Arc, Mutex};

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter, Listener, Manager};

use crate::engine::builtin::BuiltinSession;
use crate::{
    atomic_write, read_local_data_file_if_exists, ResponseChunk, ResponseDone, ResponseError,
    ResponsePermissionRequest, ResponseTool,
};

const COMPANION_PREFS_FILE: &str = "companion.json";
const COMPANION_HISTORY_FILE: &str = "companion_history.json";
const COMPANION_HISTORY_CAP: usize = 100;

/// Keep this many finished records around (running/waiting ones are never trimmed).
const FINISHED_RECORDS_KEPT: usize = 50;

/// Minimum interval between progress updates per activity id.
const PROGRESS_THROTTLE_MS: i64 = 500;

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CompanionPrefs {
    pub enabled: bool,
    /// OS-level notifications are an OPT-IN backup; the pet's own bubble is
    /// the primary surface. Defaults to false.
    #[serde(default)]
    pub os_notifications: bool,
    pub notify_permission: bool,
    pub notify_error: bool,
    pub notify_completion: bool,
    /// RFC3339 instant until which all notifications are suppressed.
    pub dnd_until: Option<String>,
    /// Optional model override for the pet's brain; None → companion default.
    pub brain_model: Option<String>,
    pub window_x: Option<i32>,
    pub window_y: Option<i32>,
}

impl Default for CompanionPrefs {
    fn default() -> Self {
        Self {
            enabled: true,
            os_notifications: false,
            notify_permission: true,
            notify_error: true,
            notify_completion: true,
            dnd_until: None,
            brain_model: None,
            window_x: None,
            window_y: None,
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ActivityKind {
    Conversation,
    ScheduledTask,
    LoopTask,
    LoopIteration,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ActivityStatus {
    Running,
    WaitingPermission,
    Completed,
    Failed,
    Stopped,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ActivityRecord {
    /// conversation_id / task-run conversation id / loop task id.
    pub id: String,
    pub kind: ActivityKind,
    pub title: String,
    pub workspace: String,
    pub engine: Option<String>,
    /// Record creation, unix ms.
    pub started_at: i64,
    /// Current turn start, unix ms — completion notifications measure this.
    pub turn_started_at: i64,
    pub last_event_at: i64,
    pub status: ActivityStatus,
    /// Latest streaming excerpt (chars, capped).
    pub excerpt: String,
    pub finished_at: Option<i64>,
    /// Error text or final excerpt for finished records.
    pub detail: Option<String>,
}

/// One Q&A exchange with the pet's brain, persisted across restarts.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CompanionChatEntry {
    pub question: String,
    pub answer: String,
    pub at: String,
}

/// Ambient bubble shown next to the pet sprite whenever a notification fires —
/// the pet itself is the always-visible surface, independent of the OS
/// notification center and of any window being open.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CompanionToast {
    /// "done" | "error" | "info" — colors the bubble.
    pub kind: String,
    /// The main text the user reads (agent output / error / progress).
    pub main: String,
    /// Tiny context label (session/task name) — secondary.
    pub label: String,
}

/// The input side of `apply_event` — a deserialized observation of one
/// existing app event, normalized so the pure core stays event-source-agnostic
/// (and unit-testable without a Tauri app).
#[derive(Debug, Clone)]
pub enum Observation {
    TurnStarted {
        id: String,
        workspace: String,
        engine: Option<String>,
    },
    Progress {
        id: String,
        excerpt: String,
    },
    PermissionRequested {
        id: String,
        tool_name: String,
    },
    Finished {
        id: String,
        detail: String,
        /// Scheduled/loop tasks already fire their own ⚡/🔄 OS notification
        /// in `run_task_headless`; the pet must not double-notify for them.
        suppress_notification: bool,
    },
    Failed {
        id: String,
        error: String,
    },
    /// Deliberate user stop (stop_generation). The stop path finalizes
    /// silently (no agent-done / agent-error), so the `agent-stopped`
    /// observability event is the only reliable post-stop signal.
    Stopped {
        id: String,
    },
    TaskStarted {
        id: String,
        title: String,
        workspace: String,
        engine: Option<String>,
    },
}

/// What the pure core wants the outside world to do about a transition.
#[derive(Debug, Clone, PartialEq)]
pub enum SideEffect {
    /// Fire a pet bubble: (main text, small context label). The MAIN text is
    /// the payload the user actually reads (agent output, error, tool); the
    /// label is secondary context (session/task name) rendered tiny.
    Notify(String, String),
    /// Record finished: (result text, small context label).
    NotifyCompletion(String, String),
}

pub struct CompanionState {
    /// All Running/WaitingPermission records + the most recent finished ones.
    pub activities: Mutex<Vec<ActivityRecord>>,
    pub prefs: Mutex<CompanionPrefs>,
    /// The pet's brain session (single chat thread). Serialized by this mutex.
    pub pet: tokio::sync::Mutex<Option<BuiltinSession>>,
    /// Per-id last progress-apply instant, for throttling.
    last_progress: Mutex<HashMap<String, i64>>,
}

impl CompanionState {
    pub fn new(prefs: CompanionPrefs) -> Self {
        Self {
            activities: Mutex::new(Vec::new()),
            prefs: Mutex::new(prefs),
            pet: tokio::sync::Mutex::new(None),
            last_progress: Mutex::new(HashMap::new()),
        }
    }
}

// ---------------------------------------------------------------------------
// Pure core: apply one observation to the registry
// ---------------------------------------------------------------------------

fn truncate_chars(s: &str, max: usize) -> String {
    if s.chars().count() <= max {
        s.to_string()
    } else {
        s.chars().take(max).collect()
    }
}

fn is_finished(status: ActivityStatus) -> bool {
    matches!(
        status,
        ActivityStatus::Completed | ActivityStatus::Failed | ActivityStatus::Stopped
    )
}

/// Apply one observation. Returns the updated record when the registry changed
/// (caller broadcasts it) plus any side effect (notifications). Pure with
/// respect to the registry; `now` is injected for testability.
pub fn apply_event(
    activities: &mut Vec<ActivityRecord>,
    obs: &Observation,
    now: i64,
) -> (Option<ActivityRecord>, Option<SideEffect>) {
    match obs {
        Observation::TurnStarted {
            id,
            workspace,
            engine,
        } => {
            let existing = activities.iter_mut().find(|r| &r.id == id);
            match existing {
                Some(rec) => {
                    // A finished conversation resumed: reopen the record.
                    rec.status = ActivityStatus::Running;
                    rec.turn_started_at = now;
                    rec.last_event_at = now;
                    rec.finished_at = None;
                    rec.detail = None;
                    if rec.workspace.is_empty() {
                        rec.workspace = workspace.clone();
                    }
                    rec.engine = engine.clone().or(rec.engine.take());
                    (Some(rec.clone()), None)
                }
                None => {
                    let rec = ActivityRecord {
                        id: id.clone(),
                        kind: ActivityKind::Conversation,
                        title: String::new(),
                        workspace: workspace.clone(),
                        engine: engine.clone(),
                        started_at: now,
                        turn_started_at: now,
                        last_event_at: now,
                        status: ActivityStatus::Running,
                        excerpt: String::new(),
                        finished_at: None,
                        detail: None,
                    };
                    activities.push(rec.clone());
                    (Some(rec), None)
                }
            }
        }
        Observation::Progress { id, excerpt } => {
            let rec = match activities.iter_mut().find(|r| &r.id == id) {
                Some(r) => r,
                None => return (None, None), // unknown id (e.g. app-stopped task) — ignore
            };
            // Any streaming activity after a permission wait means it was
            // approved (or auto-resolved) — back to running.
            rec.status = ActivityStatus::Running;
            rec.last_event_at = now;
            rec.excerpt = truncate_chars(excerpt, 160);
            (Some(rec.clone()), None)
        }
        Observation::PermissionRequested { id, tool_name } => {
            let rec = match activities.iter_mut().find(|r| &r.id == id) {
                Some(r) => r,
                None => return (None, None),
            };
            rec.status = ActivityStatus::WaitingPermission;
            rec.last_event_at = now;
            rec.excerpt = format!("permission: {tool_name}");
            // Main text = what needs approval; label = session name (tiny).
            let main = format!("🔔 请求权限: {tool_name}");
            let label = rec.title.clone();
            (Some(rec.clone()), Some(SideEffect::Notify(main, label)))
        }
        Observation::Finished {
            id,
            detail,
            suppress_notification,
        } => {
            let rec = match activities.iter_mut().find(|r| &r.id == id) {
                Some(r) => r,
                None => return (None, None),
            };
            rec.status = ActivityStatus::Completed;
            rec.last_event_at = now;
            rec.finished_at = Some(now);
            rec.detail = Some(truncate_chars(detail, 400));
            // EVERY turn completion notifies (no minimum duration): the pet's
            // job is telling the pilot a session finished, even a quick one.
            // Main text = the agent's final output; label = session name (tiny).
            let effect = if !suppress_notification {
                let d = detail.trim();
                let main = if d.is_empty() {
                    "✅ 已完成".to_string()
                } else {
                    format!("✅ {}", truncate_chars(d, 300))
                };
                Some(SideEffect::NotifyCompletion(main, rec.title.clone()))
            } else {
                None
            };
            let out = rec.clone();
            trim_finished(activities);
            (Some(out), effect)
        }
        Observation::Failed { id, error } => {
            let rec = match activities.iter_mut().find(|r| &r.id == id) {
                Some(r) => r,
                None => return (None, None),
            };
            rec.status = ActivityStatus::Failed;
            rec.last_event_at = now;
            rec.finished_at = Some(now);
            rec.detail = Some(truncate_chars(error, 400));
            // Main text = the error; label = session name (tiny).
            let effect = Some(SideEffect::Notify(
                format!("❌ {}", truncate_chars(error, 300)),
                rec.title.clone(),
            ));
            let out = rec.clone();
            trim_finished(activities);
            (Some(out), effect)
        }
        Observation::Stopped { id } => {
            let rec = match activities.iter_mut().find(|r| &r.id == id) {
                Some(r) => r,
                None => return (None, None),
            };
            rec.status = ActivityStatus::Stopped;
            rec.last_event_at = now;
            rec.finished_at = Some(now);
            let out = rec.clone();
            trim_finished(activities);
            (Some(out), None)
        }
        Observation::TaskStarted {
            id,
            title,
            workspace,
            engine,
        } => {
            let rec = ActivityRecord {
                id: id.clone(),
                kind: ActivityKind::ScheduledTask,
                title: truncate_chars(title, 60),
                workspace: workspace.clone(),
                engine: engine.clone(),
                started_at: now,
                turn_started_at: now,
                last_event_at: now,
                status: ActivityStatus::Running,
                excerpt: String::new(),
                finished_at: None,
                detail: None,
            };
            activities.retain(|r| &r.id != id);
            activities.push(rec.clone());
            (Some(rec), None)
        }
    }
}

/// Keep at most FINISHED_RECORDS_KEPT finished records, dropping the oldest.
fn trim_finished(activities: &mut Vec<ActivityRecord>) {
    let finished_idx: Vec<usize> = activities
        .iter()
        .enumerate()
        .filter(|(_, r)| is_finished(r.status))
        .map(|(i, _)| i)
        .collect();
    if finished_idx.len() <= FINISHED_RECORDS_KEPT {
        return;
    }
    // finished_idx is ascending by position; drop oldest by started_at order.
    let mut finished: Vec<(usize, i64)> = finished_idx
        .into_iter()
        .map(|i| (i, activities[i].started_at))
        .collect();
    finished.sort_by_key(|(_, t)| *t);
    let excess = finished.len() - FINISHED_RECORDS_KEPT;
    let to_remove: Vec<usize> = finished[..excess].iter().map(|(i, _)| *i).collect();
    for i in to_remove.into_iter().rev() {
        activities.remove(i);
    }
}

// ---------------------------------------------------------------------------
// Registry plumbing (lock-scoped, non-blocking)
// ---------------------------------------------------------------------------

pub struct CompanionHandle {
    app: AppHandle,
}

/// Managed wrapper — listeners reach it via `app.state::<CompanionStateStore>()`.
pub struct CompanionStateStore(pub CompanionState);

fn now_ms() -> i64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis() as i64)
        .unwrap_or(0)
}

/// The pet's read-only tools are rooted at the user's home directory — global
/// by design (it watches ALL workspaces, not one), but confined to the home.
fn home_root() -> String {
    std::env::var("HOME").unwrap_or_else(|_| ".".to_string())
}

impl CompanionHandle {
    /// Apply an observation: throttle progress, update the registry, broadcast
    /// `companion-activity`, and run notification side effects. Called from
    /// synchronous event listeners — must never block.
    fn observe(&self, obs: Observation) {
        let app = &self.app;
        let store = app.state::<CompanionStateStore>();
        let now = now_ms();

        if let Observation::Progress { id, .. } = &obs {
            let mut last = match store.0.last_progress.try_lock() {
                Ok(g) => g,
                Err(_) => return, // contended — the next event catches up
            };
            if let Some(t) = last.get(id) {
                if now - t < PROGRESS_THROTTLE_MS {
                    return;
                }
            }
            last.insert(id.clone(), now);
        }

        let (updated, effect) = {
            let mut activities = match store.0.activities.try_lock() {
                Ok(g) => g,
                Err(_) => return,
            };
            apply_event(&mut activities, &obs, now)
        };

        if let Some(rec) = updated {
            let _ = app.emit("companion-activity", &rec);
        }
        if let Some(effect) = effect {
            self.run_effect(effect);
        }
    }

    fn run_effect(&self, effect: SideEffect) {
        use tauri_plugin_notification::NotificationExt;
        // Effect fields are (main, label): main = the text the user reads
        // (agent output / error / progress), label = tiny context (session name).
        let (main, label, is_completion) = match &effect {
            SideEffect::Notify(m, l) => (m.clone(), l.clone(), false),
            SideEffect::NotifyCompletion(m, l) => (m.clone(), l.clone(), true),
        };

        let store = self.app.state::<CompanionStateStore>();
        let prefs = match store.0.prefs.try_lock() {
            Ok(g) => g,
            Err(_) => return,
        };

        // --- Pet bubble: the PRIMARY interaction surface. Always shown (the
        // pet is the product here) — only DND quiets it, since DND is the
        // explicit "leave me alone" switch. Gating by category applies to OS
        // notifications below, not to the pet itself.
        let dnd = prefs
            .dnd_until
            .as_ref()
            .is_some_and(|until| chrono::Utc::now().to_rfc3339() < *until);
        let os_enabled = prefs.os_notifications;
        let os_category_on = if is_completion {
            prefs.notify_completion
        } else if main.starts_with("❌") {
            prefs.notify_error
        } else if main.starts_with("🔔") {
            prefs.notify_permission
        } else {
            true // heartbeat ⏳
        };
        drop(prefs);

        if !dnd {
            let kind = if is_completion || main.starts_with("✅") {
                "done"
            } else if main.starts_with("❌") {
                "error"
            } else {
                "info"
            };
            let _ = self.app.emit_to(
                "companion",
                "companion-toast",
                CompanionToast {
                    kind: kind.to_string(),
                    main: main.clone(),
                    label: label.clone(),
                },
            );
        }

        // --- OS notification: opt-in backup, for when the user wants buzzes
        // even without looking at the pet (e.g. away from the desk). Title is
        // the label (short); body carries the main text.
        if !os_enabled || !os_category_on || dnd {
            return;
        }
        let os_title = if label.is_empty() {
            "Pixie".to_string()
        } else {
            label.clone()
        };
        let _ = self
            .app
            .notification()
            .builder()
            .title(&os_title)
            .body(&main)
            .show();
        log::info!("[companion] os notification: {os_title}");
    }

    /// Lazily backfill title/workspace for conversation records from
    /// history.jsonl. The agent-* events carry no title; the file is the
    /// frontend's source of truth. Cheap: re-read only when mtime changed.
    fn refresh_titles(&self) {
        let store = self.app.state::<CompanionStateStore>();
        let needs = {
            let activities = match store.0.activities.try_lock() {
                Ok(g) => g,
                Err(_) => return,
            };
            activities
                .iter()
                .any(|r| r.kind == ActivityKind::Conversation && r.title.is_empty())
        };
        if !needs {
            return;
        }
        let Some(text) = read_local_data_file_if_exists(&self.app, "history.jsonl", "history")
            .ok()
            .flatten()
        else {
            return;
        };
        let map: HashMap<String, (String, String)> = text
            .lines()
            .filter_map(|line| serde_json::from_str::<serde_json::Value>(line).ok())
            .filter_map(|v| {
                let conv = v.get("conversation")?;
                let id = conv.get("id")?.as_str()?.to_string();
                let title = conv.get("title").and_then(|t| t.as_str()).unwrap_or("");
                let ws = v.get("workspaceId").and_then(|w| w.as_str()).unwrap_or("");
                Some((id, (title.to_string(), ws.to_string())))
            })
            .collect();
        let mut updated: Vec<ActivityRecord> = Vec::new();
        {
            let store = self.app.state::<CompanionStateStore>();
            let Ok(mut activities) = store.0.activities.try_lock() else {
                return;
            };
            for rec in activities.iter_mut() {
                if rec.kind == ActivityKind::Conversation {
                    if let Some((title, _ws)) = map.get(&rec.id) {
                        if rec.title.is_empty() && !title.is_empty() {
                            rec.title = truncate_chars(title, 60);
                            updated.push(rec.clone());
                        }
                    }
                }
            }
        }
        for rec in updated {
            let _ = self.app.emit("companion-activity", &rec);
        }
    }
}

// ---------------------------------------------------------------------------
// Init: prefs load, listener registration, window creation
// ---------------------------------------------------------------------------

fn load_prefs(app: &AppHandle) -> CompanionPrefs {
    read_local_data_file_if_exists(app, COMPANION_PREFS_FILE, "companion prefs")
        .ok()
        .flatten()
        .and_then(|s| serde_json::from_str(&s).ok())
        .unwrap_or_default()
}

pub(crate) fn save_prefs(app: &AppHandle, prefs: &CompanionPrefs) -> Result<(), String> {
    let path = crate::local_data_file_path(app, COMPANION_PREFS_FILE, "companion prefs")?;
    let json = serde_json::to_string_pretty(prefs)
        .map_err(|e| format!("Failed to serialize companion prefs: {e}"))?;
    atomic_write(&path, &json)
}

pub(crate) fn load_history_entries(app: &AppHandle) -> Vec<CompanionChatEntry> {
    read_local_data_file_if_exists(app, COMPANION_HISTORY_FILE, "companion history")
        .ok()
        .flatten()
        .and_then(|s| serde_json::from_str(&s).ok())
        .unwrap_or_default()
}

pub(crate) fn save_history_entries(
    app: &AppHandle,
    entries: &[CompanionChatEntry],
) -> Result<(), String> {
    let path = crate::local_data_file_path(app, COMPANION_HISTORY_FILE, "companion history")?;
    let json = serde_json::to_string_pretty(entries)
        .map_err(|e| format!("Failed to serialize companion history: {e}"))?;
    atomic_write(&path, &json)
}

/// Entry point, called once from `setup()` after `manage`. Registers all event
/// listeners and creates the pet window when enabled. All companion wiring
/// lives here — `lib.rs` only calls this one function.
pub fn init(app: &AppHandle) {
    let prefs = load_prefs(app);
    app.manage(CompanionStateStore(CompanionState::new(prefs.clone())));

    let handle = Arc::new(CompanionHandle { app: app.clone() });

    register_listeners(handle.clone());
    spawn_title_refresher(handle.clone());
    spawn_heartbeat(app.clone());

    if prefs.enabled {
        if let Err(e) = create_window(app, &prefs) {
            log::error!("[companion] failed to create window: {e}");
        }
    }
    log::info!("[companion] initialized (enabled={})", prefs.enabled);
}

/// Background task: periodically backfill titles from history.jsonl. Records
/// often start untitled because agent events don't carry conversation titles.
fn spawn_title_refresher(handle: Arc<CompanionHandle>) {
    let app = handle.app.clone();
    tauri::async_runtime::spawn(async move {
        let mut interval = tokio::time::interval(std::time::Duration::from_secs(10));
        loop {
            interval.tick().await;
            let h = CompanionHandle { app: app.clone() };
            h.refresh_titles();
        }
    });
}

/// Long-running turns get a periodic "still working on…" heartbeat so the
/// user can step away without losing the thread. Fast cadence — the point is
/// reassurance, not summary: first beat at 30s, then every 30s. A turn that
/// finishes between beats just reports done.
const HEARTBEAT_FIRST_MS: i64 = 30_000;
const HEARTBEAT_EVERY_MS: i64 = 30_000;

fn spawn_heartbeat(app: AppHandle) {
    tauri::async_runtime::spawn(async move {
        let mut interval = tokio::time::interval(std::time::Duration::from_secs(5));
        // (id, turn_started_at) → last heartbeat instant. Keying on the turn
        // start makes each NEW turn wait for its own first beat, and entries
        // vanish naturally when the record leaves Running or gets trimmed.
        let mut last_beat: HashMap<(String, i64), i64> = HashMap::new();
        loop {
            interval.tick().await;
            let now = now_ms();
            let store = app.state::<CompanionStateStore>();
            let mut beats: Vec<(String, i64, String)> = Vec::new();
            {
                let Ok(activities) = store.0.activities.try_lock() else {
                    continue;
                };
                for rec in activities.iter() {
                    if rec.status != ActivityStatus::Running {
                        continue;
                    }
                    let key = (rec.id.clone(), rec.turn_started_at);
                    let elapsed = now - rec.turn_started_at;
                    let due_at = match last_beat.get(&key) {
                        // Subsequent beats are strictly periodic from the last.
                        Some(t) => t + HEARTBEAT_EVERY_MS,
                        // First beat only after the turn has run a while.
                        None => rec.turn_started_at + HEARTBEAT_FIRST_MS,
                    };
                    if now < due_at {
                        continue;
                    }
                    last_beat.insert(key, now);
                    beats.push((rec.title.clone(), elapsed, excerpt_or(rec).to_string()));
                }
                // Drop entries whose record is gone (finished or trimmed).
                let live: std::collections::HashSet<(String, i64)> = activities
                    .iter()
                    .filter(|r| r.status == ActivityStatus::Running)
                    .map(|r| (r.id.clone(), r.turn_started_at))
                    .collect();
                last_beat.retain(|k, _| live.contains(k));
            }
            for (title, elapsed, excerpt) in beats {
                let h = CompanionHandle { app: app.clone() };
                // Main text = what it's doing right now; label = session name.
                h.run_effect(SideEffect::Notify(
                    format!(
                        "⏳ {}s · {}",
                        elapsed / 1_000,
                        truncate_chars(&excerpt, 200)
                    ),
                    title,
                ));
            }
        }
    });
}

fn register_listeners(handle: Arc<CompanionHandle>) {
    let app = handle.app.clone();

    // A new interactive turn on any engine (event emitted by send_message).
    let h = handle.clone();
    let _ = app.listen_any("agent-turn-started", move |event| {
        let payload = event.payload();
        let Ok(v) = serde_json::from_str::<serde_json::Value>(payload) else {
            return;
        };
        let Some(id) = v.get("conversation_id").and_then(|x| x.as_str()) else {
            return;
        };
        h.observe(Observation::TurnStarted {
            id: id.to_string(),
            workspace: v
                .get("workspace")
                .and_then(|x| x.as_str())
                .unwrap_or("")
                .to_string(),
            engine: v.get("engine").and_then(|x| x.as_str()).map(String::from),
        });
    });

    // Streaming text → throttled progress.
    let h = handle.clone();
    let _ = app.listen_any("agent-response", move |event| {
        let payload = event.payload();
        let Ok(chunk) = serde_json::from_str::<ResponseChunk>(payload) else {
            return;
        };
        log::debug!(
            "[companion] agent-response observed: conv={}",
            chunk.conversation_id
        );
        h.observe(Observation::Progress {
            id: chunk.conversation_id,
            excerpt: chunk.content,
        });
    });

    // Tool activity also counts as progress (covers turns that mostly run tools).
    let h = handle.clone();
    let _ = app.listen_any("agent-tool", move |event| {
        let payload = event.payload();
        let Ok(tool) = serde_json::from_str::<ResponseTool>(payload) else {
            return;
        };
        if tool.kind != "start" {
            return;
        }
        let name = tool.name.unwrap_or_else(|| "tool".into());
        h.observe(Observation::Progress {
            id: tool.conversation_id,
            excerpt: format!("tool: {name}"),
        });
    });

    // Permission request → alert.
    let h = handle.clone();
    let _ = app.listen_any("agent-permission-request", move |event| {
        let payload = event.payload();
        let Ok(req) = serde_json::from_str::<ResponsePermissionRequest>(payload) else {
            return;
        };
        h.observe(Observation::PermissionRequested {
            id: req.conversation_id,
            tool_name: req.tool_name,
        });
    });

    // Turn finished.
    let h = handle.clone();
    let _ = app.listen_any("agent-done", move |event| {
        let payload = event.payload();
        let Ok(done) = serde_json::from_str::<ResponseDone>(payload) else {
            return;
        };
        h.observe(Observation::Finished {
            id: done.conversation_id,
            detail: done.full_text,
            suppress_notification: false,
        });
    });

    // Turn failed.
    let h = handle.clone();
    let _ = app.listen_any("agent-error", move |event| {
        let payload = event.payload();
        let Ok(err) = serde_json::from_str::<ResponseError>(payload) else {
            return;
        };
        h.observe(Observation::Failed {
            id: err.conversation_id,
            error: err.error,
        });
    });

    // Turn deliberately stopped by the user (stop_generation). The stop path
    // finalizes silently (no agent-done/-error), so without this listener the
    // record stays Running forever and the pet stays white.
    let h = handle.clone();
    let _ = app.listen_any("agent-stopped", move |event| {
        let payload = event.payload();
        let Ok(v) = serde_json::from_str::<serde_json::Value>(payload) else {
            return;
        };
        let Some(id) = v.get("conversation_id").and_then(|x| x.as_str()) else {
            return;
        };
        h.observe(Observation::Stopped { id: id.to_string() });
    });

    // Headless scheduled task started (event emitted by run_task_headless).
    let h = handle.clone();
    let _ = app.listen_any("task-run-started", move |event| {
        let payload = event.payload();
        let Ok(v) = serde_json::from_str::<serde_json::Value>(payload) else {
            return;
        };
        let Some(id) = v.get("conversation_id").and_then(|x| x.as_str()) else {
            return;
        };
        h.observe(Observation::TaskStarted {
            id: id.to_string(),
            title: v
                .get("task_name")
                .and_then(|x| x.as_str())
                .unwrap_or("task")
                .to_string(),
            workspace: v
                .get("workspace")
                .and_then(|x| x.as_str())
                .unwrap_or("")
                .to_string(),
            engine: v.get("engine").and_then(|x| x.as_str()).map(String::from),
        });
    });

    // Scheduled task finished — the completion event only carries ids, so pull
    // the record from the task-runs file for the human-readable outcome.
    let h = handle.clone();
    let _ = app.listen_any("task-run-complete", move |event| {
        let payload = event.payload();
        let Ok(v) = serde_json::from_str::<serde_json::Value>(payload) else {
            return;
        };
        let Some(conv) = v.get("conversation_id").and_then(|x| x.as_str()) else {
            return;
        };
        let status_error = v.get("status").and_then(|x| x.as_str()) == Some("error");
        // The record file is the source of truth; fall back to a bare marker.
        let runs: Vec<crate::TaskRunRecord> =
            read_local_data_file_if_exists(&h.app, crate::TASK_RUNS_FILE, "task runs")
                .ok()
                .flatten()
                .and_then(|s| serde_json::from_str(&s).ok())
                .unwrap_or_default();
        match runs.iter().find(|r| r.id == conv) {
            Some(run) if status_error || run.status == "error" => {
                let detail = if run.result.is_empty() {
                    "task failed".to_string()
                } else {
                    run.result.clone()
                };
                h.observe(Observation::Failed {
                    id: run.id.clone(),
                    error: detail,
                });
            }
            Some(run) => {
                h.observe(Observation::Finished {
                    id: run.id.clone(),
                    detail: run.result.clone(),
                    // The ⚡ task notification already fired in run_task_headless.
                    suppress_notification: true,
                });
            }
            None => {
                h.observe(Observation::Finished {
                    id: conv.to_string(),
                    detail: String::new(),
                    suppress_notification: true,
                });
            }
        }
    });

    // Loop lifecycle. Iterations are real conversations (they emit agent-*),
    // so we only track the loop-level records here.
    let h = handle.clone();
    let _ = app.listen_any("loop-iteration-started", move |event| {
        let payload = event.payload();
        let Ok(v) = serde_json::from_str::<serde_json::Value>(payload) else {
            return;
        };
        let Some(task_id) = v.get("task_id").and_then(|x| x.as_str()) else {
            return;
        };
        let task_name = v
            .get("task_name")
            .and_then(|x| x.as_str())
            .unwrap_or("loop");
        let iteration = v.get("iteration").and_then(|x| x.as_i64()).unwrap_or(0);
        h.observe(Observation::TaskStarted {
            id: task_id.to_string(),
            title: format!("{} · iter {iteration}", task_name),
            workspace: v
                .get("workspace")
                .and_then(|x| x.as_str())
                .unwrap_or("")
                .to_string(),
            engine: v.get("engine").and_then(|x| x.as_str()).map(String::from),
        });
    });

    let h = handle.clone();
    let _ = app.listen_any("loop-cycle-complete", move |event| {
        let payload = event.payload();
        let Ok(v) = serde_json::from_str::<serde_json::Value>(payload) else {
            return;
        };
        let Some(task_id) = v.get("task_id").and_then(|x| x.as_str()) else {
            return;
        };
        h.observe(Observation::Finished {
            id: task_id.to_string(),
            detail: String::new(),
            // The 🔄 loop-completion notification already fired.
            suppress_notification: true,
        });
    });
}

fn create_window(app: &AppHandle, prefs: &CompanionPrefs) -> Result<(), tauri::Error> {
    use tauri::{WebviewUrl, WebviewWindowBuilder};

    if app.get_webview_window("companion").is_some() {
        return Ok(()); // dev reload — keep the existing window
    }
    const W: f64 = 120.0;
    const H: f64 = 140.0;
    // Restore the saved logical position, clamped into the nearest monitor's
    // visible area — a stale record from another display (or a pre-scale-fix
    // save in physical px) must not strand the pet off-screen.
    let (x, y) = clamp_to_monitors(app, prefs.window_x, prefs.window_y, W, H);
    let builder =
        WebviewWindowBuilder::new(app, "companion", WebviewUrl::App("companion.html".into()))
            .title("Pixie Companion")
            .inner_size(W, H)
            .decorations(false)
            .transparent(true)
            .always_on_top(true)
            .skip_taskbar(true)
            .resizable(false)
            .shadow(false)
            // The pet LIVES on the desktop, not on one Space: visible on
            // every workspace (macOS canJoinAllSpaces) and above fullscreen
            // apps (fullScreenAuxiliary) — the standard behavior for resident
            // desktop companions (Shimeji/RunCat-style). Without this it
            // vanishes when the user switches Spaces or enters a fullscreen
            // app, which reads as "the pet got lost".
            .visible_on_all_workspaces(true)
            // macOS: an UNFOCUSED window's first click normally just activates
            // the window and is swallowed — the pet would need "click, then
            // click-drag" to move. acceptFirstMouse forwards that first click
            // to the content so dragging works in one press.
            .accept_first_mouse(true)
            .position(x, y);

    builder.build()?;
    log::info!("[companion] pet window created at ({x}, {y})");
    Ok(())
}

/// Clamp a saved logical position into a monitor's visible area. Falls back
/// to the default spot (top-right-ish of the primary monitor) when the saved
/// point isn't on any monitor at all.
fn clamp_to_monitors(
    app: &AppHandle,
    saved_x: Option<i32>,
    saved_y: Option<i32>,
    w: f64,
    h: f64,
) -> (f64, f64) {
    let monitors = app.available_monitors().unwrap_or_default();
    let (Some(sx), Some(sy)) = (saved_x, saved_y) else {
        return default_position(&monitors, w, h);
    };

    for m in &monitors {
        let pos = m.position();
        let size = m.size();
        let scale = m.scale_factor();
        // Monitor geometry in LOGICAL points.
        let (mx, my) = (pos.x as f64 / scale, pos.y as f64 / scale);
        let (mw, mh) = (size.width as f64 / scale, size.height as f64 / scale);
        // Is the saved point inside this monitor (with a small tolerance)?
        if sx as f64 >= mx - w && sx as f64 <= mx + mw && sy as f64 >= my && sy as f64 <= my + mh {
            let cx = (sx as f64).clamp(mx + 4.0, mx + mw - w - 4.0).max(mx);
            let cy = (sy as f64).clamp(my + 4.0, my + mh - h - 4.0).max(my);
            return (cx, cy);
        }
    }
    // Not on any monitor — e.g. a physical-px save from before the scale fix,
    // or the display was disconnected. Fall back to the default spot.
    default_position(&monitors, w, h)
}

fn default_position(monitors: &[tauri::Monitor], w: f64, _h: f64) -> (f64, f64) {
    // Top-right of the primary (first) monitor, tucked in below the menu bar.
    let Some(first) = monitors.first() else {
        return (1200.0, 120.0);
    };
    let scale = first.scale_factor();
    let mw = first.size().width as f64 / scale;
    let x = (mw - w - 24.0).max(24.0);
    (x, 120.0)
}

// ---------------------------------------------------------------------------
// Commands
// ---------------------------------------------------------------------------

#[derive(Debug, Clone, Serialize)]
pub struct CompanionSnapshot {
    pub activities: Vec<ActivityRecord>,
    pub prefs: CompanionPrefs,
    pub history: Vec<CompanionChatEntry>,
    pub brain_available: bool,
}

#[tauri::command]
pub fn get_companion_state(app: AppHandle) -> Result<CompanionSnapshot, String> {
    let store = app.state::<CompanionStateStore>();
    let activities = store
        .0
        .activities
        .lock()
        .map_err(|_| "companion state poisoned")?
        .clone();
    let prefs = store
        .0
        .prefs
        .lock()
        .map_err(|_| "companion state poisoned")?
        .clone();
    let history = load_history_entries(&app);
    Ok(CompanionSnapshot {
        activities,
        prefs,
        history,
        brain_available: !crate::engine::builtin::get_api_key().is_empty(),
    })
}

#[tauri::command]
pub fn set_companion_prefs(app: AppHandle, prefs: CompanionPrefs) -> Result<(), String> {
    {
        let store = app.state::<CompanionStateStore>();
        let mut guard = store
            .0
            .prefs
            .lock()
            .map_err(|_| "companion state poisoned")?;
        // Window position is owned by the frontend drag handler; keep the
        // latest known value when the caller sends stale coordinates.
        let pos = guard.window_x.zip(guard.window_y);
        if pos.is_some() && prefs.window_x.is_none() {
            guard.window_x = prefs.window_x;
        } else {
            guard.window_x = prefs.window_x;
            guard.window_y = prefs.window_y;
        }
        guard.enabled = prefs.enabled;
        guard.os_notifications = prefs.os_notifications;
        guard.notify_permission = prefs.notify_permission;
        guard.notify_error = prefs.notify_error;
        guard.notify_completion = prefs.notify_completion;
        guard.dnd_until = prefs.dnd_until.clone();
        guard.brain_model = prefs.brain_model.clone();
    }
    let prefs = app
        .state::<CompanionStateStore>()
        .0
        .prefs
        .lock()
        .map_err(|_| "companion state poisoned")?
        .clone();
    save_prefs(&app, &prefs)?;

    // enabled toggles window visibility (the window is created once at init).
    if let Some(win) = app.get_webview_window("companion") {
        if prefs.enabled {
            let _ = win.show();
        } else {
            let _ = win.hide();
        }
    } else if prefs.enabled {
        if let Err(e) = create_window(&app, &prefs) {
            log::error!("[companion] failed to create window: {e}");
        }
    }
    Ok(())
}

/// Bring the main window to front and ask it to open this conversation.
#[tauri::command]
pub fn focus_conversation(app: AppHandle, conversation_id: String) -> Result<(), String> {
    if let Some(win) = app.get_webview_window("main") {
        let _ = win.show();
        let _ = win.unminimize();
        let _ = win.set_focus();
    }
    app.emit_to(
        "main",
        "companion-navigate",
        serde_json::json!({ "conversation_id": conversation_id }),
    )
    .map_err(|e| e.to_string())
}

#[tauri::command]
pub fn reset_companion_chat(app: AppHandle) -> Result<(), String> {
    let store = app.state::<CompanionStateStore>();
    let mut pet = store.0.pet.blocking_lock();
    *pet = None; // next ask recreates the session with a fresh transcript
    drop(pet);
    save_history_entries(&app, &[])?;
    Ok(())
}

// ---------------------------------------------------------------------------
// Q&A brain
// ---------------------------------------------------------------------------

const COMPANION_SYSTEM_PROMPT: &str = "You are Pixie (小精灵), a desktop companion that \
watches the user's AI agent activity across all workspaces. You receive an ACTIVITY \
DIGEST describing every running, waiting, and recently finished conversation/task. \
Answer questions about progress from the digest, general-knowledge questions from \
your own knowledge, and questions about the user's files with the READ-ONLY tools \
(read, grep, find, ls). You may LOOK at files to answer accurately, but you can \
NEVER create, modify, or execute anything — if the user asks you to change \
something, explain what you found and suggest they ask the main chat agent to do \
it. Be concise — a few sentences at most unless asked for detail. Reply in the \
user's language (Chinese gets Chinese). Never fabricate facts about the user's \
environment: if the digest and your tools don't contain the answer, say so plainly.";

/// Default brain model — small and fast; the pet only summarizes and answers.
const COMPANION_DEFAULT_MODEL: &str = "claude-haiku-4-5-20251001";

fn fmt_elapsed(ms: i64) -> String {
    let mins = ms / 60_000;
    if mins < 1 {
        "just now".to_string()
    } else if mins < 60 {
        format!("{mins}m")
    } else {
        format!("{}h{}m", mins / 60, mins % 60)
    }
}

fn excerpt_or(rec: &ActivityRecord) -> &str {
    if rec.excerpt.is_empty() {
        rec.detail.as_deref().unwrap_or("")
    } else {
        &rec.excerpt
    }
}

/// Build the ACTIVITY DIGEST injected into every `companion_ask` prompt.
/// Bounded: ≤8 running + all waiting + ≤10 finished, target < 2.5 KB.
pub fn build_digest(activities: &[ActivityRecord], now: i64) -> String {
    let mut out = String::new();
    out.push_str(&format!("Now: {}\n", chrono::Utc::now().to_rfc3339()));

    let workspaces: Vec<String> = activities
        .iter()
        .filter_map(|r| {
            let b = std::path::Path::new(&r.workspace)
                .file_name()
                .and_then(|s| s.to_str())
                .map(String::from);
            b.filter(|s| !s.is_empty())
        })
        .fold(Vec::new(), |mut acc, w| {
            if !acc.contains(&w) {
                acc.push(w);
            }
            acc
        });
    if !workspaces.is_empty() {
        out.push_str(&format!("WORKSPACES: {}\n", workspaces.join(", ")));
    }

    let running: Vec<&ActivityRecord> = activities
        .iter()
        .filter(|r| r.status == ActivityStatus::Running)
        .collect();
    let waiting: Vec<&ActivityRecord> = activities
        .iter()
        .filter(|r| r.status == ActivityStatus::WaitingPermission)
        .collect();

    out.push_str(&format!("RUNNING ({}):\n", running.len()));
    for rec in running.iter().take(8) {
        let title = if rec.title.is_empty() {
            "untitled"
        } else {
            &rec.title
        };
        out.push_str(&format!(
            "- [{:?}|{}|{}] \"{}\" — {}, last: {}\n",
            rec.kind,
            basename(&rec.workspace),
            rec.engine.as_deref().unwrap_or("?"),
            truncate_chars(title, 60),
            fmt_elapsed(now - rec.turn_started_at),
            truncate_chars(excerpt_or(rec), 80),
        ));
    }
    if running.len() > 8 {
        out.push_str(&format!("- …and {} more running\n", running.len() - 8));
    }

    if !waiting.is_empty() {
        out.push_str(&format!("WAITING PERMISSION ({}):\n", waiting.len()));
        for rec in waiting {
            let title = if rec.title.is_empty() {
                "untitled"
            } else {
                &rec.title
            };
            out.push_str(&format!(
                "- [{:?}|{}] \"{}\" wants {} — waiting {}\n",
                rec.kind,
                basename(&rec.workspace),
                truncate_chars(title, 60),
                rec.excerpt.trim_start_matches("permission: "),
                fmt_elapsed(now - rec.last_event_at),
            ));
        }
    }

    let mut finished: Vec<&ActivityRecord> = activities
        .iter()
        .filter(|r| is_finished(r.status))
        .collect();
    finished.sort_by_key(|r| std::cmp::Reverse(r.finished_at.unwrap_or(0)));
    if !finished.is_empty() {
        out.push_str("RECENTLY FINISHED (newest first):\n");
        for rec in finished.iter().take(10) {
            let title = if rec.title.is_empty() {
                "untitled"
            } else {
                &rec.title
            };
            out.push_str(&format!(
                "- [{:?}|{}] \"{}\" {:?} {}: {}\n",
                rec.kind,
                basename(&rec.workspace),
                truncate_chars(title, 60),
                rec.status,
                fmt_elapsed(now - rec.finished_at.unwrap_or(now)),
                truncate_chars(rec.detail.as_deref().unwrap_or(""), 80),
            ));
        }
    }
    truncate_chars(&out, 4_096)
}

fn basename(path: &str) -> String {
    std::path::Path::new(path)
        .file_name()
        .and_then(|s| s.to_str())
        .map(String::from)
        .unwrap_or_default()
}

/// Structured local fallback used when no API key is configured: the digest
/// itself IS the answer, lightly formatted.
fn local_fallback_answer(activities: &[ActivityRecord], now: i64) -> String {
    let running = activities
        .iter()
        .filter(|r| r.status == ActivityStatus::Running)
        .count();
    let waiting = activities
        .iter()
        .filter(|r| r.status == ActivityStatus::WaitingPermission)
        .count();
    format!(
        "(brain offline — no API key configured for the builtin engine)\n\n{}",
        build_digest(activities, now)
    )
    .replace(
        &format!("RUNNING ({running}):\n"),
        &format!("Running: {running}. "),
    )
    .replace(
        &format!("WAITING PERMISSION ({waiting}):\n"),
        &format!("Waiting permission: {waiting}. "),
    )
}

#[derive(Debug, Clone, Serialize)]
struct CompanionResponse {
    /// Always "__companion__" — the pet's single chat thread.
    #[allow(dead_code)]
    conversation_id: String,
    content: String,
    event_type: String, // "delta" | "done" | "error"
    brain_offline: bool,
}

#[tauri::command]
pub async fn companion_ask(app: AppHandle, question: String) -> Result<(), String> {
    use tauri_plugin_notification::NotificationExt;

    let store = app.state::<CompanionStateStore>();
    let activities = store
        .0
        .activities
        .lock()
        .map_err(|_| "companion state poisoned")?
        .clone();
    let prefs = store
        .0
        .prefs
        .lock()
        .map_err(|_| "companion state poisoned")?
        .clone();
    let brain_model = prefs.brain_model.clone();
    let now = now_ms();

    let api_key = crate::engine::builtin::get_api_key();
    if api_key.is_empty() {
        let answer = local_fallback_answer(&activities, now);
        // Persist before the done signal (see the main path: the frontend
        // snapshot-refresh on "done" must observe this entry).
        append_history(&app, &question, &answer);
        let _ = app.emit(
            "companion-response",
            CompanionResponse {
                conversation_id: "__companion__".into(),
                content: answer.clone(),
                event_type: "done".into(),
                brain_offline: true,
            },
        );
        return Ok(());
    }
    let base_url = crate::engine::builtin::get_base_url();

    // Lazily create / reuse the brain session (single thread, serialized by pet mutex).
    {
        let mut pet = store.0.pet.lock().await;
        if pet.is_none() {
            *pet = Some(BuiltinSession::with_tools(
                "__companion__",
                Some(brain_model.as_deref().unwrap_or(COMPANION_DEFAULT_MODEL)),
                Some(COMPANION_SYSTEM_PROMPT),
                // Rooted at the user's home: the pet can LOOK at anything under
                // it (read/grep/find/ls) but the toolset has no write/execute —
                // "eyes, no hands" is a property of the tool list itself.
                &home_root(),
                &api_key,
                base_url.as_deref(),
                pixie_pi::tools::read_only_tools(std::path::PathBuf::from(home_root())),
            ));
        }
    }

    let digest = build_digest(&activities, now);
    let prompt = format!("ACTIVITY DIGEST\n{digest}\n\nUSER QUESTION: {question}");

    let emitter = app.clone();
    let result = {
        let mut pet = store.0.pet.lock().await;
        let Some(session) = pet.as_mut() else {
            return Err("companion brain unavailable".into());
        };
        session
            .run_turn(&prompt, &[], |evt| {
                if let Some(text) = evt.streaming_text() {
                    let _ = emitter.emit(
                        "companion-response",
                        CompanionResponse {
                            conversation_id: "__companion__".into(),
                            content: text.to_string(),
                            event_type: "delta".into(),
                            brain_offline: false,
                        },
                    );
                }
            })
            .await
    };

    match result {
        Ok((full_text, had_error)) if !had_error => {
            // Persist FIRST, then signal done: the frontend refreshes its
            // history snapshot on "done", and if the write lands after the
            // emit the refreshed list is missing exactly this latest turn.
            append_history(&app, &question, &full_text);
            let _ = app.emit(
                "companion-response",
                CompanionResponse {
                    conversation_id: "__companion__".into(),
                    content: full_text.clone(),
                    event_type: "done".into(),
                    brain_offline: false,
                },
            );
        }
        Ok((_, _)) | Err(_) => {
            // Surface the failure to the pet window; history stays untouched.
            let msg = match result {
                Err(e) => e.to_string(),
                Ok(_) => "brain turn reported an error".to_string(),
            };
            let _ = app.emit(
                "companion-response",
                CompanionResponse {
                    conversation_id: "__companion__".into(),
                    content: msg.clone(),
                    event_type: "error".into(),
                    brain_offline: false,
                },
            );
            let _ = app
                .notification()
                .builder()
                .title("Pixie")
                .body(&msg)
                .show();
        }
    }
    Ok(())
}

fn append_history(app: &AppHandle, question: &str, answer: &str) {
    let mut entries = load_history_entries(app);
    entries.push(CompanionChatEntry {
        question: question.to_string(),
        answer: answer.to_string(),
        at: chrono::Utc::now().to_rfc3339(),
    });
    let keep_from = entries.len().saturating_sub(COMPANION_HISTORY_CAP);
    entries.drain(0..keep_from);
    if let Err(e) = save_history_entries(app, &entries) {
        log::error!("[companion] failed to save history: {e}");
    }
}

// ---------------------------------------------------------------------------
// Tests for the pure core
// ---------------------------------------------------------------------------

#[cfg(test)]
mod tests {
    use super::*;

    fn conv(id: &str) -> Observation {
        Observation::TurnStarted {
            id: id.into(),
            workspace: "/w".into(),
            engine: Some("builtin".into()),
        }
    }

    #[test]
    fn turn_started_creates_running_record() {
        let mut acts = Vec::new();
        let (rec, effect) = apply_event(&mut acts, &conv("c1"), 1_000);
        assert_eq!(effect, None);
        let rec = rec.unwrap();
        assert_eq!(rec.status, ActivityStatus::Running);
        assert_eq!(acts.len(), 1);
    }

    #[test]
    fn finished_resumes_on_next_turn() {
        let mut acts = Vec::new();
        apply_event(&mut acts, &conv("c1"), 1_000);
        let (_, effect) = apply_event(
            &mut acts,
            &Observation::Finished {
                id: "c1".into(),
                detail: "done".into(),
                suppress_notification: false,
            },
            2_000,
        );
        // Every completion notifies — no minimum duration anymore.
        assert!(matches!(effect, Some(SideEffect::NotifyCompletion(_, _))));
        let (rec, _) = apply_event(&mut acts, &conv("c1"), 3_000);
        let rec = rec.unwrap();
        assert_eq!(rec.status, ActivityStatus::Running);
        assert_eq!(rec.turn_started_at, 3_000);
        assert!(rec.finished_at.is_none());
    }

    #[test]
    fn suppressed_completion_skips_notification() {
        let mut acts = Vec::new();
        apply_event(&mut acts, &conv("c1"), 0);
        let (_, effect) = apply_event(
            &mut acts,
            &Observation::Finished {
                id: "c1".into(),
                detail: "built everything".into(),
                suppress_notification: true,
            },
            61_000,
        );
        assert_eq!(effect, None);
    }

    #[test]
    fn permission_sets_waiting_and_notifies() {
        let mut acts = Vec::new();
        apply_event(&mut acts, &conv("c1"), 0);
        let (rec, effect) = apply_event(
            &mut acts,
            &Observation::PermissionRequested {
                id: "c1".into(),
                tool_name: "Bash".into(),
            },
            1_000,
        );
        assert_eq!(rec.unwrap().status, ActivityStatus::WaitingPermission);
        assert!(matches!(effect, Some(SideEffect::Notify(_, _))));

        // Progress after permission → approved, back to running.
        let (rec, _) = apply_event(
            &mut acts,
            &Observation::Progress {
                id: "c1".into(),
                excerpt: "resumed".into(),
            },
            2_000,
        );
        assert_eq!(rec.unwrap().status, ActivityStatus::Running);
    }

    #[test]
    fn stopped_closes_running_record_silently() {
        let mut acts = Vec::new();
        apply_event(&mut acts, &conv("c1"), 0);
        let (rec, effect) =
            apply_event(&mut acts, &Observation::Stopped { id: "c1".into() }, 1_000);
        let rec = rec.unwrap();
        assert_eq!(rec.status, ActivityStatus::Stopped);
        assert_eq!(rec.finished_at, Some(1_000));
        // A user stop is deliberate — no completion/error bubble for it.
        assert_eq!(effect, None);
    }

    #[test]
    fn progress_on_unknown_id_is_ignored() {
        let mut acts = Vec::new();
        let (rec, effect) = apply_event(
            &mut acts,
            &Observation::Progress {
                id: "ghost".into(),
                excerpt: "x".into(),
            },
            0,
        );
        assert!(rec.is_none());
        assert!(effect.is_none());
        assert!(acts.is_empty());
    }

    #[test]
    fn finished_records_are_trimmed_to_cap() {
        let mut acts = Vec::new();
        for i in 0..(FINISHED_RECORDS_KEPT + 10) {
            apply_event(&mut acts, &conv(&format!("c{i}")), i as i64);
            apply_event(
                &mut acts,
                &Observation::Finished {
                    id: format!("c{i}"),
                    detail: "ok".into(),
                    suppress_notification: false,
                },
                i as i64 + 1,
            );
        }
        let finished = acts.iter().filter(|r| is_finished(r.status)).count();
        assert_eq!(finished, FINISHED_RECORDS_KEPT);
    }

    #[test]
    fn task_records_reuse_slot_on_restart() {
        let mut acts = Vec::new();
        apply_event(
            &mut acts,
            &Observation::TaskStarted {
                id: "t1".into(),
                title: "nightly".into(),
                workspace: "/w".into(),
                engine: None,
            },
            0,
        );
        apply_event(
            &mut acts,
            &Observation::Finished {
                id: "t1".into(),
                detail: String::new(),
                suppress_notification: false,
            },
            1,
        );
        apply_event(
            &mut acts,
            &Observation::TaskStarted {
                id: "t1".into(),
                title: "nightly".into(),
                workspace: "/w".into(),
                engine: None,
            },
            2,
        );
        assert_eq!(acts.len(), 1);
        assert_eq!(acts[0].status, ActivityStatus::Running);
    }

    // The listeners deserialize event payloads with serde_json::from_str into
    // the shared Response* structs. These tests lock the wire shapes so a
    // renamed field fails here instead of silently dropping observations.
    #[test]
    fn listener_payload_shapes_parse() {
        let turn: crate::ResponseTurnStarted =
            serde_json::from_str(r#"{"conversation_id":"c1","engine":"builtin","workspace":"/w"}"#)
                .unwrap();
        assert_eq!(turn.conversation_id, "c1");

        let chunk: crate::ResponseChunk =
            serde_json::from_str(r#"{"conversation_id":"c1","content":"hi","event_type":"delta"}"#)
                .unwrap();
        assert_eq!(chunk.content, "hi");

        let done: crate::ResponseDone =
            serde_json::from_str(r#"{"conversation_id":"c1","full_text":"ok"}"#).unwrap();
        assert_eq!(done.full_text, "ok");

        let err: crate::ResponseError =
            serde_json::from_str(r#"{"conversation_id":"c1","error":"boom"}"#).unwrap();
        assert_eq!(err.error, "boom");

        let perm: crate::ResponsePermissionRequest = serde_json::from_str(
            r#"{"conversation_id":"c1","request_id":"r1","tool_name":"Bash","input":{}}"#,
        )
        .unwrap();
        assert_eq!(perm.tool_name, "Bash");

        let task_started: crate::ResponseTaskRunStarted = serde_json::from_str(
            r#"{"conversation_id":"t1","task_id":"x","task_name":"nightly","workspace":"/w","engine":"builtin"}"#,
        )
        .unwrap();
        assert_eq!(task_started.task_name, "nightly");
    }
}
