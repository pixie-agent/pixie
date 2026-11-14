export interface ToolStep {
  id: string;
  name: string;
  status: "running" | "done" | "error";
  input?: unknown;
  rawInput?: string;
  result?: string;
}

export interface MessageUsage {
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheCreationTokens: number;
  /** Context occupancy snapshot (input + cache_read + cache_creation of the
   *  latest API call). Snapshot, never accumulated; undefined until the first
   *  turn usage arrives or right after a compaction. */
  contextTokens?: number;
  /** Real context window size in tokens, reported by the agent (ACP
   *  `usage_update.size` carried in the `__ctx__used/size` model hint).
   *  Occupancy indicators use this over static engine tables when present. */
  contextWindow?: number;
  costUsd?: number;
  durationMs?: number;
  numTurns?: number;
  model?: string;
  stopReason?: string;
  /** true while still streaming (running totals), false once authoritative final arrives */
  live?: boolean;
}

export interface Message {
  id: string;
  role: "user" | "assistant" | "system";
  content: string;
  /** Absolute paths of image attachments sent with this user message. Rendered
   *  as thumbnails in the bubble; sent to the engine as image content blocks. */
  images?: string[];
  timestamp: number;
  status?: "sending" | "streaming" | "done" | "error";
  /** Friendly, localized failure explanation shown inline when status is "error".
 *  Set by the agent-error listener / send_message catch so the failure is
 *  visible in the conversation itself (with a retry affordance), not just in
 *  the transient global error banner. */
  errorText?: string;
  tools?: ToolStep[];
  usage?: MessageUsage;
  thinkingTokens?: number;
  thinking?: string;
  /** Pending permission requests from the agent (tool calls needing user approval). */
  pendingPermissions?: PendingPermission[];
}

/** A pending permission request from the agent. */
export interface PendingPermission {
  requestId: string;
  toolName: string;
  input: unknown;
}

export interface Conversation {
  id: string;
  title: string;
  messages: Message[];
  createdAt: number;
  updatedAt: number;
  /** Agent engine bound to this session. Defaults to claude for legacy data. */
  engine: AgentEngineId;
  /** Per-conversation model override. When empty/undefined, uses the engine's global config. */
  model?: string;
  /** Engine-owned session/thread id, used by engines whose id differs from Pixie's conversation id. */
  externalSessionId?: string;
  /** Workspace selected for a new empty conversation; committed on the first send. */
  pendingWorkspaceId?: string;
  /** When present, this conversation is a loop iteration and belongs to the
   *  loop task with this id. The sidebar uses this to group iterations under their parent. */
  loopTaskId?: string;
  /** Display name of the parent loop task (for sidebar grouping header). */
  loopTaskName?: string;
  /** Product-level mode marker. Keeps specialized sessions stable even if users rename them. */
  mode?: "application-studio" | string;
  /** Application Studio workspace path. */
  applicationPath?: string;
  /** Application Studio template id used when the session was created. */
  templateId?: string;
  /** Set when the companion pet dispatched this conversation (task proposal
   * accepted in the pet's action card). Sidebar shows a paw badge. */
  origin?: "companion";
  /** One-shot: the next send spawns a fresh CLI session instead of resuming
   *  (set by "new session"); cleared after the first successful turn. */
  freshSession?: boolean;
  /** Timestamp of the last context compaction (manual /compact or engine
   *  auto-compact); ChatView renders a divider before the first message at/after it. */
  compactedAt?: number;
}

export type AgentEngineId = "claude" | "cursor" | "codebuddy" | "builtin" | "codex" | `acp/${string}`;

/** True for ACP (Agent Client Protocol) registry agents ("acp/<key>"). They are
 *  data-driven launch configs, not compiled engines, so every per-engine switch
 *  in the UI falls back to the ACP branch instead of enumerating ids. */
export function isAcpEngineId(id: string): id is Extract<AgentEngineId, `acp/${string}`> {
  return id.startsWith("acp/");
}

/** Native engines only (excludes acp/*). */
export const NATIVE_ENGINE_IDS = ["claude", "cursor", "codebuddy", "builtin", "codex"] as const;

/** A model entry returned by the backend's list_models command. */
export interface ModelEntry {
  id: string;
  label: string;
}

export const AGENT_ENGINES: { id: AgentEngineId; label: string }[] = [
  { id: "claude", label: "Claude Code" },
  { id: "cursor", label: "Cursor Agent" },
  { id: "codebuddy", label: "CodeBuddy" },
  { id: "builtin", label: "Builtin" },
  { id: "codex", label: "OpenAI Codex" },
];

/** An ACP registry entry — mirrors the Rust `AcpAgentConfig` (snake_case wire
 *  format via serde). Users manage these in Settings → Engines. */
