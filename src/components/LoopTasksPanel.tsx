import { useState, useEffect } from "react";
import type {
  LoopTask,
  LoopExitCondition,
  LoopIterationRecord,
  LoopTaskStatus,
  ScheduleSpec,
  WorkspaceState,
  AgentEngineId,
} from "../types";
import { AGENT_ENGINES } from "../types";
import { useDragRegion } from "../hooks/useDragRegion";

interface LoopTasksPanelProps {
  workspaces: WorkspaceState[];
  /** Currently-active workspace path — preselected for new loops when available. */
  activeWorkspacePath?: string | null;
  tasks: LoopTask[];
  iterations: LoopIterationRecord[];
  onCreate: (input: {
    name: string;
    workspace: string;
    engine: AgentEngineId;
    initial_prompt: string;
    result_template: string;
    exit_conditions: LoopExitCondition[];
    schedule?: ScheduleSpec | null;
    enabled: boolean;
  }) => Promise<LoopTask | void>;
  onUpdate: (task: LoopTask) => Promise<void>;
  onDelete: (id: string) => Promise<void>;
  onToggle: (id: string, enabled: boolean) => Promise<void>;
  onStart: (id: string) => Promise<void>;
  onPause: (id: string) => Promise<void>;
  onResume: (id: string) => Promise<void>;
  onResumeWithPrompt: (id: string, userPrompt: string) => Promise<void>;
  onStop: (id: string) => Promise<void>;
  onDiscard: (id: string) => Promise<void>;
  onLoadIterations: (taskId: string) => Promise<void>;
  onClose: () => void;
}

function formatSchedule(s: ScheduleSpec): string {
  switch (s.type) {
    case "daily_time":
      return `Daily at ${String(s.hour).padStart(2, "0")}:${String(s.minute).padStart(2, "0")}`;
    case "weekdays_time":
      return `Weekdays at ${String(s.hour).padStart(2, "0")}:${String(s.minute).padStart(2, "0")}`;
    case "every_n_minutes":
      return `Every ${s.minutes} min`;
    case "every_n_hours":
      return `Every ${s.hours} hr${s.hours > 1 ? "s" : ""}`;
  }
}

function relativeFromIso(iso: string | null): string {
  if (!iso) return "—";
  const ts = Date.parse(iso);
  if (Number.isNaN(ts)) return "—";
  const diff = ts - Date.now();
  const abs = Math.abs(diff);
  const mins = Math.floor(abs / 60000);
  const fmt = (val: number, unit: string) =>
    `${val}${unit} ${diff >= 0 ? "from now" : "ago"}`;
  if (mins < 1) return diff >= 0 ? "in a moment" : "just now";
  if (mins < 60) return fmt(mins, "m");
  const hours = Math.floor(mins / 60);
  if (hours < 24) return fmt(hours, "h");
  const days = Math.floor(hours / 24);
  return fmt(days, "d");
}

function formatExitCondition(c: LoopExitCondition): string {
  switch (c.type) {
    case "max_iterations":
      return `Max ${c.max} iterations`;
    case "no_error_pattern":
      return `No errors matching: /${c.pattern}/`;
    case "success_pattern":
      return `Success when matching: /${c.pattern}/`;
    case "output_unchanged":
      return `Stop after ${c.streak} unchanged iteration${c.streak > 1 ? "s" : ""}`;
    case "manual_only":
      return "Manual stop only";
  }
}

function statusColor(s: LoopTaskStatus): string {
  switch (s) {
    case "idle":
      return "bg-[var(--bg-tertiary)] text-[var(--text-secondary)]";
    case "running":
      return "bg-blue-500/15 text-blue-400";
    case "paused":
      return "bg-yellow-500/15 text-yellow-400";
    case "completed":
      return "bg-green-500/15 text-green-400";
    case "aborted":
      return "bg-orange-500/15 text-orange-400";
    case "error":
      return "bg-red-500/15 text-red-400";
  }
}

function statusLabel(s: LoopTaskStatus): string {
  switch (s) {
    case "idle": return "Idle";
    case "running": return "Running";
    case "paused": return "Paused";
    case "completed": return "Completed";
    case "aborted": return "Aborted";
    case "error": return "Error";
  }
}

interface ExitConditionDraft {
  type: LoopExitCondition["type"];
  max: number;
  pattern: string;
}

interface Draft {
  id: string | null;
  name: string;
  workspace: string;
  engine: AgentEngineId;
  initial_prompt: string;
  result_template: string;
  exitConditions: ExitConditionDraft[];
  hasSchedule: boolean;
  scheduleType: ScheduleSpec["type"];
  hour: number;
  minute: number;
  minutes: number;
  hours: number;
  enabled: boolean;
}

function emptyDraft(defaultWorkspace: string): Draft {
  return {
    id: null,
    name: "",
    workspace: defaultWorkspace,
    engine: "builtin",
    initial_prompt: "",
    result_template: "Previous result:\n{{previous_result}}\n\nPlease continue fixing the issues above.",
    // Default: run until the output converges (no new findings), with a high
    // iteration cap as a safety guardrail — not a fixed pass count.
    exitConditions: [
      { type: "output_unchanged", max: 1, pattern: "" },
      { type: "max_iterations", max: 50, pattern: "" },
    ],
    hasSchedule: false,
    scheduleType: "daily_time",
    hour: 9,
    minute: 0,
    minutes: 30,
    hours: 1,
    enabled: true,
  };
}

