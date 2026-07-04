import { useState, useMemo, useEffect, useRef, memo } from "react";
import { useTranslation } from "../hooks/useTranslation";
import { relativeTime as formatRelativeTime } from "../lib/i18nFormat";
import type { ConversationEntry } from "../hooks/useChat";
import type { WorkspaceState, AgentEngineId, EngineModelConfigs, LoopTask } from "../types";
import { useDragRegion } from "../hooks/useDragRegion";
import NewAgentModal from "./NewAgentModal";
import EngineBadge from "./EngineBadge";

interface SidebarProps {
  entries: ConversationEntry[];
  workspaces: WorkspaceState[];
  workspaceFilter: string | null;
  activeId: string | null;
  generatingIds: Set<string>;
  onSelect: (id: string, workspaceId: string) => void;
  onNew: (opts?: { workspaceId?: string; engine?: AgentEngineId; model?: string }) => void;
  onDelete: (id: string, workspaceId: string) => void;
  onRename: (id: string, newTitle: string) => void;
  onAddWorkspace: () => void;
  onRemoveWorkspace: (id: string) => void;
  onSetWorkspaceFilter: (id: string | null) => void;
  onOpenSettings: () => void;
  onOpenTasks: () => void;
  onOpenLoops: () => void;
  onOpenSkills: () => void;
  isOpen: boolean;
  onClose: () => void;
  defaultEngine: AgentEngineId;
  onDefaultEngineChange: (engine: AgentEngineId) => void;
  engineModelConfigs: EngineModelConfigs;
  /** Engine ids that are installed + ready; the New Agent picker is limited to these. */
  readyEngineIds: AgentEngineId[];
  defaultWorkspacePath: string;
  /** Active loop tasks — used to group loop-iteration conversations in the sidebar. */
  loopTasks: LoopTask[];
}

function workspaceName(workspaces: WorkspaceState[], id: string): string {
  return workspaces.find((w) => w.id === id)?.name ?? id.split("/").pop() ?? id;
}

/** Sessions updated within this window stay in the Active section. */
const ACTIVE_THRESHOLD_MS = 7 * 24 * 60 * 60 * 1000;

function isActiveEntry(entry: ConversationEntry, generatingIds: Set<string>): boolean {
  if (generatingIds.has(entry.conversation.id)) return true;
  return Date.now() - entry.conversation.updatedAt < ACTIVE_THRESHOLD_MS;
}

function sortEntries(entries: ConversationEntry[], generatingIds: Set<string>): ConversationEntry[] {
  return [...entries].sort((a, b) => {
    const aRun = generatingIds.has(a.conversation.id);
    const bRun = generatingIds.has(b.conversation.id);
    if (aRun !== bRun) return aRun ? -1 : 1;
    return b.conversation.updatedAt - a.conversation.updatedAt;
  });
}

