import { useState, useMemo, useRef, useEffect, memo } from "react";
import { useTranslation } from "../hooks/useTranslation";
import { relativeTime as formatRelativeTime, engineLabel } from "../lib/i18nFormat";
import type { ConversationEntry } from "../hooks/useChat";
import type { WorkspaceState, AgentEngineId, LoopTask } from "../types";
import { useDragRegion } from "../hooks/useDragRegion";
import EngineBadge from "./EngineBadge";
import WorkspaceFilterDropdown from "./WorkspaceFilterDropdown";

interface SidebarProps {
  entries: ConversationEntry[];
  workspaces: WorkspaceState[];
  activeId: string | null;
  generatingIds: Set<string>;
  onSelect: (id: string, workspaceId: string) => void;
  onNew: (opts?: { workspaceId?: string; engine?: AgentEngineId; model?: string }) => void;
  onDelete: (id: string, workspaceId: string) => void;
  onRename: (id: string, newTitle: string) => void;
  onOpenSettings: () => void;
  onOpenTasks: () => void;
  onOpenLoops: () => void;
  onOpenSkills: () => void;
  onOpenApplications: () => void;
  isOpen: boolean;
  onClose: () => void;
  defaultEngine: AgentEngineId;
  /** Engine ids that are installed + ready; the New Agent button falls back to these. */
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
          {conv.messages.length === 0 && (
            <span className="shrink-0 text-[9px] uppercase px-1 py-0.5 rounded bg-[var(--accent)]/15 text-[var(--accent)] border border-[var(--accent)]/30">
              {t('sidebar.draftBadge')}
            </span>
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
  activeId,
  generatingIds,
  onSelect,
  onNew,
  onDelete,
  onRename,
  onOpenSettings,
  onOpenTasks,
  onOpenLoops,
  onOpenSkills,
  onOpenApplications,
  isOpen,
  onClose,
  defaultEngine,
  readyEngineIds,
  defaultWorkspacePath,
  loopTasks,
}: SidebarProps) {
  const { t } = useTranslation();
  const [search, setSearch] = useState("");
  const handleDragRegion = useDragRegion();

  const [historyExpanded, setHistoryExpanded] = useState(false);
  const [loopsExpanded, setLoopsExpanded] = useState(true);
  /** Manual workspace filter for the conversation list: null = all. */
  const [filterWorkspaceId, setFilterWorkspaceId] = useState<string | null>(null);
  const [wsFilterOpen, setWsFilterOpen] = useState(false);
  const wsFilterWrapperRef = useRef<HTMLDivElement>(null);

  // Close the workspace-filter dropdown when clicking outside of it.
  useEffect(() => {
    if (!wsFilterOpen) return;
    const onDown = (e: PointerEvent) => {
      const target = e.target as Node;
      if (wsFilterWrapperRef.current && !wsFilterWrapperRef.current.contains(target)) {
        setWsFilterOpen(false);
      }
    };
    const id = requestAnimationFrame(() => {
      document.addEventListener("pointerdown", onDown);
    });
    return () => {
      cancelAnimationFrame(id);
      document.removeEventListener("pointerdown", onDown);
    };
  }, [wsFilterOpen]);

  // The default engine may not be ready (e.g. the user logged it out since). The
  // quick "New Agent" button must use a ready engine, otherwise it would create
  // an unusable session.
  const effectiveDefaultEngine: AgentEngineId = readyEngineIds.includes(defaultEngine)
    ? defaultEngine
    : (readyEngineIds[0] ?? defaultEngine);

  // Workspaces offered in the filter dropdown: known workspaces plus any
  // workspace that still has conversations (e.g. evicted from the recent list).
  const filterableWorkspaces = useMemo(() => {
    const withConvs = new Set(entries.map((e) => e.workspaceId));
    const seen = new Set<string>();
    const out: WorkspaceState[] = [];
    for (const w of workspaces) {
      if (withConvs.has(w.id) && !seen.has(w.id)) {
        seen.add(w.id);
        out.push(w);
      }
    }
    for (const id of withConvs) {
      if (!seen.has(id)) {
        seen.add(id);
        out.push({ id, path: id, name: id.split("/").pop() ?? id });
      }
    }
    return out;
  }, [entries, workspaces]);

  const filtered = useMemo(() => {
    let list = entries;
    if (filterWorkspaceId) {
      list = list.filter((e) => e.workspaceId === filterWorkspaceId);
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
  }, [entries, search, workspaces, filterWorkspaceId]);

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
        {/* Search + workspace filter */}
        <div className="px-3 py-2 border-b border-[var(--border-color)]">
          <div className="flex items-stretch">
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder={t('sidebar.searchAgents')}
              className="flex-1 min-w-0 bg-[var(--bg-primary)] border border-[var(--border-color)] rounded-l-lg px-3 py-1.5 text-xs text-[var(--text-primary)] placeholder-[var(--text-secondary)] outline-none focus:border-[var(--accent)] transition-colors"
            />
            <div ref={wsFilterWrapperRef} className="relative">
              <button
                type="button"
                onClick={() => setWsFilterOpen((v) => !v)}
                title={
                  filterWorkspaceId
                    ? t('sidebar.filterSelected', { name: workspaceName(workspaces, filterWorkspaceId) })
                    : t('sidebar.filterAllHover')
                }
                aria-label={t('sidebar.filterAll')}
                className={`flex items-center justify-center gap-0.5 w-9 h-full rounded-r-lg border border-l-0 border-[var(--border-color)] transition-colors ${
                  filterWorkspaceId
                    ? "text-[var(--accent)] bg-[var(--accent)]/10"
                    : "text-[var(--text-secondary)] bg-[var(--bg-primary)] hover:bg-[var(--bg-tertiary)] hover:text-[var(--text-primary)]"
                }`}
              >
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M3 6.5A2.5 2.5 0 0 1 5.5 4H9l2 2h7.5A2.5 2.5 0 0 1 21 8.5v8A2.5 2.5 0 0 1 18.5 19h-13A2.5 2.5 0 0 1 3 16.5z" />
                </svg>
                {filterWorkspaceId && (
                  <svg width="8" height="8" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="shrink-0">
                    <path d="M18 6L6 18M6 6l12 12" />
                  </svg>
                )}
              </button>
              {wsFilterOpen && (
                <WorkspaceFilterDropdown
                  workspaces={filterableWorkspaces}
                  selectedId={filterWorkspaceId}
                  onSelect={(id) => {
                    setFilterWorkspaceId(id);
                    setWsFilterOpen(false);
                  }}
                  onClose={() => setWsFilterOpen(false)}
                />
              )}
            </div>
          </div>
        </div>

        {/* Conversation list: Active + Loops groups + collapsible History */}
        <div className="flex-1 overflow-y-auto px-2 py-1">
          {filtered.length === 0 && (
            <p className="text-xs text-[var(--text-secondary)] text-center mt-8 px-2">
              {search
                ? t('sidebar.noMatchingAgents')
                : filterWorkspaceId
                  ? t('sidebar.noAgentsInWorkspace')
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
              onClick={() => onNew({ engine: effectiveDefaultEngine })}
              className="w-full flex items-center justify-center gap-2 px-3 py-2 rounded-lg bg-[var(--accent)] hover:bg-[var(--accent-hover)] text-white text-xs font-medium transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
              title={t('sidebar.newAgentDefaults', { engine: engineLabel(effectiveDefaultEngine, t) })}
            >
              {t('sidebar.newAgent')}
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
            onClick={onOpenApplications}
            className="w-full flex items-center gap-2 px-3 py-2 rounded-lg hover:bg-[var(--bg-tertiary)] text-[var(--text-secondary)] hover:text-[var(--text-primary)] text-xs transition-colors"
          >
            <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
              <rect x="2" y="2" width="4" height="4" rx="1" stroke="currentColor" strokeWidth="1.2" />
              <rect x="8" y="2" width="4" height="4" rx="1" stroke="currentColor" strokeWidth="1.2" />
              <rect x="2" y="8" width="4" height="4" rx="1" stroke="currentColor" strokeWidth="1.2" />
              <path d="M9 10h3M10.5 8.5v3" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
            </svg>
            {t('sidebar.applications')}
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
    </>
  );
}