function buildExitConditions(d: Draft): LoopExitCondition[] {
  return d.exitConditions
    .map((ec): LoopExitCondition => {
      switch (ec.type) {
        case "max_iterations":
          return { type: "max_iterations", max: ec.max };
        case "no_error_pattern":
          return { type: "no_error_pattern", pattern: ec.pattern };
        case "success_pattern":
          return { type: "success_pattern", pattern: ec.pattern };
        case "output_unchanged":
          return { type: "output_unchanged", streak: ec.max };
        case "manual_only":
          return { type: "manual_only" };
      }
    })
    .filter((c) => {
      if (c.type === "no_error_pattern" || c.type === "success_pattern") {
        return (c as { pattern: string }).pattern.trim().length > 0;
      }
      return true;
    });
}

function hasMaxIterationsGuardrail(conditions: LoopExitCondition[]): boolean {
  return conditions.some((c) => c.type === "max_iterations");
}

function ensurePreviousResultPlaceholder(template: string): string {
  if (template.includes("{{previous_result}}")) return template;
  const trimmed = template.trimEnd();
  const suffix = "Previous result:\n{{previous_result}}";
  return trimmed ? `${trimmed}\n\n${suffix}` : suffix;
}

function buildSchedule(d: Draft): ScheduleSpec | null {
  if (!d.hasSchedule) return null;
  switch (d.scheduleType) {
    case "daily_time":
      return { type: "daily_time", hour: d.hour, minute: d.minute };
    case "weekdays_time":
      return { type: "weekdays_time", hour: d.hour, minute: d.minute };
    case "every_n_minutes":
      return { type: "every_n_minutes", minutes: d.minutes };
    case "every_n_hours":
      return { type: "every_n_hours", hours: d.hours };
  }
}

/** Seed the edit form from an existing loop task. */
function taskToDraft(t: LoopTask, defaultWorkspace: string): Draft {
  const hasSchedule = !!t.schedule;
  const scheduleType = t.schedule?.type ?? "daily_time";
  const exitConditions: ExitConditionDraft[] = t.exit_conditions.length > 0
    ? t.exit_conditions.map((ec) => ({
        type: ec.type,
        // `max` holds the numeric threshold for both max_iterations and
        // output_unchanged (streak); pattern is only for regex conditions.
        max:
          ec.type === "max_iterations"
            ? ec.max
            : ec.type === "output_unchanged"
              ? ec.streak
              : 1,
        pattern: ec.type === "no_error_pattern" || ec.type === "success_pattern" ? ec.pattern : "",
      }))
    : [{ type: "output_unchanged", max: 1, pattern: "" }];
  if (!exitConditions.some((ec) => ec.type === "max_iterations")) {
    exitConditions.push({ type: "max_iterations", max: 50, pattern: "" });
  }
  return {
    id: t.id,
    name: t.name,
    workspace: t.workspace || defaultWorkspace,
    engine: t.engine,
    initial_prompt: t.initial_prompt,
    result_template: ensurePreviousResultPlaceholder(t.result_template),
    exitConditions,
    hasSchedule,
    scheduleType,
    hour: t.schedule && (t.schedule.type === "daily_time" || t.schedule.type === "weekdays_time") ? t.schedule.hour : 9,
    minute: t.schedule && (t.schedule.type === "daily_time" || t.schedule.type === "weekdays_time") ? t.schedule.minute : 0,
    minutes: t.schedule?.type === "every_n_minutes" ? t.schedule.minutes : 30,
    hours: t.schedule?.type === "every_n_hours" ? t.schedule.hours : 1,
    enabled: t.enabled,
  };
}

// Base input styles WITHOUT a width, so inline controls (exit-condition rows)
// can set their own width without fighting `w-full` (Tailwind can't reliably
// override a same-specificity utility). Use `inputClass` for full-width fields.
const inputBaseClass =
  "bg-[var(--bg-primary)] border border-[var(--border-color)] rounded-lg px-3 py-2 text-sm text-[var(--text-primary)] focus:outline-none focus:border-[var(--accent)]";
const inputClass = `${inputBaseClass} w-full`;