export interface AcpAgentConfig {
  key: string;
  label: string;
  command: string;
  args: string[];
  env: Record<string, string>;
  probe_message: string;
}

/** Engine id for an ACP registry entry. */
export const acpEngineId = (key: string): `acp/${string}` => `acp/${key}`;

/** One entry from the official ACP registry (cdn.agentclientprotocol.com) —
 *  mirrors the Rust `AcpCatalogEntry`. `launchable` = Pixie can run it
 *  directly (npx/uvx); binary distributions require out-of-band install. */
export interface AcpCatalogEntry {
  id: string;
  name: string;
  description: string;
  version: string;
  icon: string;
  command: string;
  args: string[];
  launchable: boolean;
}

/** Build the full engine list: native engines + ACP registry entries.
 *  Registry keys that alias a native engine are skipped — since the
 *  unified-ACP switch the native id itself executes through ACP, so listing
 *  both would render the same agent twice in pickers. */
export function allEngines(acpAgents: AcpAgentConfig[]): { id: AgentEngineId; label: string }[] {
  const nativeIds = new Set(AGENT_ENGINES.map((e) => e.id));
  return [
    ...AGENT_ENGINES,
    ...acpAgents
      .filter((a) => !nativeIds.has(a.key as AgentEngineId))
      .map((a) => ({ id: acpEngineId(a.key), label: a.label })),
  ];
}

/** Readiness/auth state of an engine, set by the backend probe. Mirrors the
 *  Rust `AuthState` enum (serde `snake_case`). `unknown` until a probe runs. */
export type AuthState =
  | "unknown"
  | "ready"
  | "not_authenticated"
  | "region_blocked"
  | "error"
  | "no_response";

export interface EngineStatus {
  id: AgentEngineId;
  display_name: string;
  available: boolean;
  version?: string;
  path?: string;
  error?: string;
  /** Result of the readiness ping probe. Absent on older cached values. */
  auth_state?: AuthState;
  /** Raw engine message for a non-`ready` probe outcome. */
  probe_error?: string | null;
  /** Verbatim probe transcript (stdout + stderr) for the raw-output viewer. */
  probe_raw_output?: string | null;
}

/** @deprecated Use EngineStatus — kept for gradual migration */
export type ClaudeStatus = Pick<EngineStatus, "available" | "version" | "path" | "error">;

export interface ResponseChunk {
  conversation_id: string;
  content: string;
  event_type: string;
}

export interface ResponseDone {
  conversation_id: string;
  full_text: string;
}

export interface ResponseSession {
  conversation_id: string;
  session_id: string;
}

/**
 * The backend is transparently retrying a persistent turn that crashed
 * mid-stream (via `--resume`). The frontend must discard the partial
 * content/tools/thinking already accumulated for the current assistant
 * message so the retried (fresh) response streams cleanly, without leftover
 * garbled/duplicated text from the failed attempt.
 */
export interface ResponseRetry {
  conversation_id: string;
  attempt: number;
}

export interface ResponseTool {
  conversation_id: string;
  tool_use_id: string;
  kind: "start" | "result";
  name?: string;
  input?: string;
  content?: string;
  is_error: boolean;
}

export interface ResponseUsage {
  conversation_id: string;
  kind: "turn" | "final";
  input_tokens: number;
  output_tokens: number;
  cache_read_tokens: number;
  cache_creation_tokens: number;
  /** Context occupancy snapshot ("turn" only; absent on "final" run totals). */
  context_tokens?: number;
  cost_usd?: number;
  duration_ms?: number;
  num_turns?: number;
  model?: string;
  stop_reason?: string;
}

/** Emitted when the CLI compacts the conversation (manual /compact or auto). */
export interface ResponseCompact {
  conversation_id: string;
  trigger: "manual" | "auto" | string;
  pre_tokens: number;
}

export interface ResponseThinking {
  conversation_id: string;
  tokens: number;
}

export interface ResponseThinkingText {
  conversation_id: string;
  content: string;
}

export interface ResponseError {
  conversation_id: string;
  error: string;
}

/** Permission request from the agent (it wants to run a tool and needs user approval). */
export interface ResponsePermissionRequest {
  conversation_id: string;
  /** Unique ID of the permission request (from the CLI). */
  request_id: string;
  /** Tool name (e.g. "Bash", "Edit", "Write"). */
  tool_name: string;
  /** Tool input as a JSON value. */
  input: unknown;
}

export interface WorkspaceInfo {
  path?: string | null;
  name?: string | null;
}

export interface WorkspaceState {
  id: string;
  path: string;
  name: string;
}

/** Env overrides for the builtin engine — the only engine that never spawns a
 *  child process, so it is the one entry left in the old per-engine config
 *  map. Every CLI engine (claude/codex/codebuddy/cursor) launches through the
 *  ACP registry, whose entries carry their own launch `env` (Settings → ACP
 *  agents → manual launch config). */
