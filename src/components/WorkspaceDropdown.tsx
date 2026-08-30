import { useEffect, useRef, useState } from "react";
import { useTranslation } from "../hooks/useTranslation";
import type { WorkspaceState } from "../types";

interface WorkspaceDropdownProps {
  /** Recently-used workspaces, most recent first (already capped by caller). */
  workspaces: WorkspaceState[];
  /** Id (= path) of the currently selected workspace, for the checkmark. */
  selectedId: string | null;
  onSelect: (workspace: WorkspaceState) => void;
  /** Open the native folder picker for a workspace not in the list. */
  onBrowse: () => void;
  onClose: () => void;
}

/**
 * Recent-workspaces picker. Lists previously opened folders (most recently
 * active first) with keyboard navigation, plus a trailing "choose another
 * folder…" row that falls back to the OS native dialog.
 */
export default function WorkspaceDropdown({ workspaces, selectedId, onSelect, onBrowse, onClose }: WorkspaceDropdownProps) {
  const { t } = useTranslation();
  // Flat index over rows: one per workspace, then the trailing browse row.
  const [activeIndex, setActiveIndex] = useState(0);
  const listRef = useRef<HTMLDivElement>(null);

  const total = workspaces.length + 1; // +1 for the browse row

  // Keep the active row visible while navigating with the keyboard.
  useEffect(() => {
    const el = listRef.current?.querySelector(`[data-idx="${activeIndex}"]`) as HTMLElement | null;
    el?.scrollIntoView({ block: "nearest" });
  }, [activeIndex]);

  const handleKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActiveIndex((i) => Math.min(i + 1, total - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActiveIndex((i) => Math.max(i - 1, 0));
    } else if (e.key === "Enter") {
      e.preventDefault();
      if (activeIndex < workspaces.length) {
        const ws = workspaces[activeIndex];
        if (ws) onSelect(ws);
      } else {
        onBrowse();
      }
    } else if (e.key === "Escape") {
      e.preventDefault();
      onClose();
    }
  };

  const rowClass = (idx: number) =>
    `w-full text-left px-3 py-1.5 flex flex-col gap-0.5 transition-colors ${
      activeIndex === idx ? "bg-[var(--bg-tertiary)]" : ""
    }`;

  return (
    <div
      ref={listRef}
      tabIndex={-1}
      onKeyDown={handleKeyDown}
      className="absolute bottom-full left-0 mb-1 w-72 bg-[var(--bg-primary)] border border-[var(--border-color)] rounded-xl shadow-lg max-h-80 overflow-y-auto flex flex-col z-20 py-1"
    >
      <div className="px-3 pt-1 pb-2 text-[10px] uppercase tracking-wide text-[var(--text-secondary)] opacity-70">
        {t('inputBar.workspaceRecent')}
      </div>
      {workspaces.map((ws, i) => (
        <button
          key={ws.id}
          type="button"
          data-idx={i}
          onMouseEnter={() => setActiveIndex(i)}
          onClick={() => onSelect(ws)}
          title={ws.path}
          className={rowClass(i)}
        >
          <span className="flex items-center gap-2 min-w-0">
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="shrink-0 text-[var(--text-secondary)]">
              <path d="M3 6.5A2.5 2.5 0 0 1 5.5 4H9l2 2h7.5A2.5 2.5 0 0 1 21 8.5v8A2.5 2.5 0 0 1 18.5 19h-13A2.5 2.5 0 0 1 3 16.5z" />
            </svg>
            <span className="text-sm text-[var(--text-primary)] font-medium truncate">{ws.name}</span>
            {ws.id === selectedId && (
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className="shrink-0 text-[var(--accent)] ml-auto">
                <path d="M20 6L9 17l-5-5" />
              </svg>
            )}
          </span>
          <span className="text-xs text-[var(--text-secondary)] truncate pl-5">{ws.path}</span>
        </button>
      ))}
      <div className="my-1 border-t border-[var(--border-color)]" />
      <button
        type="button"
        data-idx={workspaces.length}
        onMouseEnter={() => setActiveIndex(workspaces.length)}
        onClick={onBrowse}
        className={rowClass(workspaces.length)}
      >
        <span className="flex items-center gap-2">
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="shrink-0 text-[var(--text-secondary)]">
            <path d="M12 5v14M5 12h14" />
          </svg>
          <span className="text-sm text-[var(--text-secondary)]">{t('inputBar.workspaceBrowse')}</span>
        </span>
      </button>
    </div>
  );
}