export default function LoopTasksPanel({
  workspaces,
  activeWorkspacePath,
  tasks,
  iterations,
  onCreate,
  onUpdate,
  onDelete,
  onToggle,
  onStart,
  onPause,
  onResume,
  onResumeWithPrompt,
  onStop,
  onDiscard,
  onLoadIterations,
  onClose,
}: LoopTasksPanelProps) {
  const handleDragRegion = useDragRegion();
  const [draft, setDraft] = useState<Draft | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [selectedTaskId, setSelectedTaskId] = useState<string | null>(null);
  /** Task id whose "resume with note" input is open (paused loops only). */
  const [resumeNoteId, setResumeNoteId] = useState<string | null>(null);
  const [resumeNoteText, setResumeNoteText] = useState("");
  /** Task id with an action in flight — disables its buttons to prevent double-fire. */
  const [busyId, setBusyId] = useState<string | null>(null);

  const defaultWorkspace =
    (activeWorkspacePath && workspaces.some((w) => w.path === activeWorkspacePath)
      ? activeWorkspacePath
      : workspaces[0]?.path) ?? "";

  // Allow users to freely switch between tasks, even when one is running.
  // The running task is highlighted but doesn't lock the panel.
  const effectiveSelectedId = selectedTaskId;

  // Load iterations for whatever is currently shown (the only real side effect).
  useEffect(() => {
    if (effectiveSelectedId) void onLoadIterations(effectiveSelectedId);
  }, [effectiveSelectedId, onLoadIterations]);

  const workspaceName = (path: string) =>
    workspaces.find((w) => w.path === path)?.name ?? path.split("/").filter(Boolean).pop() ?? path;

  const selectedTask = tasks.find((t) => t.id === effectiveSelectedId);
  const selectedIterations = effectiveSelectedId
    ? iterations
        .filter((i) => i.loop_task_id === effectiveSelectedId)
        .sort((a, b) => a.iteration - b.iteration)
    : [];

  const maxIterForTask = (t: LoopTask): number | null => {
    const mi = t.exit_conditions.find((c) => c.type === "max_iterations");
    return mi ? (mi as { max: number }).max : null;
  };

  const startNew = () => {
    setError(null);
    setDraft(emptyDraft(defaultWorkspace));
  };

  const startEdit = (t: LoopTask) => {
    setError(null);
    setSelectedTaskId(null);
    setDraft(taskToDraft(t, defaultWorkspace));
  };

  const saveDraft = async () => {
    if (!draft) return;
    if (!draft.name.trim()) return setError("Name is required");
    if (!draft.workspace) return setError("Pick a workspace");
    if (!draft.initial_prompt.trim()) return setError("Initial prompt is required");
    if (!draft.result_template.trim()) return setError("Result template is required");
    if (!draft.result_template.includes("{{previous_result}}")) {
      return setError("Result template must include {{previous_result}}");
    }
    const exitConditions = buildExitConditions(draft);
    if (exitConditions.length === 0) return setError("At least one exit condition is required");
    if (!hasMaxIterationsGuardrail(exitConditions)) {
      return setError("Add a max iterations condition as a safety guardrail");
    }
    const schedule = buildSchedule(draft);
    try {
      if (draft.id) {
        // Edit: preserve runtime fields, only replace editable ones.
        const existing = tasks.find((t) => t.id === draft.id);
        if (!existing) return setError("Loop not found");
        await onUpdate({
          ...existing,
          name: draft.name.trim(),
          workspace: draft.workspace,
          engine: draft.engine,
          initial_prompt: draft.initial_prompt.trim(),
          result_template: draft.result_template.trim(),
          exit_conditions: exitConditions,
          schedule,
          enabled: draft.enabled,
        });
      } else {
        await onCreate({
          name: draft.name.trim(),
          workspace: draft.workspace,
          engine: draft.engine,
          initial_prompt: draft.initial_prompt.trim(),
          result_template: draft.result_template.trim(),
          exit_conditions: exitConditions,
          schedule,
          enabled: draft.enabled,
        });
      }
      setDraft(null);
      setError(null);
    } catch (e) {
      setError(String(e));
    }
  };

  /** Run a control action, guarding against double-fire and surfacing errors. */
  const runAction = async (id: string, fn: (id: string) => Promise<void>) => {
    if (busyId) return;
    setBusyId(id);
    setResumeNoteId(null);
    try {
      await fn(id);
    } catch (e) {
      setError(String(e));
    } finally {
      setBusyId(null);
    }
  };

  /** Stop the selected loop, after a confirmation (destructive: interrupts the run). */
  const stopSelected = () => {
    if (!confirm(`Stop "${selectedTask?.name}"? The current iteration will be interrupted.`)) return;
    if (selectedTask) void runAction(selectedTask.id, onStop);
  };

  /** Start (or restart) the selected loop. Restart confirms since it resets progress. */
  const startSelected = () => {
    if (!selectedTask) return;
    if (
      selectedTask.iteration > 0 &&
      !confirm(
        `Restart "${selectedTask.name}"? This resets the iteration count and previous result to start a fresh cycle.`
      )
    )
      return;
    void runAction(selectedTask.id, onStart);
  };

  const submitResumeWithNote = (id: string) => {
    const note = resumeNoteText.trim();
    if (!note) {
      setResumeNoteId(null);
      return;
    }
    void runAction(id, (tid) => onResumeWithPrompt(tid, note));
    setResumeNoteText("");
  };

  const addExitCondition = () => {
    if (!draft) return;
    setDraft({
      ...draft,
      exitConditions: [...draft.exitConditions, { type: "max_iterations", max: 10, pattern: "" }],
    });
  };

  const removeExitCondition = (idx: number) => {
    if (!draft) return;
    const newConditions = draft.exitConditions.filter((_, i) => i !== idx);
    if (newConditions.length === 0) return;
    setDraft({ ...draft, exitConditions: newConditions });
  };

  const updateExitCondition = (idx: number, field: string, value: unknown) => {
    if (!draft) return;
    const newConditions = [...draft.exitConditions];
    newConditions[idx] = { ...newConditions[idx], [field]: value };
    setDraft({ ...draft, exitConditions: newConditions });
  };

  const handleSelectTask = (taskId: string) => {
    if (effectiveSelectedId === taskId) {
      setSelectedTaskId(null);
    } else {
      setSelectedTaskId(taskId);
    }
  };

  return (
    <div className="settings-enter flex flex-col flex-1 min-h-0 bg-[var(--bg-secondary)]">
      {/* Header */}
      <div
        onMouseDown={handleDragRegion}
        className="shrink-0 flex items-center justify-between px-5 py-4 border-b border-[var(--border-color)]"
      >
        <h2 className="text-base font-semibold text-[var(--text-primary)]">
          Loops
        </h2>
        <button
          onClick={onClose}
          className="p-1.5 rounded-lg hover:bg-[var(--bg-tertiary)] text-[var(--text-secondary)] transition-colors"
        >
          <svg width="18" height="18" viewBox="0 0 18 18" fill="currentColor">
            <path
              d="M4 4L14 14M14 4L4 14"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              fill="none"
            />
          </svg>
        </button>
      </div>

      <div className="flex-1 overflow-y-auto p-5 space-y-4">
        {/* Create form */}
        {draft && (
          <section className="bg-[var(--bg-primary)] rounded-xl p-4 border border-[var(--border-color)] space-y-3">
            <h3 className="text-sm font-semibold text-[var(--text-primary)]">
              {draft.id ? "Edit Loop" : "New Loop"}
            </h3>

            <div>
              <label className="block text-xs text-[var(--text-secondary)] mb-1">Name</label>
              <input
                className={inputClass}
                value={draft.name}
                onChange={(e) => setDraft({ ...draft, name: e.target.value })}
                placeholder="e.g. Fix lint errors iteratively"
              />
            </div>

            <div>
              <label className="block text-xs text-[var(--text-secondary)] mb-1">Workspace</label>
              <select
                className={inputClass}
                value={draft.workspace}
                onChange={(e) => setDraft({ ...draft, workspace: e.target.value })}
              >
                {workspaces.length === 0 && <option value="">No workspaces</option>}
                {workspaces.map((w) => (
                  <option key={w.path} value={w.path}>{w.name}</option>
                ))}
              </select>
            </div>

            <div>
              <label className="block text-xs text-[var(--text-secondary)] mb-1">Engine</label>
              <select
                className={inputClass}
                value={draft.engine}
                onChange={(e) => setDraft({ ...draft, engine: e.target.value as AgentEngineId })}
              >
                {AGENT_ENGINES.map((e) => (
                  <option key={e.id} value={e.id}>{e.label}</option>
                ))}
              </select>
            </div>

            <div>
              <label className="block text-xs text-[var(--text-secondary)] mb-1">Initial Prompt</label>
              <textarea
                className={`${inputClass} resize-y min-h-[80px]`}
                value={draft.initial_prompt}
                onChange={(e) => setDraft({ ...draft, initial_prompt: e.target.value })}
                placeholder="The prompt for the first iteration"
              />
            </div>

            <div>
              <label className="block text-xs text-[var(--text-secondary)] mb-1">Result Template</label>
              <textarea
                className={`${inputClass} resize-y min-h-[80px]`}
                value={draft.result_template}
                onChange={(e) => setDraft({ ...draft, result_template: e.target.value })}
                placeholder="Template for subsequent iterations"
              />
              <p className="text-[10px] text-[var(--text-secondary)] mt-1">
                Use <code className="text-[var(--accent)]">{"{{previous_result}}"}</code> to inject the previous iteration&apos;s output.
              </p>
            </div>

            {/* Exit conditions */}
            <div>
              <label className="block text-xs text-[var(--text-secondary)] mb-1">Exit Conditions</label>
              <div className="space-y-2">
                {draft.exitConditions.map((ec, idx) => (
                  <div key={idx} className="flex items-start gap-2">
                    <select
                      className={`${inputBaseClass} w-auto shrink-0`}
                      value={ec.type}
                      onChange={(e) =>
                        updateExitCondition(idx, "type", e.target.value as LoopExitCondition["type"])
                      }
                    >
                      <option value="max_iterations">Max iterations</option>
                      <option value="no_error_pattern">No error pattern</option>
                      <option value="success_pattern">Success pattern</option>
                      <option value="output_unchanged">Output unchanged</option>
                      <option value="manual_only">Manual only</option>
                    </select>
                    {ec.type === "max_iterations" && (
                      <input
                        type="number"
                        min={1}
                        max={100}
                        className={`${inputBaseClass} w-20 shrink-0`}
                        value={ec.max}
                        onChange={(e) =>
                          updateExitCondition(idx, "max", Math.max(1, Number(e.target.value) || 1))
                        }
                      />
                    )}
                    {ec.type === "output_unchanged" && (
                      <input
                        type="number"
                        min={1}
                        max={20}
                        className={`${inputBaseClass} w-20 shrink-0`}
                        value={ec.max}
                        title="Stop after this many consecutive iterations produce unchanged output"
                        onChange={(e) =>
                          updateExitCondition(idx, "max", Math.max(1, Number(e.target.value) || 1))
                        }
                      />
                    )}
                    {(ec.type === "no_error_pattern" || ec.type === "success_pattern") && (
                      <input
                        className={`${inputBaseClass} flex-1 min-w-0`}
                        value={ec.pattern}
                        onChange={(e) => updateExitCondition(idx, "pattern", e.target.value)}
                        placeholder="Regex pattern"
                      />
                    )}
                    {draft.exitConditions.length > 1 && (
                      <button
                        onClick={() => removeExitCondition(idx)}
                        className="shrink-0 p-1 rounded hover:bg-red-500/20 text-red-400 text-xs transition-colors"
                      >
                        ✕
                      </button>
                    )}
                  </div>
                ))}
                <button
                  onClick={addExitCondition}
                  className="text-xs text-[var(--accent)] hover:underline"
                >
                  + Add condition
                </button>
              </div>
            </div>

            {/* Optional schedule */}
            <div>
              <label className="flex items-center gap-2 text-xs text-[var(--text-secondary)] cursor-pointer">
                <input
                  type="checkbox"
                  checked={draft.hasSchedule}
                  onChange={(e) => setDraft({ ...draft, hasSchedule: e.target.checked })}
                  className="accent-[var(--accent)]"
                />
                Schedule automatically
              </label>
              {draft.hasSchedule && (
                <div className="mt-2 space-y-2">
                  <select
                    className={inputClass}
                    value={draft.scheduleType}
                    onChange={(e) =>
                      setDraft({ ...draft, scheduleType: e.target.value as ScheduleSpec["type"] })
                    }
                  >
                    <option value="daily_time">Daily at a time</option>
                    <option value="weekdays_time">Weekdays at a time</option>
                    <option value="every_n_minutes">Every N minutes</option>
                    <option value="every_n_hours">Every N hours</option>
                  </select>
                  {(draft.scheduleType === "daily_time" || draft.scheduleType === "weekdays_time") && (
                    <input
                      type="time"
                      className={inputClass}
                      value={`${String(draft.hour).padStart(2, "0")}:${String(draft.minute).padStart(2, "0")}`}
                      onChange={(e) => {
                        const [h, m] = e.target.value.split(":").map((n) => parseInt(n, 10));
                        setDraft({
                          ...draft,
                          hour: Number.isNaN(h) ? draft.hour : h,
                          minute: Number.isNaN(m) ? draft.minute : m,
                        });
                      }}
                    />
                  )}
                  {draft.scheduleType === "every_n_minutes" && (
                    <input
                      type="number" min={1} className={inputClass}
                      value={draft.minutes}
                      onChange={(e) => setDraft({ ...draft, minutes: Math.max(1, Number(e.target.value) || 1) })}
                    />
                  )}
                  {draft.scheduleType === "every_n_hours" && (
                    <input
                      type="number" min={1} className={inputClass}
                      value={draft.hours}
                      onChange={(e) => setDraft({ ...draft, hours: Math.max(1, Number(e.target.value) || 1) })}
                    />
                  )}
                </div>
              )}
            </div>

            <label className="flex items-center gap-2 text-sm text-[var(--text-primary)] cursor-pointer">
              <input
                type="checkbox"
                checked={draft.enabled}
                onChange={(e) => setDraft({ ...draft, enabled: e.target.checked })}
                className="accent-[var(--accent)]"
              />
              Enabled
            </label>

            {error && <p className="text-xs text-red-400">{error}</p>}

            <div className="flex gap-2 pt-1">
              <button
                onClick={saveDraft}
                className="flex-1 px-3 py-2 rounded-lg bg-[var(--accent)] hover:bg-[var(--accent-hover)] text-white text-xs font-medium transition-colors"
              >
                {draft.id ? "Save" : "Create"}
              </button>
              <button
                onClick={() => { setDraft(null); setError(null); }}
                className="px-3 py-2 rounded-lg bg-[var(--bg-tertiary)] hover:opacity-80 text-[var(--text-primary)] text-xs font-medium transition-colors"
              >
                Cancel
              </button>
            </div>
          </section>
        )}

        {/* Task list — click to select and see detail */}
        {!draft && (
          <section className="space-y-2">
            {/* New-loop button */}
            <button
              onClick={startNew}
              disabled={workspaces.length === 0}
              className="w-full flex items-center justify-center gap-2 px-3 py-2 rounded-lg bg-[var(--accent)] hover:bg-[var(--accent-hover)] disabled:opacity-40 disabled:cursor-not-allowed text-white text-xs font-medium transition-colors"
            >
              <svg width="14" height="14" viewBox="0 0 14 14" fill="currentColor">
                <path d="M7 1v12M1 7h12" stroke="currentColor" strokeWidth="2" strokeLinecap="round" fill="none" />
              </svg>
              New Loop
            </button>
            {tasks.length === 0 && (
              <p className="text-xs text-[var(--text-secondary)] text-center py-4">
                No loops yet. Create one to set up an iterative agent cycle.
              </p>
            )}
            {tasks.map((t) => {
              const isSelected = effectiveSelectedId === t.id;
              const maxIter = maxIterForTask(t);
              return (
                <button
                  key={t.id}
                  onClick={() => handleSelectTask(t.id)}
                  className={`w-full text-left bg-[var(--bg-primary)] rounded-xl p-3 border transition-colors ${
                    isSelected
                      ? "border-[var(--accent)] bg-[var(--accent)]/5"
                      : "border-[var(--border-color)] hover:border-[var(--accent)]/50"
                  }`}
                  title={t.completion_reason ?? undefined}
                >
                  <div className="flex items-center gap-2">
                    {t.status === "running" && (
                      <div className="w-2.5 h-2.5 border-2 border-blue-400 border-t-transparent rounded-full animate-spin" />
                    )}
                    <span className="text-sm font-medium text-[var(--text-primary)] truncate">
                      {t.name}
                    </span>
                    <span className={`text-[10px] px-1.5 py-0.5 rounded ${statusColor(t.status)}`}>
                      {statusLabel(t.status)}
                    </span>
                    {!t.enabled && (
                      <span className="text-[10px] px-1.5 py-0.5 rounded bg-[var(--bg-tertiary)] text-[var(--text-secondary)]">
                        Disabled
                      </span>
                    )}
                  </div>
                  <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-[var(--text-secondary)]">
                    <span>{workspaceName(t.workspace)}</span>
                    <span>{AGENT_ENGINES.find((e) => e.id === t.engine)?.label ?? t.engine}</span>
                    <span>
                      Iter {t.iteration}{maxIter ? `/${maxIter}` : ""}
                    </span>
                    {t.schedule && <span>⏱ {formatSchedule(t.schedule)}</span>}
                    {t.last_run && <span>last: {relativeFromIso(t.last_run)}</span>}
                  </div>
                  {/* Show completion reason inline for completed/aborted tasks */}
                  {t.completion_reason && (t.status === "completed" || t.status === "aborted") && (
                    <div className="mt-1.5 text-[10px] text-[var(--text-secondary)] truncate" title={t.completion_reason}>
                      {t.completion_reason}
                    </div>
                  )}
                  {/* Inline delete for completed/aborted/error loops */}
                  {(t.status === "completed" || t.status === "aborted" || t.status === "error" || (t.status === "idle" && t.iteration === 0)) && (
                    <div className="mt-1">
                      <span
                        onClick={(e) => {
                          e.stopPropagation();
                          if (confirm(`Delete loop "${t.name}"?`)) onDelete(t.id);
                        }}
                        className="text-[10px] text-red-400/60 hover:text-red-400 cursor-pointer transition-colors"
                      >
                        delete
                      </span>
                    </div>
                  )}
                </button>
              );
            })}
          </section>
        )}

        {/* Selected task detail panel */}
        {selectedTask && !draft && (
          <section className="bg-[var(--bg-primary)] rounded-xl border border-[var(--accent)]/30 p-4 space-y-4">
            {/* Header with status */}
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                {selectedTask.status === "running" && (
                  <div className="w-3 h-3 border-2 border-blue-400 border-t-transparent rounded-full animate-spin" />
                )}
                <h3 className="text-sm font-semibold text-[var(--text-primary)]">
                  {selectedTask.name}
                </h3>
                <span className={`text-[10px] px-1.5 py-0.5 rounded ${statusColor(selectedTask.status)}`}>
                  {statusLabel(selectedTask.status)}
                </span>
                {!selectedTask.enabled && (
                  <span className="text-[10px] px-1.5 py-0.5 rounded bg-[var(--bg-tertiary)] text-[var(--text-secondary)]">
                    Disabled
                  </span>
                )}
              </div>
              <button
                onClick={() => setSelectedTaskId(null)}
                className="p-1 rounded hover:bg-[var(--bg-tertiary)] text-[var(--text-secondary)] transition-colors"
              >
                <svg width="14" height="14" viewBox="0 0 14 14" fill="currentColor">
                  <path d="M4 4L10 10M10 4L4 10" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" fill="none" />
                </svg>
              </button>
            </div>

            {/* Meta info */}
            <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-[var(--text-secondary)]">
              <span>{workspaceName(selectedTask.workspace)}</span>
              <span>{AGENT_ENGINES.find((e) => e.id === selectedTask.engine)?.label}</span>
              <span>Iteration {selectedTask.iteration}{maxIterForTask(selectedTask) ? `/${maxIterForTask(selectedTask)}` : ""}</span>
            </div>

            {/* Exit conditions summary */}
            <div className="text-xs text-[var(--text-secondary)]">
              <span className="font-medium text-[var(--text-primary)]">Exit:</span>{" "}
              {selectedTask.exit_conditions.map((c, i) => (
                <span key={i}>{formatExitCondition(c)}{i < selectedTask.exit_conditions.length - 1 ? ", " : ""}</span>
              ))}
            </div>

            {/* Control bar — actions depend on lifecycle state. */}
            <div className="space-y-2">
              <div className="flex flex-wrap items-center gap-2">
                {/* Not running → Start (fresh cycle). */}
                {(selectedTask.status === "idle" ||
                  selectedTask.status === "completed" ||
                  selectedTask.status === "aborted" ||
                  selectedTask.status === "error") && (
                  <button
                    onClick={startSelected}
                    disabled={!!busyId || !selectedTask.enabled}
                    title={!selectedTask.enabled ? "Enable this loop before starting it" : undefined}
                    className="px-3 py-1.5 rounded-lg bg-[var(--accent)] hover:bg-[var(--accent-hover)] disabled:opacity-40 text-white text-[11px] font-medium transition-colors"
                  >
                    {selectedTask.iteration > 0 ? "Restart" : "Start"}
                  </button>
                )}
                {/* Running → Pause + Stop. */}
                {selectedTask.status === "running" && (
                  <>
                    <button
                      onClick={() => runAction(selectedTask.id, onPause)}
                      disabled={!!busyId}
                      className="px-2.5 py-1 rounded-lg bg-[var(--bg-tertiary)] hover:opacity-80 disabled:opacity-40 text-[11px] text-[var(--text-primary)] transition-colors"
                    >
                      Pause
                    </button>
                    <button
                      onClick={stopSelected}
                      disabled={!!busyId}
                      className="px-2.5 py-1 rounded-lg bg-[var(--bg-tertiary)] hover:bg-red-500/20 hover:text-red-300 disabled:opacity-40 text-[11px] text-[var(--text-secondary)] transition-colors"
                    >
                      Stop
                    </button>
                  </>
                )}
                {/* Paused → Resume (+ with note), Stop, Discard. */}
                {selectedTask.status === "paused" && (
                  <>
                    <button
                      onClick={() => runAction(selectedTask.id, onResume)}
                      disabled={!!busyId || !selectedTask.enabled}
                      title={!selectedTask.enabled ? "Enable this loop before resuming it" : undefined}
                      className="px-3 py-1.5 rounded-lg bg-[var(--accent)] hover:bg-[var(--accent-hover)] disabled:opacity-40 text-white text-[11px] font-medium transition-colors"
                    >
                      Resume
                    </button>
                    <button
                      onClick={() =>
                        setResumeNoteId(resumeNoteId === selectedTask.id ? null : selectedTask.id)
                      }
                      disabled={!!busyId || !selectedTask.enabled}
                      title={!selectedTask.enabled ? "Enable this loop before resuming it" : undefined}
                      className="px-2.5 py-1 rounded-lg bg-[var(--bg-tertiary)] hover:opacity-80 disabled:opacity-40 text-[11px] text-[var(--text-primary)] transition-colors"
                    >
                      Resume with note…
                    </button>
                    <button
                      onClick={stopSelected}
                      disabled={!!busyId}
                      className="px-2.5 py-1 rounded-lg bg-[var(--bg-tertiary)] hover:bg-red-500/20 hover:text-red-300 disabled:opacity-40 text-[11px] text-[var(--text-secondary)] transition-colors"
                    >
                      Stop
                    </button>
                    <button
                      onClick={() => {
                        if (confirm(`Discard loop "${selectedTask.name}"? It will be disabled and cannot restart.`))
                          runAction(selectedTask.id, onDiscard);
                      }}
                      disabled={!!busyId}
                      className="px-2.5 py-1 rounded-lg bg-[var(--bg-tertiary)] hover:bg-red-500/20 hover:text-red-300 disabled:opacity-40 text-[11px] text-[var(--text-secondary)] transition-colors"
                    >
                      Discard
                    </button>
                  </>
                )}
                {/* Edit — only when not actively running. */}
                {selectedTask.status !== "running" && (
                  <button
                    onClick={() => startEdit(selectedTask)}
                    disabled={!!busyId}
                    className="px-2.5 py-1 rounded-lg bg-[var(--bg-tertiary)] hover:opacity-80 disabled:opacity-40 text-[11px] text-[var(--text-primary)] transition-colors"
                  >
                    Edit
                  </button>
                )}
                {/* Enable toggle — gates both manual starts and automatic schedules. */}
                <label className="flex items-center gap-1.5 ml-auto text-[11px] text-[var(--text-secondary)] cursor-pointer">
                  <span>{selectedTask.enabled ? "Enabled" : "Disabled"}</span>
                  <button
                    onClick={() => runAction(selectedTask.id, (id) => onToggle(id, !selectedTask.enabled))}
                    disabled={!!busyId}
                    title={selectedTask.enabled ? "Disable loop" : "Enable loop"}
                    className={`w-9 h-5 rounded-full transition-colors relative shrink-0 ${
                      selectedTask.enabled ? "bg-[var(--accent)]" : "bg-[var(--bg-tertiary)]"
                    }`}
                  >
                    <span
                      className={`absolute top-0.5 w-4 h-4 rounded-full bg-white transition-all ${
                        selectedTask.enabled ? "left-4" : "left-0.5"
                      }`}
                    />
                  </button>
                </label>
              </div>

              {/* Resume-with-note inline input (human-in-the-loop). */}
              {selectedTask.status === "paused" && resumeNoteId === selectedTask.id && (
                <div className="space-y-2 bg-[var(--bg-secondary)] rounded-lg p-2">
                  <textarea
                    className={`${inputClass} resize-y min-h-[60px]`}
                    value={resumeNoteText}
                    onChange={(e) => setResumeNoteText(e.target.value)}
                    placeholder="Add a note for the next iteration (appended to the previous result)…"
                    autoFocus
                  />
                  <div className="flex justify-end gap-2">
                    <button
                      onClick={() => { setResumeNoteId(null); setResumeNoteText(""); }}
                      className="px-2.5 py-1 rounded-lg bg-[var(--bg-tertiary)] hover:opacity-80 text-[11px] text-[var(--text-primary)] transition-colors"
                    >
                      Cancel
                    </button>
                    <button
                      onClick={() => submitResumeWithNote(selectedTask.id)}
                      disabled={!resumeNoteText.trim() || !!busyId || !selectedTask.enabled}
                      title={!selectedTask.enabled ? "Enable this loop before resuming it" : undefined}
                      className="px-3 py-1 rounded-lg bg-[var(--accent)] hover:bg-[var(--accent-hover)] disabled:opacity-40 text-white text-[11px] font-medium transition-colors"
                    >
                      Resume
                    </button>
                  </div>
                </div>
              )}
            </div>

            {/* Progress bar */}
            {selectedTask.iteration > 0 && (() => {
              const max = maxIterForTask(selectedTask);
              const pct = max ? Math.min((selectedTask.iteration / max) * 100, 100) : 0;
              return (
                <div className="space-y-1">
                  <div className="flex items-center justify-between text-[11px] text-[var(--text-secondary)]">
                    <span>Progress</span>
                    <span>{selectedTask.iteration}{max ? ` of ${max}` : ""} iterations</span>
                  </div>
                  <div className="h-1.5 bg-[var(--bg-tertiary)] rounded-full overflow-hidden">
                    <div
                      className={`h-full rounded-full transition-all ${
                        selectedTask.status === "completed"
                          ? "bg-green-400"
                          : selectedTask.status === "running"
                            ? "bg-blue-400"
                            : selectedTask.status === "aborted"
                              ? "bg-orange-400"
                              : "bg-[var(--accent)]"
                      }`}
                      style={{ width: max ? `${pct}%` : `${Math.min(selectedTask.iteration * 10, 100)}%` }}
                    />
                  </div>
                </div>
              );
            })()}

            {/* Running indicator */}
            {selectedTask.status === "running" && (
              <div className="flex items-center gap-2 text-xs text-blue-400 bg-blue-500/10 rounded-lg px-3 py-2">
                <div className="w-2.5 h-2.5 border-2 border-blue-400 border-t-transparent rounded-full animate-spin" />
                Iteration {selectedTask.iteration + 1} in progress…
              </div>
            )}

            {/* Iteration timeline */}
            {selectedIterations.length > 0 && (
              <div className="space-y-1">
                <h4 className="text-xs font-medium text-[var(--text-primary)]">Iteration Timeline</h4>
                <div className="space-y-1">
                  {selectedIterations.map((iter) => (
                    <IterationRow key={iter.id} iter={iter} />
                  ))}
                </div>
              </div>
            )}

            {/* Final result — friendly display */}
            {(selectedTask.status === "completed" || selectedTask.status === "aborted") &&
              selectedIterations.length > 0 && (() => {
                const last = selectedIterations[selectedIterations.length - 1];
                const exitIter = selectedIterations.find((i) => i.exit_met);
                const resultIter = exitIter ?? last;
                return (
                  <div className="space-y-3">
                    {/* Completion reason */}
                    {selectedTask.completion_reason && (
                      <div className={`rounded-lg p-3 text-xs ${
                        selectedTask.status === "completed"
                          ? "bg-green-500/5 border border-green-500/20"
                          : "bg-orange-500/5 border border-orange-500/20"
                      }`}>
                        <div className="flex items-center gap-2 mb-1">
                          {selectedTask.status === "completed" ? (
                            <svg className="w-4 h-4 text-green-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
                            </svg>
                          ) : (
                            <svg className="w-4 h-4 text-orange-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
                            </svg>
                          )}
                          <span className={`font-medium ${
                            selectedTask.status === "completed" ? "text-green-400" : "text-orange-400"
                          }`}>
                            {selectedTask.status === "completed" ? "Loop completed" : "Loop stopped"}
                          </span>
                        </div>
                        <p className="text-[var(--text-primary)] leading-relaxed">
                          {selectedTask.completion_reason}
                        </p>
                      </div>
                    )}

                    {/* Changes summary */}
                    {selectedTask.changes_summary && (
                      <div className="rounded-lg p-3 bg-blue-500/5 border border-blue-500/20">
                        <div className="flex items-center gap-2 mb-1">
                          <svg className="w-4 h-4 text-blue-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5H7a2 2 0 00-2 2v10a2 2 0 002 2h8a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-3 7h3m-3 4h3m-6-4h.01M9 16h.01" />
                          </svg>
                          <span className="font-medium text-blue-400 text-xs">Changes made</span>
                        </div>
                        <p className="text-[var(--text-primary)] text-xs leading-relaxed">
                          {selectedTask.changes_summary}
                        </p>
                      </div>
                    )}

                    {/* Result card */}
                    <div className="space-y-2">
                      <h4 className="text-xs font-medium text-[var(--text-primary)]">
                        {selectedTask.status === "completed" ? "Final Result" : "Last Result (aborted)"}
                      </h4>
                      <ResultCard iter={resultIter} />
                    </div>
                  </div>
                );
              })()}
          </section>
        )}
      </div>
    </div>
  );
}