const ConversationRow = memo(function ConversationRow({
  entry,
  workspaceLabel,
  isActive,
  isGenerating,
  onSelect,
  onDelete,
  onRename,
}: {
  entry: ConversationEntry;
  workspaceLabel?: string;
  isActive: boolean;
  isGenerating: boolean;
  onSelect: () => void;
  onDelete: () => void;
  onRename: (newTitle: string) => void;
}) {
  const { t, currentLanguage } = useTranslation();
  const { conversation: conv } = entry;
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [editing, setEditing] = useState(false);
  const [editValue, setEditValue] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  const startEditing = () => {
    setEditValue(conv.title);
    setEditing(true);
    setTimeout(() => inputRef.current?.select(), 0);
  };

  const commitEdit = () => {
    const trimmed = editValue.trim();
    if (trimmed && trimmed !== conv.title) {
      onRename(trimmed);
    }
    setEditing(false);
  };

  return (
    <div
      onClick={() => { setConfirmDelete(false); if (!editing) onSelect(); }}
      className={`
        group flex items-center gap-2 px-3 py-2.5 rounded-lg cursor-pointer mb-0.5
        transition-colors
        ${
          isActive
            ? "bg-[var(--bg-tertiary)] text-[var(--text-primary)]"
            : "text-[var(--text-secondary)] hover:bg-[var(--bg-tertiary)]/40"
        }
      `}
    >
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-1.5">
          {isGenerating && (
            <span className="shrink-0 w-2 h-2 rounded-full bg-green-400 animate-pulse" title={t('sidebar.generating')} />
          )}
          {editing ? (
            <input
              ref={inputRef}
              type="text"
              value={editValue}
              onChange={(e) => setEditValue(e.target.value)}
              onBlur={commitEdit}
              onKeyDown={(e) => {
                if (e.key === "Enter") commitEdit();
                if (e.key === "Escape") setEditing(false);
              }}
              onClick={(e) => e.stopPropagation()}
              className="flex-1 min-w-0 text-sm bg-[var(--bg-primary)] border border-[var(--accent)] rounded px-1 py-0 text-[var(--text-primary)] outline-none"
            />
          ) : (
            <p
              className="text-sm truncate leading-tight"
              onDoubleClick={(e) => { e.stopPropagation(); startEditing(); }}
            >
              {conv.title}
            </p>
          )}
        </div>
        <p className="text-[10px] mt-0.5 opacity-60 truncate flex items-center gap-1.5">
          {workspaceLabel ? (
            <>
              <span className="text-[var(--accent)]/80 truncate">{workspaceLabel}</span>
              <span className="opacity-60">·</span>
            </>
          ) : null}
          <EngineBadge engine={conv.engine} />
          <span className="opacity-60">·</span>
          <span>{formatRelativeTime(conv.updatedAt, t, currentLanguage)}</span>
        </p>
      </div>
      <button
        onClick={(e) => {
          e.stopPropagation();
          if (confirmDelete) {
            onDelete();
          } else {
            setConfirmDelete(true);
            setTimeout(() => setConfirmDelete(false), 3000);
          }
        }}
        className={`shrink-0 p-1 rounded transition-all ${
          confirmDelete
            ? "bg-red-500/30 text-red-400"
            : "opacity-0 group-hover:opacity-100 hover:bg-red-500/20 text-red-400"
        }`}
        title={confirmDelete ? t('common.confirmAgain') : t('sidebar.deleteConversation')}
        aria-label={confirmDelete ? t('common.confirmAgain') : t('sidebar.deleteConversation')}
      >
        <svg width="14" height="14" viewBox="0 0 14 14" fill="currentColor">
          <path d="M4.5 2h5a.5.5 0 010 1h-5a.5.5 0 010-1zM3 4h8l-.7 8.4a1 1 0 01-1 .9H4.7a1 1 0 01-1-.9L3 4zm2.5 2v5M7 6v5M8.5 6v5" stroke="currentColor" strokeWidth="1" fill="none" strokeLinecap="round" />
        </svg>
      </button>
    </div>
  );
});

function SectionHeader({
  label,
  count,
  expanded,
  onToggle,
  collapsible,
}: {
  label: string;
  count: number;
  expanded?: boolean;
  onToggle?: () => void;
  collapsible?: boolean;
}) {
  if (!collapsible) {
    return (
      <p className="px-2 py-1.5 text-[10px] uppercase tracking-wide text-[var(--text-secondary)] font-medium sticky top-0 bg-[var(--bg-secondary)] z-[1]">
        {label} · {count}
      </p>
    );
  }
  return (
    <button
      type="button"
      onClick={onToggle}
      className="w-full flex items-center gap-1.5 px-2 py-1.5 text-[10px] uppercase tracking-wide text-[var(--text-secondary)] font-medium sticky top-0 bg-[var(--bg-secondary)] z-[1] hover:text-[var(--text-primary)] transition-colors"
    >
      <svg
        width="10"
        height="10"
        viewBox="0 0 10 10"
        fill="none"
        className={`shrink-0 transition-transform ${expanded ? "rotate-90" : ""}`}
      >
        <path d="M3 2l4 3-4 3" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
      {label} · {count}
    </button>
  );
}

