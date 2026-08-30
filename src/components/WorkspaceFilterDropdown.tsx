import { useEffect, useRef, useState } from "react";
import { useTranslation } from "../hooks/useTranslation";
import type { WorkspaceState } from "../types";

interface WorkspaceFilterDropdownProps {
  /** Workspaces to offer (most recent first, already capped by caller). */
  workspaces: WorkspaceState[];
  /** Currently selected filter: null = all workspaces. */
  selectedId: string | null;
  onSelect: (workspaceId: string | null) => void;
  onClose: () => void;
}

/**
 * Manual workspace picker for the sidebar conversation filter. Lists recent
 * workspaces plus a leading "All" row; keyboard navigation mirrors the other
 * dropdowns. Click-outside is handled by the parent wrapper.
 */
export default function WorkspaceFilterDropdown({ workspaces, selectedId, onSelect, onClose }: WorkspaceFilterDropdownProps) {
  const { t } = useTranslation();
  // Flat index: 0 = "All", then one row per workspace. Start on the currently
  // selected row when there is one (adjusting state during the first render's
  // comparison, the pattern used by SkillsDropdown, avoids a setState-in-effect).
  const [activeIndex, setActiveIndex] = useState(() => {
    if (!selectedId) return 0;
    const idx = workspaces.findIndex((w) => w.id === selectedId);
    return idx >= 0 ? idx + 1 : 0;
  });
  const listRef = useRef<HTMLDivElement>(null);

  // Focus so keyboard navigation works without an extra click.
  useEffect(() => {
    listRef.current?.focus();
  }, []);

  useEffect(() => {
    const el = listRef.current?.querySelector(`[data-idx="${activeIndex}"]`) as HTMLElement | null;
    el?.scrollIntoView({ block: "nearest" });
  }, [activeIndex]);

  const handleKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    const total = workspaces.length + 1;
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActiveIndex((i) => Math.min(i + 1, total - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActiveIndex((i) => Math.max(i - 1, 0));
    } else if (e.key === "Enter") {
      e.preventDefault();
      onSelect(activeIndex === 0 ? null : workspaces[activeIndex - 1]?.id ?? null);
    } else if (e.key === "Escape") {
      e.preventDefault();
      onClose();
    }
  };

  const rowClass = (idx: number, selected: boolean) =>
    `w-full text-left px-2.5 py-1.5 flex flex-col gap-0.5 transition-colors ${
      activeIndex === idx ? "bg-[var(--bg-tertiary)]" : ""
    } ${selected ? "text-[var(--accent)]" : "text-[var(--text-primary)]"}`;

  const check = (
    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className="shrink-0 text-[var(--accent)] ml-auto">
      <path d="M20 6L9 17l-5-5" />
    </svg>
  );

  return (
    <div
      ref={listRef}
      tabIndex={-1}
      onKeyDown={handleKeyDown}
      className="absolute top-full left-0 mt-1 w-64 bg-[var(--bg-primary)] border border-[var(--border-color)] rounded-xl shadow-lg max-h-72 overflow-y-auto flex flex-col z-30 py-1"
    >
      <button
        type="button"
        data-idx={0}
        onMouseEnter={() => setActiveIndex(0)}
        onClick={() => onSelect(null)}
        className={rowClass(0, selectedId === null)}
      >
        <span className="flex items-center gap-2 text-sm font-medium">
          {t('sidebar.filterAll')}
          {selectedId === null && check}
        </span>
      </button>
      {workspaces.map((ws, i) => (
        <button
          key={ws.id}
          type="button"
          data-idx={i + 1}
          onMouseEnter={() => setActiveIndex(i + 1)}
          onClick={() => onSelect(ws.id)}
          title={ws.path}
          className={rowClass(i + 1, ws.id === selectedId)}
        >
          <span className="flex items-center gap-2 min-w-0">
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="shrink-0 text-[var(--text-secondary)]">
              <path d="M3 6.5A2.5 2.5 0 0 1 5.5 4H9l2 2h7.5A2.5 2.5 0 0 1 21 8.5v8A2.5 2.5 0 0 1 18.5 19h-13A2.5 2.5 0 0 1 3 16.5z" />
            </svg>
            <span className="text-sm font-medium truncate">{ws.name}</span>
            {ws.id === selectedId && check}
          </span>
          <span className="text-xs text-[var(--text-secondary)] truncate pl-5">{ws.path}</span>
        </button>
      ))}
    </div>
  );
}