/** A single iteration row in the timeline — compact, expandable. */
function IterationRow({ iter }: { iter: LoopIterationRecord }) {
  const [expanded, setExpanded] = useState(false);
  const durationMs = Date.parse(iter.finished_at) - Date.parse(iter.started_at);
  const duration = durationMs > 0 ? `${Math.round(durationMs / 1000)}s` : "—";

  return (
    <div
      className={`rounded-lg text-[11px] transition-colors ${
        iter.exit_met
          ? "bg-green-500/10 border border-green-500/20"
          : iter.status === "error"
            ? "bg-red-500/10 border border-red-500/20"
            : "bg-[var(--bg-tertiary)]/50"
      }`}
    >
      <button
        onClick={() => setExpanded(!expanded)}
        className="w-full flex items-center justify-between gap-2 px-2 py-1.5 text-left"
      >
        <div className="flex items-center gap-2 min-w-0">
          <span className="font-medium text-[var(--text-primary)] shrink-0">
            #{iter.iteration}
          </span>
          <span className={`shrink-0 text-[10px] px-1 py-0.5 rounded ${
            iter.status === "ok" ? "bg-green-500/15 text-green-400" : "bg-red-500/15 text-red-400"
          }`}>
            {iter.status === "ok" ? "OK" : "ERR"}
          </span>
          {iter.exit_met && (
            <span className="shrink-0 text-[10px] px-1 py-0.5 rounded bg-[var(--accent)]/15 text-[var(--accent)]">
              exit
            </span>
          )}
          <span className="text-[var(--text-secondary)] truncate">
            {iter.result.slice(0, 80)}{iter.result.length > 80 ? "…" : ""}
          </span>
        </div>
        <span className="text-[var(--text-secondary)] shrink-0">{duration}</span>
      </button>
      {expanded && (
        <div className="px-2 pb-2 space-y-2 text-xs">
          <div>
            <div className="text-[var(--text-secondary)] mb-0.5 font-medium">Prompt</div>
            <div className="whitespace-pre-wrap text-[var(--text-primary)] bg-[var(--bg-secondary)] rounded p-2 max-h-48 overflow-y-auto font-mono text-[11px]">
              {iter.prompt}
            </div>
          </div>
          <div>
            <div className="text-[var(--text-secondary)] mb-0.5 font-medium">Result</div>
            <div className="whitespace-pre-wrap text-[var(--text-primary)] bg-[var(--bg-secondary)] rounded p-2 max-h-48 overflow-y-auto font-mono text-[11px]">
              {iter.result || (iter.status === "error" ? "(failed)" : "(no output)")}
            </div>
          </div>
          {iter.progress_snapshot && (
            <div>
              <div className="text-[var(--text-secondary)] mb-0.5 font-medium">PROGRESS.md</div>
              <div className="whitespace-pre-wrap text-[var(--text-primary)] bg-[var(--bg-secondary)] rounded p-2 max-h-48 overflow-y-auto font-mono text-[11px]">
                {iter.progress_snapshot}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

/** Friendly display of a loop's final/last result. */
function ResultCard({ iter }: { iter: LoopIterationRecord }) {
  const durationMs = Date.parse(iter.finished_at) - Date.parse(iter.started_at);
  const duration = durationMs > 0 ? `${Math.round(durationMs / 1000)}s` : "—";

  return (
    <div className={`rounded-lg p-3 space-y-2 ${
      iter.exit_met
        ? "bg-green-500/5 border border-green-500/20"
        : "bg-[var(--bg-tertiary)]/50 border border-[var(--border-color)]"
    }`}>
      <div className="flex items-center justify-between text-xs">
        <div className="flex items-center gap-2">
          <span className={`px-1.5 py-0.5 rounded text-[10px] ${
            iter.status === "ok" ? "bg-green-500/15 text-green-400" : "bg-red-500/15 text-red-400"
          }`}>
            {iter.status === "ok" ? "Success" : "Error"}
          </span>
          {iter.exit_met && (
            <span className="px-1.5 py-0.5 rounded text-[10px] bg-[var(--accent)]/15 text-[var(--accent)]">
              Exit condition met
            </span>
          )}
          <span className="text-[var(--text-secondary)]">
            Iteration #{iter.iteration} · {duration}
          </span>
        </div>
      </div>
      <div className="whitespace-pre-wrap text-[var(--text-primary)] text-xs leading-relaxed max-h-64 overflow-y-auto">
        {iter.result || (iter.status === "error" ? "(failed)" : "(no output)")}
      </div>
      {iter.progress_snapshot && (
        <div>
          <div className="text-[10px] text-[var(--text-secondary)] font-medium">PROGRESS.md snapshot</div>
          <div className="whitespace-pre-wrap text-[var(--text-secondary)] text-[11px] bg-[var(--bg-tertiary)]/30 rounded p-2 max-h-32 overflow-y-auto">
            {iter.progress_snapshot}
          </div>
        </div>
      )}
    </div>
  );
}