/** A collapsible group of loop iteration conversations under a loop task name. */
function LoopGroup({
  group,
  activeId,
  generatingIds,
  onSelect,
  onDelete,
}: {
  group: { taskId: string; taskName: string; status: LoopTask["status"]; entries: ConversationEntry[] };
  activeId: string | null;
  generatingIds: Set<string>;
  onSelect: (id: string, workspaceId: string) => void;
  onDelete: (id: string, workspaceId: string) => void;
}) {
  const { t, currentLanguage } = useTranslation();
  const [expanded, setExpanded] = useState(true);
  const isRunning = group.status === "running";

  const statusIcon = isRunning ? (
    <div className="w-2.5 h-2.5 border-2 border-blue-400 border-t-transparent rounded-full animate-spin shrink-0" />
  ) : null;

  return (
    <div className="mb-1">
      <button
        onClick={() => setExpanded((v) => !v)}
        className="w-full flex items-center gap-1.5 px-2 py-1 text-xs text-[var(--text-secondary)] hover:text-[var(--text-primary)] transition-colors"
      >
        <svg
          width="10" height="10" viewBox="0 0 10 10" fill="none"
          className={`shrink-0 transition-transform ${expanded ? "rotate-90" : ""}`}
        >
          <path d="M3 2l4 3-4 3" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
        {statusIcon}
        <svg width="12" height="12" viewBox="0 0 14 14" fill="none" className="shrink-0 text-[var(--text-secondary)]">
          <path d="M2 7a5 5 0 119 0 5 5 0 01-9 0z" stroke="currentColor" strokeWidth="1.2" />
          <path d="M7 2v2M7 10v2M2 7h2M10 7h2" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
        </svg>
        <span className="font-medium truncate">{group.taskName}</span>
        <span className="opacity-60">· {group.entries.length}</span>
      </button>
      {expanded && (
        <div className="pl-3">
          {group.entries.map((entry) => {
            const conv = entry.conversation;
            const isActive = conv.id === activeId;
            const isGenerating = generatingIds.has(conv.id);
            return (
              <div
                key={conv.id}
                onClick={() => onSelect(conv.id, entry.workspaceId)}
                className={`
                  group flex items-center gap-2 px-3 py-2 rounded-lg cursor-pointer mb-0.5
                  transition-colors
                  ${isActive
                    ? "bg-[var(--bg-tertiary)] text-[var(--text-primary)]"
                    : "text-[var(--text-secondary)] hover:bg-[var(--bg-tertiary)]/40"
                  }
                `}
              >
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-1.5">
                    {isGenerating && (
                      <span className="shrink-0 w-2 h-2 rounded-full bg-green-400 animate-pulse" title={t('sidebar.generating')} />
                    )}
                    <p className="text-sm truncate leading-tight">{conv.title}</p>
                  </div>
                  <p className="text-[10px] mt-0.5 opacity-60 truncate flex items-center gap-1.5">
                    <EngineBadge engine={conv.engine} />
                    <span className="opacity-60">·</span>
                    <span>{formatRelativeTime(conv.updatedAt, t, currentLanguage)}</span>
                  </p>
                </div>
                <button
                  onClick={(e) => { e.stopPropagation(); onDelete(conv.id, entry.workspaceId); }}
                  className="shrink-0 p-1 rounded opacity-0 group-hover:opacity-100 hover:bg-red-500/20 text-red-400 transition-all"
                  title={t('sidebar.deleteConversation')}
                  aria-label={t('sidebar.deleteConversation')}
                >
                  <svg width="14" height="14" viewBox="0 0 14 14" fill="currentColor">
                    <path d="M4.5 2h5a.5.5 0 010 1h-5a.5.5 0 010-1zM3 4h8l-.7 8.4a1 1 0 01-1 .9H4.7a1 1 0 01-1-.9L3 4zm2.5 2v5M7 6v5M8.5 6v5" stroke="currentColor" strokeWidth="1" fill="none" strokeLinecap="round" />
                  </svg>
                </button>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

function EntryList({
  entries,
  workspaces,
  defaultWorkspacePath,
  activeId,
  generatingIds,
  onSelect,
  onDelete,
  onRename,
}: {
  entries: ConversationEntry[];
  workspaces: WorkspaceState[];
  defaultWorkspacePath: string;
  activeId: string | null;
  generatingIds: Set<string>;
  onSelect: (id: string, workspaceId: string) => void;
  onDelete: (id: string, workspaceId: string) => void;
  onRename: (id: string, newTitle: string) => void;
}) {
  return (
    <>
      {entries.map((entry) => (
        <ConversationRow
          key={entry.conversation.id}
          entry={entry}
          workspaceLabel={
            defaultWorkspacePath && entry.workspaceId === defaultWorkspacePath
              ? undefined
              : workspaceName(workspaces, entry.workspaceId)
          }
          isActive={entry.conversation.id === activeId}
          isGenerating={generatingIds.has(entry.conversation.id)}
          onSelect={() => onSelect(entry.conversation.id, entry.workspaceId)}
          onDelete={() => onDelete(entry.conversation.id, entry.workspaceId)}
          onRename={(newTitle) => onRename(entry.conversation.id, newTitle)}
        />
      ))}
    </>
  );
}

export default function Sidebar({
  entries,
  workspaces,
  workspaceFilter,
  activeId,
  generatingIds,
  onSelect,
  onNew,
  onDelete,
  onRename,
  onAddWorkspace,
  onRemoveWorkspace,
  onSetWorkspaceFilter,
  onOpenSettings,
  onOpenTasks,
  onOpenLoops,
  onOpenSkills,
  isOpen,
  onClose,
  defaultEngine,
  onDefaultEngineChange,
  engineModelConfigs,
  readyEngineIds,
  defaultWorkspacePath,
  loopTasks,
}: SidebarProps) {
  const { t } = useTranslation();
  const [search, setSearch] = useState("");
  const [wsPendingRemove, setWsPendingRemove] = useState<string | null>(null);
  const [wsDropdownOpen, setWsDropdownOpen] = useState(false);
  const wsDropdownRef = useRef<HTMLDivElement>(null);
  const handleDragRegion = useDragRegion();

  // Close workspace dropdown on outside clicks
  useEffect(() => {
    if (!wsDropdownOpen) return;
    const handleClick = (e: MouseEvent) => {
      if (wsDropdownRef.current && !wsDropdownRef.current.contains(e.target as Node)) {
        setWsDropdownOpen(false);
      }
    };
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, [wsDropdownOpen]);

  const [historyExpanded, setHistoryExpanded] = useState(false);
  const [loopsExpanded, setLoopsExpanded] = useState(true);
  const [newAgentModalOpen, setNewAgentModalOpen] = useState(false);

  // The default engine may not be ready (e.g. the user logged it out since). The
  // quick "New Agent" button must use a ready engine, otherwise it would create
  // an unusable session.
  const effectiveDefaultEngine: AgentEngineId = readyEngineIds.includes(defaultEngine)
    ? defaultEngine
    : (readyEngineIds[0] ?? defaultEngine);

  // The auto-created default workspace (the configured default working dir) is
  // hidden from the UI — it stays as the implicit CWD but never appears in the
  // workspace list. `workspaces` (incl. the default) is still used elsewhere for
  // resolving conversation labels.
  const visibleWorkspaces = useMemo(
    () => workspaces.filter((w) => w.path !== defaultWorkspacePath),
    [workspaces, defaultWorkspacePath],
  );

  const defaultWorkspace = useMemo<WorkspaceState | null>(() => {
    if (!defaultWorkspacePath) return null;
    const base = defaultWorkspacePath.replace(/\\/g, "/").split("/").filter(Boolean).pop() ?? defaultWorkspacePath;
    return (
      workspaces.find((w) => w.path === defaultWorkspacePath) ?? {
        id: defaultWorkspacePath,
        path: defaultWorkspacePath,
        name: base,
      }
    );
  }, [workspaces, defaultWorkspacePath]);

  const newAgentWorkspaceOptions = useMemo(() => {
    const out: WorkspaceState[] = [];
    const seen = new Set<string>();
    if (defaultWorkspace && !seen.has(defaultWorkspace.id)) {
      out.push(defaultWorkspace);
      seen.add(defaultWorkspace.id);
    }
    for (const ws of visibleWorkspaces) {
      if (seen.has(ws.id)) continue;
      out.push(ws);
      seen.add(ws.id);
    }
    return out;
  }, [defaultWorkspace, visibleWorkspaces]);

  const filtered = useMemo(() => {
    let list = entries;
    if (workspaceFilter) {
      list = list.filter((e) => e.workspaceId === workspaceFilter);
    }
    if (search.trim()) {
      const q = search.toLowerCase();
      list = list.filter(
        (e) =>
          e.conversation.title.toLowerCase().includes(q) ||
          workspaceName(workspaces, e.workspaceId).toLowerCase().includes(q),
      );
    }
    return list;
  }, [entries, workspaceFilter, search, workspaces]);

  const { activeEntries, historyEntries, loopGroups } = useMemo(() => {
    const active: ConversationEntry[] = [];
    const history: ConversationEntry[] = [];
    const loopIterMap = new Map<string, { taskName: string; taskId: string; entries: ConversationEntry[] }>();

    for (const entry of filtered) {
      // Loop iteration conversations are grouped separately.
      if (entry.conversation.loopTaskId) {
        const key = entry.conversation.loopTaskId;
        const existing = loopIterMap.get(key);
        if (existing) {
          existing.entries.push(entry);
        } else {
          loopIterMap.set(key, {
            taskId: key,
            taskName: entry.conversation.loopTaskName ?? key,
            entries: [entry],
          });
        }
        continue;
      }
      if (isActiveEntry(entry, generatingIds)) {
        active.push(entry);
      } else {
        history.push(entry);
      }
    }

    // Build loop groups: each group keyed by taskId, with status from the
    // matching LoopTask and sorted iteration entries.
    const groups: { taskId: string; taskName: string; status: LoopTask["status"]; entries: ConversationEntry[] }[] = [];
    for (const [taskId, data] of loopIterMap) {
      const matchingTask = loopTasks.find((t) => t.id === taskId);
      groups.push({
        taskId,
        taskName: data.taskName,
        status: matchingTask?.status ?? "idle",
        entries: sortEntries(data.entries, generatingIds),
      });
    }
    // Running loops first, then by recent activity.
    groups.sort((a, b) => {
      if (a.status === "running" && b.status !== "running") return -1;
      if (b.status === "running" && a.status !== "running") return 1;
      const aLatest = a.entries[0]?.conversation.updatedAt ?? 0;
      const bLatest = b.entries[0]?.conversation.updatedAt ?? 0;
      return bLatest - aLatest;
    });

    return {
      activeEntries: sortEntries(active, generatingIds),
      historyEntries: sortEntries(history, generatingIds),
      loopGroups: groups,
    };
  }, [filtered, generatingIds, loopTasks]);

  const activeInHistory = useMemo(
    () => !!activeId && historyEntries.some((e) => e.conversation.id === activeId),
    [activeId, historyEntries],
  );
  const showHistoryExpanded = historyExpanded || activeInHistory;

  const isSearching = search.trim().length > 0;
  const newAgentTargetWs = workspaceFilter ?? newAgentWorkspaceOptions[0]?.id ?? null;

  return (
    <>
      {isOpen && (
        <div className="fixed inset-0 bg-black/50 z-30 lg:hidden" onClick={onClose} />
      )}

      <aside
        className={`
          fixed top-0 left-0 z-40 h-full w-[280px] bg-[var(--bg-secondary)] border-r border-[var(--border-color)]
          flex-col
          transition-transform duration-200 ease-out
          lg:relative
          ${isOpen ? "flex translate-x-0 sidebar-enter" : "hidden"}
        `}
      >
        {/* macOS traffic light drag region */}
        {navigator.platform?.includes("Mac") && (
          <div className="shrink-0 h-[38px]" onMouseDown={handleDragRegion} />
        )}
        {/* Workspace filter & management */}
        {visibleWorkspaces.length > 0 ? (
          <div className="px-3 py-2 border-b border-[var(--border-color)]">
            <div className="relative" ref={wsDropdownRef}>
              <button
                onClick={() => setWsDropdownOpen(!wsDropdownOpen)}
                className="w-full flex items-center justify-between bg-[var(--bg-primary)] border border-[var(--border-color)] rounded-lg px-3 py-1.5 text-xs text-[var(--text-primary)] outline-none focus:border-[var(--accent)] transition-colors cursor-pointer"
              >
                <span className="truncate">
                  {workspaceFilter
                    ? workspaces.find((w) => w.id === workspaceFilter)?.name ?? t('sidebar.allWorkspaces')
                    : t('sidebar.allWorkspaces')}
                </span>
                <svg width="12" height="12" viewBox="0 0 12 12" fill="none" className={`shrink-0 ml-2 text-[var(--text-secondary)] transition-transform duration-200 ${wsDropdownOpen ? "rotate-180" : ""}`}>
                  <path d="M3 4.5L6 7.5L9 4.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              </button>
              {wsDropdownOpen && (
                <div className="absolute top-full left-0 right-0 z-50 mt-1 bg-[var(--bg-primary)] border border-[var(--border-color)] rounded-lg shadow-lg overflow-hidden">
                    <button
                      onClick={() => { onSetWorkspaceFilter(null); setWsDropdownOpen(false); }}
                      className={`w-full flex items-center px-3 py-2 text-xs hover:bg-[var(--bg-tertiary)] transition-colors ${
                        workspaceFilter === null ? "text-[var(--accent)] font-medium" : "text-[var(--text-primary)]"
                      }`}
                    >
                      {t('sidebar.allWorkspaces')}
                    </button>
                    {visibleWorkspaces.map((ws) => (
                      <div
                        key={ws.id}
                        className={`flex items-center gap-2 px-3 py-2 text-xs hover:bg-[var(--bg-tertiary)] transition-colors ${
                          workspaceFilter === ws.id ? "text-[var(--accent)] font-medium" : "text-[var(--text-primary)]"
                        }`}
                      >
                        <button
                          onClick={() => { onSetWorkspaceFilter(ws.id); setWsDropdownOpen(false); }}
                          className="flex-1 min-w-0 truncate text-left"
                          title={ws.path}
                        >
                          {ws.name}
                        </button>
                        <button
                          onClick={() => {
                            if (wsPendingRemove === ws.id) {
                              onRemoveWorkspace(ws.id);
                              setWsPendingRemove(null);
                              setWsDropdownOpen(false);
                            } else {
                              setWsPendingRemove(ws.id);
                              setTimeout(() => setWsPendingRemove((prev) => prev === ws.id ? null : prev), 3000);
                            }
                          }}
                          className={`shrink-0 p-0.5 rounded transition-colors ${
                            wsPendingRemove === ws.id
                              ? "bg-red-500/30 text-red-400"
                              : "hover:bg-red-500/20 text-[var(--text-secondary)] hover:text-red-400"
                          }`}
                          title={wsPendingRemove === ws.id ? t('common.confirmAgain') : t('sidebar.removeWorkspace')}
                          aria-label={wsPendingRemove === ws.id ? t('common.confirmAgain') : t('sidebar.removeWorkspace')}
                        >
                          {wsPendingRemove === ws.id ? (
                            <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
                              <path d="M2 6h8" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
                            </svg>
                          ) : (
                            <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
                              <path d="M3 3l6 6M9 3l-6 6" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
                            </svg>
                          )}
                        </button>
                      </div>
                    ))}
                    <button
                      onClick={() => { onAddWorkspace(); setWsDropdownOpen(false); }}
                      className="w-full flex items-center gap-2 px-3 py-2 text-xs text-[var(--accent)] hover:bg-[var(--bg-tertiary)] transition-colors border-t border-[var(--border-color)]"
                    >
                      <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
                        <path d="M6 3v6M3 6h6" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
                      </svg>
                      {t('sidebar.addWorkspace')}
                    </button>
                  </div>
              )}
            </div>
          </div>
        ) : (
          <div className="px-3 py-2 border-b border-[var(--border-color)]">
            <button
              onClick={onAddWorkspace}
              className="w-full flex items-center justify-center gap-2 bg-[var(--accent)] hover:opacity-90 text-white rounded-lg px-3 py-2 text-xs font-medium transition-opacity cursor-pointer"
            >
              <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
                <path d="M6 3v6M3 6h6" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
              </svg>
              {t('sidebar.addWorkspace')}
            </button>
          </div>
        )}

        {/* Search */}
        <div className="px-3 py-2 border-b border-[var(--border-color)]">
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder={t('sidebar.searchAgents')}
            className="w-full bg-[var(--bg-primary)] border border-[var(--border-color)] rounded-lg px-3 py-1.5 text-xs text-[var(--text-primary)] placeholder-[var(--text-secondary)] outline-none focus:border-[var(--accent)] transition-colors"
          />
        </div>

        {/* Conversation list: Active + Loops groups + collapsible History */}
        <div className="flex-1 overflow-y-auto px-2 py-1">
          {filtered.length === 0 && (
            <p className="text-xs text-[var(--text-secondary)] text-center mt-8 px-2">
              {search
                ? t('sidebar.noMatchingAgents')
                : workspaces.length === 0
                  ? t('sidebar.addWorkspaceToStart')
                  : t('sidebar.noAgentsYet')}
            </p>
          )}

          {isSearching ? (
            <EntryList
              entries={sortEntries(filtered, generatingIds)}
              workspaces={workspaces}
              defaultWorkspacePath={defaultWorkspacePath}
              activeId={activeId}
              generatingIds={generatingIds}
              onSelect={onSelect}
              onDelete={onDelete}
              onRename={onRename}
            />
          ) : (
            <>
              {activeEntries.length > 0 && (
                <div className="mb-2">
                  <SectionHeader label={t('sidebar.active')} count={activeEntries.length} />
                  <EntryList
                    entries={activeEntries}
                    workspaces={workspaces}
                    defaultWorkspacePath={defaultWorkspacePath}
                    activeId={activeId}
                    generatingIds={generatingIds}
                    onSelect={onSelect}
                    onDelete={onDelete}
                    onRename={onRename}
                  />
                </div>
              )}

              {/* Loop iteration groups */}
              {loopGroups.length > 0 && (
                <div className="mb-2">
                  <SectionHeader
                    label={t('sidebar.loopsSection')}
                    count={loopGroups.reduce((s, g) => s + g.entries.length, 0)}
                    collapsible
                    expanded={loopsExpanded}
                    onToggle={() => setLoopsExpanded((v) => !v)}
                  />
                  {loopsExpanded && loopGroups.map((group) => (
                    <LoopGroup key={group.taskId} group={group} activeId={activeId} generatingIds={generatingIds} onSelect={onSelect} onDelete={onDelete} />
                  ))}
                </div>
              )}

              {historyEntries.length > 0 && (
                <div>
                  <SectionHeader
                    label={t('sidebar.history')}
                    count={historyEntries.length}
                    collapsible
                    expanded={showHistoryExpanded}
                    onToggle={() => {
                      if (activeInHistory) {
                        setHistoryExpanded(true);
                        return;
                      }
                      setHistoryExpanded((v) => !v);
                    }}
                  />
                  {showHistoryExpanded && (
                    <EntryList
                      entries={historyEntries}
                      workspaces={workspaces}
                      defaultWorkspacePath={defaultWorkspacePath}
                      activeId={activeId}
                      generatingIds={generatingIds}
                      onSelect={onSelect}
                      onDelete={onDelete}
                      onRename={onRename}
                    />
                  )}
                </div>
              )}
            </>
          )}
        </div>

        {/* Bottom bar */}
        <div className="px-3 py-2 border-t border-[var(--border-color)] space-y-1.5">
          <div className="flex gap-1.5">
            <button
              type="button"
              onClick={() => onNew({ workspaceId: newAgentTargetWs ?? undefined, engine: effectiveDefaultEngine })}
              className="flex-1 flex items-center justify-center gap-2 px-3 py-2 rounded-lg bg-[var(--accent)] hover:bg-[var(--accent-hover)] text-white text-xs font-medium transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
              disabled={!newAgentTargetWs}
              title={newAgentTargetWs ? t('sidebar.newAgentDefaults') : t('header.addWorkspaceFirst')}
            >
              <EngineBadge engine={effectiveDefaultEngine} tone="onAccent" />
              {t('sidebar.newAgent')}
            </button>
            <button
              type="button"
              onClick={() => setNewAgentModalOpen(true)}
              className="shrink-0 flex items-center justify-center px-2 py-2 rounded-lg bg-[var(--bg-tertiary)] hover:opacity-90 text-[var(--text-secondary)] hover:text-[var(--text-primary)] transition-opacity disabled:opacity-40 disabled:cursor-not-allowed"
              disabled={!newAgentTargetWs}
              title={t('sidebar.advancedOptions')}
            >
              {/* Sliders icon */}
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <line x1="4" y1="21" x2="4" y2="14" />
                <line x1="4" y1="10" x2="4" y2="3" />
                <line x1="12" y1="21" x2="12" y2="12" />
                <line x1="12" y1="8" x2="12" y2="3" />
                <line x1="20" y1="21" x2="20" y2="16" />
                <line x1="20" y1="12" x2="20" y2="3" />
                <line x1="2" y1="14" x2="6" y2="14" />
                <line x1="10" y1="8" x2="14" y2="8" />
                <line x1="18" y1="16" x2="22" y2="16" />
              </svg>
            </button>
          </div>
          <button
            onClick={onOpenLoops}
            className="w-full flex items-center gap-2 px-3 py-2 rounded-lg hover:bg-[var(--bg-tertiary)] text-[var(--text-secondary)] hover:text-[var(--text-primary)] text-xs transition-colors"
          >
            <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
              <path d="M2 7a5 5 0 119 0 5 5 0 01-9 0z" stroke="currentColor" strokeWidth="1.2" />
              <path d="M7 2v2M7 10v2M2 7h2M10 7h2" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
              <path d="M4.5 4.5l1 1M8.5 8.5l1 1M4.5 9.5l1-1M8.5 5.5l1-1" stroke="currentColor" strokeWidth="0.8" strokeLinecap="round" />
            </svg>
            {t('sidebar.loops')}
          </button>
          <button
            onClick={onOpenTasks}
            className="w-full flex items-center gap-2 px-3 py-2 rounded-lg hover:bg-[var(--bg-tertiary)] text-[var(--text-secondary)] hover:text-[var(--text-primary)] text-xs transition-colors"
          >
            <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
              <circle cx="7" cy="7" r="5.5" stroke="currentColor" strokeWidth="1.2" />
              <path d="M7 4v3l2 1.5" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
            {t('sidebar.tasks')}
          </button>
          <button
            onClick={onOpenSkills}
            className="w-full flex items-center gap-2 px-3 py-2 rounded-lg hover:bg-[var(--bg-tertiary)] text-[var(--text-secondary)] hover:text-[var(--text-primary)] text-xs transition-colors"
          >
            <svg
              width="14"
              height="14"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <path d="M12 3l1.9 4.8L18.7 9.7l-4.8 1.9L12 16.4l-1.9-4.8L5.3 9.7l4.8-1.9L12 3z" />
            </svg>
            {t('sidebar.skills')}
          </button>
          <button
            onClick={onOpenSettings}
            className="w-full flex items-center gap-2 px-3 py-2 rounded-lg hover:bg-[var(--bg-tertiary)] text-[var(--text-secondary)] hover:text-[var(--text-primary)] text-xs transition-colors"
          >
            <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
              <path d="M7 9a2 2 0 100-4 2 2 0 000 4z" stroke="currentColor" strokeWidth="1.2" fill="none" />
              <path d="M12.2 7c0-.3 0-.6-.1-.8l1.4-1.1-1.3-2.4-1.7.5c-.4-.3-.9-.6-1.4-.8L8.6.6h-2.8l-.4 1.8c-.5.2-1 .4-1.4.8l-1.7-.5-1.3 2.4 1.4 1.1c-.1.3-.1.6-.1.8s0 .6.1.8l-1.4 1.1 1.3 2.4 1.7-.5c.4.3.9.6 1.4.8l.4 1.8h2.8l.4-1.8c.5-.2 1-.4 1.4-.8l1.7.5 1.3-2.4-1.4-1.1c.1-.3.1-.6.1-.8z" stroke="currentColor" strokeWidth="1" fill="none" />
            </svg>
            {t('sidebar.settings')}
          </button>
        </div>
      </aside>

      {newAgentModalOpen && (
        <NewAgentModal
          workspaces={newAgentWorkspaceOptions}
          defaultWorkspaceId={newAgentTargetWs}
          defaultEngine={defaultEngine}
          engineModelConfigs={engineModelConfigs}
          readyEngineIds={readyEngineIds}
          onDefaultEngineChange={onDefaultEngineChange}
          onCreate={({ workspaceId, engine, model }) => {
            onNew({ workspaceId, engine, model });
          }}
          onClose={() => setNewAgentModalOpen(false)}
        />
      )}
    </>
  );
}
