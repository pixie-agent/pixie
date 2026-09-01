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
}

/** Visual state of the sprite, derived from the activity registry. */
export type PetState = "idle" | "watching" | "alert";