export interface BuiltinModelConfig {
  /** Shared with Claude engine — Anthropic API key */
  ANTHROPIC_API_KEY?: string;
  /** Custom Anthropic API base URL */
  ANTHROPIC_BASE_URL?: string;
  /** Model override for builtin engine */
  ANTHROPIC_MODEL?: string;
}

export type EngineModelConfigs = BuiltinModelConfig;

export interface FileEntry {
  name: string;
  path: string;
  is_dir: boolean;
  size: number;
}

/** An agent skill discovered on disk (user-, project- or plugin-level). Uses the Claude agent skills standard (SKILL.md + frontmatter). */
export interface SkillEntry {
  name: string;
  description: string;
  source: "user" | "project" | "plugin";
  /** Text inserted into the input when picked, e.g. "/skill-name ". */
  invocation: string;
}

/** A configured plugin marketplace (Claude agent standard; `claude plugin marketplace list --json`). */
export interface MarketplaceInfo {
  name: string;
  source: string;
  repo: string;
  installLocation: string;
}

/** A plugin entry from `claude plugin list --json --available`. Fields beyond
 *  name/pluginId/marketplaceName/description are optional for resilience. */
export interface PluginInfo {
  pluginId: string;
  name: string;
  description: string;
  marketplaceName: string;
  version?: string;
  source?: string;
  installCount?: number;
}

export interface PluginCatalog {
  installed: PluginInfo[];
  available: PluginInfo[];
}

export type PixieApplicationSourceType = "github" | "local" | "local-link";

export interface PixieApplicationSource {
  type: PixieApplicationSourceType;
  url?: string;
  path?: string;
  branch?: string;
  commit?: string;
  linked?: boolean;
}

export interface PixieApplicationField {
  id: string;
  label?: string;
  type: string;
  required?: boolean;
  default?: unknown;
  options?: string[];
  schema?: string;
  path?: string;
  preview?: boolean;
  description?: string;
}

export interface PixieApplicationTemplateRef {
  id: string;
  version?: string;
}

export interface PixieApplicationAction {
  id: string;
  label?: string;
  description?: string;
  inputs?: string[];
  outputs?: string[];
  mode?: "agent" | "workflow" | "ui" | "tool" | string;
  workflow?: string;
}

export interface PixieApplicationManifest {
  schemaVersion?: string;
  id: string;
  name: string;
  version?: string;
  description?: string;
  author?: {
    name?: string;
    url?: string;
  };
  template?: PixieApplicationTemplateRef;
  entry: string;
  agent?: string;
  permissions?: string[];
  inputs?: PixieApplicationField[];
  outputs?: PixieApplicationField[];
  actions?: PixieApplicationAction[];
}

export interface PixieApplicationEntry {
  id: string;
  name: string;
  version?: string;
  description?: string;
  author?: PixieApplicationManifest["author"];
  template?: PixieApplicationTemplateRef;
  entry: string;
  agent?: string;
  permissions: string[];
  inputs: PixieApplicationField[];
  outputs: PixieApplicationField[];
  actions: PixieApplicationAction[];
  source: PixieApplicationSource;
  installPath: string;
  dataPath: string;
  installedAt: string;
}

export interface PixieApplicationRunRecord {
  id: string;
  appId: string;
  appName: string;
  appVersion?: string;
  sourceCommit?: string;
  actionId: string;
  engine: AgentEngineId | string;
  model?: string;
  inputs: Record<string, unknown>;
  outputs: Record<string, unknown>;
  rawResult: string;
  status: "ok" | "error" | "output_contract_failed" | "completed_with_parse_warning" | string;
  error?: string;
  startedAt: string;
  finishedAt: string;
}

/** A preview-open request (what callers pass to the handler). */
export type PreviewRequest =
  | { kind: "file"; path: string }
  | { kind: "url"; url: string };

/** PreviewRequest plus a nonce so the panel can re-open the same target. */
export type PreviewTarget = PreviewRequest & { nonce: number };

// ---------------------------------------------------------------------------
// Scheduled tasks
// ---------------------------------------------------------------------------

/** A schedule preset. `type` discriminant matches the Rust `#[serde(tag="type")]` enum.
 * Fields are authored in the user's LOCAL time. */
export type ScheduleSpec =
  | { type: "daily_time"; hour: number; minute: number }
  | { type: "every_n_minutes"; minutes: number }
  | { type: "every_n_hours"; hours: number }
  | { type: "weekdays_time"; hour: number; minute: number };

