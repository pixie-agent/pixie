import { useMemo, useState } from "react";
import type { ScheduledTask, ScheduleSpec, TaskRunRecord, WorkspaceState, AgentEngineId } from "../types";
import { AGENT_ENGINES } from "../types";
import { useDragRegion } from "../hooks/useDragRegion";
import { useTranslation } from "../hooks/useTranslation";
import { formatSchedule, relativeFromIso, pad, engineLabel } from "../lib/i18nFormat";

interface ScheduledTasksPanelProps {
  workspaces: WorkspaceState[];
  tasks: ScheduledTask[];
  runs: TaskRunRecord[];
  onCreate: (input: {
    name: string;
    workspace: string;
    prompt: string;
    schedule: ScheduleSpec;
    enabled: boolean;
    engine: AgentEngineId;
  }) => Promise<ScheduledTask | void>;
  onUpdate: (task: ScheduledTask) => Promise<void>;
  onDelete: (id: string) => Promise<void>;
  onToggle: (id: string, enabled: boolean) => Promise<void>;
  onRunNow: (id: string) => Promise<void>;
  onClose: () => void;
}

interface Draft {
  id: string | null; // null => creating a new task
  name: string;
  workspace: string;
  prompt: string;
  scheduleType: ScheduleSpec["type"];
  hour: number;
  minute: number;
  minutes: number;
  hours: number;
  enabled: boolean;
  engine: AgentEngineId;
}

function emptyDraft(defaultWorkspace: string): Draft {
  return {
    id: null,
    name: "",
    workspace: defaultWorkspace,
    prompt: "",
    scheduleType: "daily_time",
    hour: 9,
    minute: 0,
    minutes: 30,
    hours: 1,
    enabled: true,
    engine: "builtin",
  };
}

function taskToDraft(t: ScheduledTask): Draft {
  return {
    id: t.id,
    name: t.name,
    workspace: t.workspace,
    prompt: t.prompt,
    scheduleType: t.schedule.type,
    hour: t.schedule.type === "daily_time" || t.schedule.type === "weekdays_time" ? t.schedule.hour : 9,
    minute: t.schedule.type === "daily_time" || t.schedule.type === "weekdays_time" ? t.schedule.minute : 0,
    minutes: t.schedule.type === "every_n_minutes" ? t.schedule.minutes : 30,
    hours: t.schedule.type === "every_n_hours" ? t.schedule.hours : 1,
    enabled: t.enabled,
    engine: t.engine,
  };
}

