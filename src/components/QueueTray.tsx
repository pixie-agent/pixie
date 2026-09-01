import { useTranslation } from "../hooks/useTranslation";
import type { QueuedMessage } from "../hooks/useChat";

/**
 * Queue tray: messages submitted while the conversation was generating,
 * rendered above the input bar. Read-mostly — each chip can be removed
 * individually, or the whole queue cleared. The head is sent automatically
 * when the current turn finishes (see useChat's drain hook).
 */
export default function QueueTray({
  items,
  onRemove,
  onClearAll,
}: {
  items: QueuedMessage[];
  onRemove: (msgId: string) => void;
  onClearAll: () => void;
}) {
  const { t } = useTranslation();
  if (items.length === 0) return null;

  return (
    <div className="shrink-0 px-4 pt-2 flex flex-col gap-1.5">
      <div className="flex items-center justify-between">
        <span className="text-[11px] text-[var(--text-secondary)]">
          {t("chat.queuedCount", { count: items.length })}
        </span>
        <button
          onClick={onClearAll}
          className="text-[11px] px-1.5 py-0.5 rounded text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-secondary)] transition-colors"
        >
          {t("chat.queueClear")}
        </button>
      </div>
      <div className="flex flex-wrap gap-1.5">
        {items.map((m) => (
          <span
            key={m.id}
            className="inline-flex items-center gap-1.5 max-w-full bg-[var(--bg-tertiary)] border border-[var(--border)] rounded-full pl-2.5 pr-1 py-0.5 text-[11px] text-[var(--text-primary)] opacity-75"
            title={m.content}
          >
            <span className="truncate max-w-[280px]">{m.content}</span>
            {m.images && m.images.length > 0 && (
              <span className="shrink-0 text-[var(--text-secondary)]">📎{m.images.length}</span>
            )}
            <button
              onClick={() => onRemove(m.id)}
              className="shrink-0 w-4 h-4 flex items-center justify-center rounded-full text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-secondary)] transition-colors"
              aria-label="remove"
            >
              ×
            </button>
          </span>
        ))}
      </div>
    </div>
  );
}
