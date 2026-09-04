// Wire types for the companion window. Rust is the source of truth
// (src-tauri/src/companion.rs); these mirror the serde-serialized shapes
// (snake_case on the wire).

export type ActivityKind = "conversation" | "scheduled_task" | "loop_task" | "loop_iteration";

export type ActivityStatus =
  | "running"
  | "waiting_permission"
  | "completed"
  | "failed"
  | "stopped";

export interface ActivityRecord {
  id: string;
  kind: ActivityKind;
  title: string;
  workspace: string;
  engine: string | null;
  started_at: number;
  turn_started_at: number;
  last_event_at: number;
  status: ActivityStatus;
  excerpt: string;
  finished_at: number | null;
  detail: string | null;
}

export interface CompanionPrefs {
  enabled: boolean;
  /** OS-level notifications (opt-in backup; the pet bubble is primary). */
  os_notifications: boolean;
  notify_permission: boolean;
  notify_error: boolean;
  notify_completion: boolean;
  dnd_until: string | null;
  brain_model: string | null;
  window_x: number | null;
  window_y: number | null;
}

export interface CompanionChatEntry {
  question: string;
  answer: string;
  at: string;
  /** File paths attached to the question (drag-and-drop). */
  attachments?: string[];
  /** Task proposal the brain appended (pixie-task block), if any. */
  proposal?: CompanionProposal;
}

/** Machine-readable task suggestion: what a main-window agent session should
 * do, and where. Dispatched from the pet's action card. */
export interface CompanionProposal {
  task: string;
  workspace: string;
  engine: string;
}

export interface CompanionSnapshot {
  activities: ActivityRecord[];
  prefs: CompanionPrefs;
  history: CompanionChatEntry[];
  brain_available: boolean;
}

export interface CompanionResponse {
  conversation_id: string;
  content: string;
  /** "delta" | "done" | "error" */
  event_type: string;
  brain_offline: boolean;
  /** Parsed task proposal on "done" events (absent otherwise). */
  proposal?: CompanionProposal;
}

/** Payload the pet sends when the user accepts a task proposal — handled by
 * the main window, which owns conversation state. */
export interface CompanionDispatch {
  task: string;
  workspace: string;
  engine: string;
  attachments: string[];
}

/** Visual state of the sprite, derived from the activity registry. */
export type PetState = "idle" | "watching" | "alert";

/** A staged attachment chip in the pet's input. `file` covers dragged-in
 * files AND region captures (a capture is just a fresh file on disk);
 * `clipboard` carries text read from the pasteboard, inlined into the task
 * text on send rather than referenced by path. */
export interface PetAttachment {
  id: string;
  kind: "file" | "clipboard";
  /** File path (kind=file) or the clipboard text itself (kind=clipboard). */
  value: string;
  /** Chip label: file basename, or a short clipboard excerpt. */
  preview: string;
}