export interface ScheduledTask {
  id: string;
  name: string;
  /** Workspace folder path (= WorkspaceState.id/path). Used as the claude CWD. */
  workspace: string;
  prompt: string;
  schedule: ScheduleSpec;
  enabled: boolean;
  /** Engine to use for this task. Defaults to 'builtin'. */
  engine: AgentEngineId;
  /** ISO-8601 (UTC) of the next pending fire, or null when disabled. */
  next_run: string | null;
  /** ISO-8601 (UTC) of the last fire. */
  last_run: string | null;
}

/** A completed (or failed) scheduled-task execution record. */
export interface TaskRunRecord {
  id: string;
  task_id: string;
  task_name: string;
  workspace: string;
  prompt: string;
  result: string;
  status: "ok" | "error";
  started_at: string;
  finished_at: string;
}

// ---------------------------------------------------------------------------
// Loop tasks
// ---------------------------------------------------------------------------

/** An exit condition for a loop task. The loop terminates when ANY condition is met. */
export type LoopExitCondition =
  | { type: "max_iterations"; max: number }
  | { type: "no_error_pattern"; pattern: string }
  | { type: "success_pattern"; pattern: string }
  | { type: "output_unchanged"; streak: number }
  | { type: "manual_only" };

/** Current lifecycle state of a loop task. */
export type LoopTaskStatus = "idle" | "running" | "paused" | "completed" | "aborted" | "error";

/** A loop task: an iterative agent cycle that feeds each iteration's result
 *  back as context for the next one, until an exit condition is satisfied. */
export interface LoopTask {
  id: string;
  name: string;
  workspace: string;
  engine: AgentEngineId;
  /** Prompt for the first iteration. */
  initial_prompt: string;
  /** Template for subsequent iterations. `{{previous_result}}` is replaced
   *  with the last iteration's output. */
  result_template: string;
  /** Exit conditions — loop stops when ANY one is satisfied. */
  exit_conditions: LoopExitCondition[];
  /** Iterations completed so far (0 = not started). */
  iteration: number;
  status: LoopTaskStatus;
  /** Raw output of the most recent iteration. */
  last_result: string | null;
  /** Consecutive unchanged outputs for output_unchanged convergence tracking. */
  unchanged_streak: number;
  /** Optional schedule for automatic triggering. */
  schedule?: ScheduleSpec | null;
  next_run: string | null;
  last_run: string | null;
  enabled: boolean;
  created_at: string;
  /** Human-readable reason explaining why the loop was aborted or completed.
   *  For aborted: describes who stopped it (user/system) and why.
   *  For completed: describes which exit condition was satisfied. */
  completion_reason: string | null;
  /** Summary of changes made during the loop (extracted from tool use events).
   *  Populated when the loop completes successfully. */
  changes_summary: string | null;
}

/** Record of a single iteration within a loop cycle. */
export interface LoopIterationRecord {
  id: string;
  loop_task_id: string;
  iteration: number;
  /** The actual prompt sent (after template substitution). */
  prompt: string;
  result: string;
  status: "ok" | "error";
  started_at: string;
  finished_at: string;
  /** Whether any exit condition was satisfied after this iteration. */
  exit_met: boolean;
  /** Snapshot of PROGRESS.md from the workspace (if it exists). */
  progress_snapshot?: string | null;
}

export type DiffLineType = "context" | "add" | "delete";

export interface DiffLine {
  type: DiffLineType;
  /** Line content with the leading +/-/space prefix already stripped. */
  text: string;
  /** 1-based line number in the NEW file (undefined on pure deletions). */
  newNumber?: number;
  /** 1-based line number in the OLD file (undefined on pure additions). */
  oldNumber?: number;
  /** True when the original line had no trailing newline ("\ No newline..."). */
  noNewline?: boolean;
}

export interface DiffHunk {
  /** Header, e.g. "@@ -10,5 +10,7 @@". */
  header: string;
  lines: DiffLine[];
}

export type DiffFileStatus = "added" | "modified" | "deleted" | "renamed";

export interface DiffFile {
  /** Display path (the new path, or the old path for deletions). */
  path: string;
  /** Previous path when the file was renamed/moved. */
  oldPath?: string;
  status: DiffFileStatus;
  /** True for binary changes (no textual hunks). */
  binary: boolean;
  hunks: DiffHunk[];
  /** Added line count across all hunks. */
  additions: number;
  /** Removed line count across all hunks. */
  deletions: number;
}

export interface ParsedDiff {
  files: DiffFile[];
  /** True when no `diff --git` blocks could be parsed. */
  empty: boolean;
}

/** Render mode for the diff viewer. */
export type DiffViewMode = "unified" | "split";

/** BM25 search result from the knowledge base. */
export interface KbSearchResult {
  title: string;
  conversation_id: string;
  path: string;
  snippet: string;
  tags: string[];
  created: string;
  score: number;
}

/** Statistics about the search index. */
export interface SearchIndexStats {
  doc_count: number;
  term_count: number;
}