function buildSpec(d: Draft): ScheduleSpec {
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

const inputClass =
  "w-full bg-[var(--bg-primary)] border border-[var(--border-color)] rounded-lg px-3 py-2 text-sm text-[var(--text-primary)] focus:outline-none focus:border-[var(--accent)]";

export default function ScheduledTasksPanel({
  workspaces,
  tasks,
  runs,
  onCreate,
  onUpdate,
  onDelete,
  onToggle,
  onRunNow,
  onClose,
}: ScheduledTasksPanelProps) {
  const { t } = useTranslation();
  const handleDragRegion = useDragRegion();
  const [draft, setDraft] = useState<Draft | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [expandedRun, setExpandedRun] = useState<string | null>(null);

  const workspaceName = (path: string) =>
    workspaces.find((w) => w.path === path)?.name ??
    path.split("/").filter(Boolean).pop() ??
    path;

  // Latest-first run history, capped for display.
  const recentRuns = useMemo(
    () =>
      [...runs]
        .sort((a, b) => Date.parse(b.finished_at) - Date.parse(a.finished_at))
        .slice(0, 50),
    [runs]
  );

  const startNew = () => {
    setError(null);
    setDraft(emptyDraft(workspaces[0]?.path ?? ""));
  };

  const saveDraft = async () => {
    if (!draft) return;
    if (!draft.name.trim()) return setError(t("tasks.errors.nameRequired"));
    if (!draft.workspace) return setError(t("tasks.errors.workspaceRequired"));
    if (!draft.prompt.trim()) return setError(t("tasks.errors.promptRequired"));
    const spec = buildSpec(draft);
    try {
      if (draft.id) {
        // Preserve schedule-derived runtime fields; backend recomputes next_run.
        await onUpdate({
          id: draft.id,
          name: draft.name.trim(),
          workspace: draft.workspace,
          prompt: draft.prompt.trim(),
          schedule: spec,
          enabled: draft.enabled,
          engine: draft.engine,
          next_run: null,
          last_run: null,
        });
      } else {
        await onCreate({
          name: draft.name.trim(),
          workspace: draft.workspace,
          prompt: draft.prompt.trim(),
          schedule: spec,
          enabled: draft.enabled,
          engine: draft.engine,
        });
      }
      setDraft(null);
      setError(null);
    } catch (e) {
      setError(String(e));
    }
  };

  return (
    <div className="settings-enter flex flex-col flex-1 min-h-0 bg-[var(--bg-secondary)]">
        {/* Header — drag empty areas to move window */}
        <div
          onMouseDown={handleDragRegion}
          className="shrink-0 flex items-center justify-between px-5 py-4 border-b border-[var(--border-color)]"
        >
          <h2 className="text-base font-semibold text-[var(--text-primary)]">
            {t("tasks.title")}
          </h2>
          <button
            onClick={onClose}
            className="p-1.5 rounded-lg hover:bg-[var(--bg-tertiary)] text-[var(--text-secondary)] transition-colors"
            aria-label={t("common.close")}
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

        <div className="flex-1 overflow-y-auto p-5 space-y-6">
          {/* New-task button */}
          {!draft && (
            <button
              onClick={startNew}
              disabled={workspaces.length === 0}
              className="w-full flex items-center justify-center gap-2 px-3 py-2 rounded-lg bg-[var(--accent)] hover:bg-[var(--accent-hover)] disabled:opacity-40 disabled:cursor-not-allowed text-white text-xs font-medium transition-colors"
            >
              <svg width="14" height="14" viewBox="0 0 14 14" fill="currentColor">
                <path
                  d="M7 1v12M1 7h12"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  fill="none"
                />
              </svg>
              {t("tasks.newTask")}
            </button>
          )}

          {/* Create / edit form */}
          {draft && (
            <section className="bg-[var(--bg-primary)] rounded-xl p-4 border border-[var(--border-color)] space-y-3">
              <h3 className="text-sm font-semibold text-[var(--text-primary)]">
                {draft.id ? t("tasks.edit") : t("tasks.newTask")}
              </h3>

              <div>
                <label className="block text-xs text-[var(--text-secondary)] mb-1">
                  {t("common.name")}
                </label>
                <input
                  className={inputClass}
                  value={draft.name}
                  onChange={(e) => setDraft({ ...draft, name: e.target.value })}
                  placeholder={t("tasks.namePlaceholder")}
                />
              </div>

              <div>
                <label className="block text-xs text-[var(--text-secondary)] mb-1">
                  {t("tasks.workspace")}
                </label>
                <select
                  className={inputClass}
                  value={draft.workspace}
                  onChange={(e) => setDraft({ ...draft, workspace: e.target.value })}
                >
                  {workspaces.length === 0 && <option value="">{t("common.noWorkspaces")}</option>}
                  {workspaces.map((w) => (
                    <option key={w.path} value={w.path}>
                      {w.name}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-xs text-[var(--text-secondary)] mb-1">
                  {t("tasks.prompt")}
                </label>
                <textarea
                  className={`${inputClass} resize-y min-h-[80px]`}
                  value={draft.prompt}
                  onChange={(e) => setDraft({ ...draft, prompt: e.target.value })}
                  placeholder={t("tasks.promptPlaceholder")}
                />
              </div>

              <div>
                <label className="block text-xs text-[var(--text-secondary)] mb-1">
                  {t("common.engine")}
                </label>
                <select
                  className={inputClass}
                  value={draft.engine}
                  onChange={(e) => setDraft({ ...draft, engine: e.target.value as AgentEngineId })}
                >
                  {AGENT_ENGINES.map((e) => (
                    <option key={e.id} value={e.id}>{engineLabel(e.id, t)}</option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-xs text-[var(--text-secondary)] mb-1">
                  {t("tasks.schedule")}
                </label>
                <select
                  className={inputClass}
                  value={draft.scheduleType}
                  onChange={(e) =>
                    setDraft({ ...draft, scheduleType: e.target.value as ScheduleSpec["type"] })
                  }
                >
                  <option value="daily_time">{t("schedule.dailyAtTime")}</option>
                  <option value="weekdays_time">{t("schedule.weekdaysAtTime")}</option>
                  <option value="every_n_minutes">{t("schedule.everyNMinutesLabel")}</option>
                  <option value="every_n_hours">{t("schedule.everyNHoursLabel")}</option>
                </select>
              </div>

              {(draft.scheduleType === "daily_time" ||
                draft.scheduleType === "weekdays_time") && (
                <div>
                  <label className="block text-xs text-[var(--text-secondary)] mb-1">
                    {t("schedule.time24h")}
                  </label>
                  <input
                    type="time"
                    className={inputClass}
                    value={`${pad(draft.hour)}:${pad(draft.minute)}`}
                    onChange={(e) => {
                      const [h, m] = e.target.value.split(":").map((n) => parseInt(n, 10));
                      setDraft({
                        ...draft,
                        hour: Number.isNaN(h) ? draft.hour : h,
                        minute: Number.isNaN(m) ? draft.minute : m,
                      });
                    }}
                  />
                </div>
              )}

              {draft.scheduleType === "every_n_minutes" && (
                <div>
                  <label className="block text-xs text-[var(--text-secondary)] mb-1">
                    {t("schedule.everyNMinutesLabel")}
                  </label>
                  <input
                    type="number"
                    min={1}
                    className={inputClass}
                    value={draft.minutes}
                    onChange={(e) =>
                      setDraft({ ...draft, minutes: Math.max(1, Number(e.target.value) || 1) })
                    }
                  />
                </div>
              )}

              {draft.scheduleType === "every_n_hours" && (
                <div>
                  <label className="block text-xs text-[var(--text-secondary)] mb-1">
                    {t("schedule.everyNHoursLabel")}
                  </label>
                  <input
                    type="number"
                    min={1}
                    className={inputClass}
                    value={draft.hours}
                    onChange={(e) =>
                      setDraft({ ...draft, hours: Math.max(1, Number(e.target.value) || 1) })
                    }
                  />
                </div>
              )}

              <label className="flex items-center gap-2 text-sm text-[var(--text-primary)] cursor-pointer">
                <input
                  type="checkbox"
                  checked={draft.enabled}
                  onChange={(e) => setDraft({ ...draft, enabled: e.target.checked })}
                  className="accent-[var(--accent)]"
                />
                {t("tasks.enabled")}
              </label>

              {error && <p className="text-xs text-red-400">{error}</p>}

              <div className="flex gap-2 pt-1">
                <button
                  onClick={saveDraft}
                  className="flex-1 px-3 py-2 rounded-lg bg-[var(--accent)] hover:bg-[var(--accent-hover)] text-white text-xs font-medium transition-colors"
                >
                  {draft.id ? t("common.save") : t("common.create")}
                </button>
                <button
                  onClick={() => {
                    setDraft(null);
                    setError(null);
                  }}
                  className="px-3 py-2 rounded-lg bg-[var(--bg-tertiary)] hover:opacity-80 text-[var(--text-primary)] text-xs font-medium transition-colors"
                >
                  {t("common.cancel")}
                </button>
              </div>
            </section>
          )}

          {/* Task list */}
          <section className="space-y-2">
            {tasks.length === 0 && !draft && (
              <p className="text-xs text-[var(--text-secondary)] text-center py-4">
                {t("tasks.noTasks")}
              </p>
            )}
            {tasks.map((task) => {
              const wsMissing = !workspaces.some((w) => w.path === task.workspace);
              return (
                <div
                  key={task.id}
                  className="bg-[var(--bg-primary)] rounded-xl p-3 border border-[var(--border-color)]"
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="text-sm font-medium text-[var(--text-primary)] truncate">
                          {task.name}
                        </span>
                        {!task.enabled && (
                          <span className="text-[10px] px-1.5 py-0.5 rounded bg-[var(--bg-tertiary)] text-[var(--text-secondary)]">
                            {t("common.disabled")}
                          </span>
                        )}
                      </div>
                      <p
                        className={`text-xs truncate ${
                          wsMissing ? "text-red-400" : "text-[var(--text-secondary)]"
                        }`}
                        title={task.workspace}
                      >
                        {wsMissing ? t("tasks.missingWorkspace") : ""}
                        {workspaceName(task.workspace)}
                      </p>
                    </div>
                    <button
                      onClick={() => onToggle(task.id, !task.enabled)}
                      title={task.enabled ? t("tasks.toggleDisable") : t("tasks.toggleEnable")}
                      className={`shrink-0 w-9 h-5 rounded-full transition-colors relative ${
                        task.enabled ? "bg-[var(--accent)]" : "bg-[var(--bg-tertiary)]"
                      }`}
                    >
                      <span
                        className={`absolute top-0.5 w-4 h-4 rounded-full bg-white transition-all ${
                          task.enabled ? "left-4" : "left-0.5"
                        }`}
                      />
                    </button>
                  </div>

                  <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-[var(--text-secondary)]">
                    <span>⏱ {formatSchedule(task.schedule, t)}</span>
                    <span>{t("schedule.next")}: {relativeFromIso(task.next_run, t)}</span>
                    <span>{t("schedule.last")}: {relativeFromIso(task.last_run, t)}</span>
                  </div>

                  <div className="mt-2 flex items-center gap-2">
                    <button
                      onClick={() => onRunNow(task.id)}
                      className="px-2.5 py-1 rounded-lg bg-[var(--bg-tertiary)] hover:bg-[var(--accent)]/20 text-[11px] text-[var(--text-primary)] transition-colors"
                    >
                      {t("tasks.runNow")}
                    </button>
                    <button
                      onClick={() => {
                        setError(null);
                        setDraft(taskToDraft(task));
                      }}
                      className="px-2.5 py-1 rounded-lg bg-[var(--bg-tertiary)] hover:opacity-80 text-[11px] text-[var(--text-primary)] transition-colors"
                    >
                      {t("common.edit")}
                    </button>
                    <button
                      onClick={() => {
                        if (confirm(t("tasks.deleteConfirm", { name: task.name }))) onDelete(task.id);
                      }}
                      className="px-2.5 py-1 rounded-lg bg-[var(--bg-tertiary)] hover:bg-red-500/20 hover:text-red-300 text-[11px] text-[var(--text-secondary)] transition-colors"
                    >
                      {t("common.delete")}
                    </button>
                  </div>
                </div>
              );
            })}
          </section>

          {/* Recent runs */}
          {recentRuns.length > 0 && (
            <section>
              <h3 className="text-sm font-semibold text-[var(--text-primary)] mb-3">
                {t("tasks.recentRuns")}
              </h3>
              <div className="space-y-2">
                {recentRuns.map((r) => (
                  <div
                    key={r.id}
                    className="bg-[var(--bg-primary)] rounded-xl p-3 border border-[var(--border-color)]"
                  >
                    <button
                      onClick={() =>
                        setExpandedRun(expandedRun === r.id ? null : r.id)
                      }
                      className="w-full flex items-center justify-between gap-2 text-left"
                    >
                      <span className="text-sm text-[var(--text-primary)] truncate">
                        {r.task_name}
                      </span>
                      <span
                        className={`text-[10px] px-1.5 py-0.5 rounded shrink-0 ${
                          r.status === "ok"
                            ? "bg-green-500/15 text-green-400"
                            : "bg-red-500/15 text-red-400"
                        }`}
                      >
                        {r.status === "ok" ? t("common.ok") : t("common.error")}
                      </span>
                    </button>
                    <div className="mt-1 text-[11px] text-[var(--text-secondary)]">
                      {relativeFromIso(r.finished_at, t)} · {workspaceName(r.workspace)}
                    </div>
                    {expandedRun === r.id && (
                      <div className="mt-2 space-y-2 text-xs">
                        <div>
                          <div className="text-[var(--text-secondary)] mb-0.5">{t("tasks.prompt")}</div>
                          <div className="whitespace-pre-wrap text-[var(--text-primary)] bg-[var(--bg-tertiary)]/40 rounded p-2">
                            {r.prompt}
                          </div>
                        </div>
                        <div>
                          <div className="text-[var(--text-secondary)] mb-0.5">{t("common.result")}</div>
                          <div className="whitespace-pre-wrap text-[var(--text-primary)] bg-[var(--bg-tertiary)]/40 rounded p-2 max-h-64 overflow-y-auto">
                            {r.result || (r.status === "error" ? t("common.failed") : t("common.noOutput"))}
                          </div>
                        </div>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </section>
          )}
        </div>
    </div>
  );
}
