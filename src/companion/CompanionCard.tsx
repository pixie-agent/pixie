import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { invoke } from "@tauri-apps/api/core";
import type {
  ActivityRecord,
  ActivityStatus,
  CompanionChatEntry,
} from "./types";

function fmtElapsed(ms: number): string {
  const mins = Math.floor(ms / 60_000);
  if (mins < 1) return "<1m";
  if (mins < 60) return `${mins}m`;
  return `${Math.floor(mins / 60)}h${mins % 60}m`;
}

const STATUS_STYLE: Record<ActivityStatus, string> = {
  running: "bg-[var(--accent)]/15 text-[var(--accent)] border-[var(--accent)]/30",
  waiting_permission: "bg-amber-500/15 text-amber-300 border-amber-500/30",
  completed: "bg-green-500/15 text-green-400 border-green-500/30",
  failed: "bg-red-500/15 text-red-400 border-red-500/30",
  stopped: "bg-zinc-500/15 text-zinc-400 border-zinc-500/30",
};

function sortActivities(a: ActivityRecord, b: ActivityRecord): number {
  const rank = (s: ActivityStatus) =>
    s === "waiting_permission" ? 0 : s === "running" ? 1 : 2;
  const r = rank(a.status) - rank(b.status);
  if (r !== 0) return r;
  return (b.last_event_at ?? 0) - (a.last_event_at ?? 0);
}

function ActivityRow({ rec, now }: { rec: ActivityRecord; now: number }) {
  const { t } = useTranslation();
  const isConversation = rec.kind === "conversation";
  const elapsed =
    rec.status === "running" || rec.status === "waiting_permission"
      ? fmtElapsed(now - rec.turn_started_at)
      : fmtElapsed(now - (rec.finished_at ?? rec.last_event_at));
  const excerpt = rec.excerpt || rec.detail || "";

  return (
    <button
      onClick={() => {
        if (isConversation) {
          void invoke("focus_conversation", { conversationId: rec.id }).catch(() => {});
        }
      }}
      className={`w-full text-left px-2.5 py-2 rounded-lg border border-transparent hover:border-[var(--border)] hover:bg-[var(--bg-secondary)] transition-colors ${
        isConversation ? "cursor-pointer" : "cursor-default"
      }`}
    >
      <div className="flex items-center gap-2">
        <span
          className={`shrink-0 text-[9px] uppercase px-1.5 py-0.5 rounded border ${STATUS_STYLE[rec.status]}`}
        >
          {t(`companion.status.${rec.status}`)}
        </span>
        <span className="truncate text-xs font-medium text-[var(--text-primary)] flex-1">
          {rec.title || t("companion.untitled")}
        </span>
        <span className="shrink-0 text-[10px] text-[var(--text-secondary)]">{elapsed}</span>
      </div>
      {(excerpt || rec.engine) && (
        <div className="mt-1 flex items-center gap-2">
          <span className="shrink-0 text-[9px] text-[var(--text-secondary)]">
            {rec.workspace.split("/").pop()}
            {rec.engine ? ` · ${rec.engine}` : ""}
          </span>
          {excerpt && (
            <span className="truncate text-[10px] text-[var(--text-secondary)]">{excerpt}</span>
          )}
        </div>
      )}
    </button>
  );
}

export function CompanionCard({
  activities,
  history,
  brainAvailable,
  isAsking,
  streamedAnswer,
  onCollapse,
  onDnd,
  onResetChat,
  onAsk,
}: {
  activities: ActivityRecord[];
  history: CompanionChatEntry[];
  brainAvailable: boolean;
  isAsking: boolean;
  streamedAnswer: string;
  onCollapse: () => void;
  onDnd: () => void;
  onResetChat: () => void;
  onAsk: (q: string) => void;
}) {
  const { t } = useTranslation();
  const [question, setQuestion] = useState("");
  const [now, setNow] = useState(0);
  const chatBottomRef = useRef<HTMLDivElement>(null);
  // Drag-vs-click discrimination for the header drag region (same problem as
  // the sprite: Tauri takes over on mousedown but a click still fires on up).
  const headerDownRef = useRef<{ x: number; y: number } | null>(null);
  const headerDraggedRef = useRef(false);

  // Live-elapsed ticker: seed the clock asynchronously (render stays pure),
  // then re-render every 2s so elapsed times and excerpts feel alive.
  useEffect(() => {
    const raf = requestAnimationFrame(() => setNow(Date.now()));
    const id = setInterval(() => setNow(Date.now()), 2_000);
    return () => {
      cancelAnimationFrame(raf);
      clearInterval(id);
    };
  }, []);

  useEffect(() => {
    chatBottomRef.current?.scrollIntoView({ block: "end" });
  }, [history.length, streamedAnswer]);

  const sorted = [...activities].sort(sortActivities);

  return (
    <div className="w-full h-full flex flex-col bg-[var(--bg-primary)]/95 backdrop-blur-xl rounded-3xl border border-[var(--border)] shadow-[0_16px_48px_rgba(0,0,0,0.45)] overflow-hidden">
      {/* Header (drag region). Decorative children are pointer-transparent so
          mousedown lands on the drag-region element itself — Tauri checks the
          attribute on the event target, not its ancestors. Buttons keep their
          pointer events. */}
      <div
        data-tauri-drag-region
        onPointerDown={(e) => {
          headerDownRef.current = { x: e.clientX, y: e.clientY };
          headerDraggedRef.current = false;
        }}
        onPointerMove={(e) => {
          const down = headerDownRef.current;
          if (!down) return;
          if (Math.hypot(e.clientX - down.x, e.clientY - down.y) > 6) {
            headerDraggedRef.current = true;
          }
        }}
        onClick={(e) => {
          // A drag ended on the header — swallow the trailing click so it
          // never lands on the buttons below the cursor.
          if (headerDraggedRef.current) {
            e.preventDefault();
            e.stopPropagation();
          }
        }}
        className="flex items-center gap-2 px-4 py-2.5 border-b border-[var(--border)] shrink-0"
      >
        <span className="pointer-events-none w-2 h-2 rounded-full bg-[var(--accent)] animate-pulse" />
        <span className="pointer-events-none text-xs font-semibold text-[var(--text-primary)] flex-1">
          {t("companion.title")}
        </span>
        <button
          onClick={onDnd}
          title={t("companion.menu.dnd1h")}
          className="text-[10px] px-1.5 py-0.5 rounded text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-secondary)] transition-colors"
        >
          {t("companion.menu.dnd1h")}
        </button>
        <button
          onClick={onResetChat}
          title={t("companion.menu.resetChat")}
          className="text-[10px] px-1.5 py-0.5 rounded text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-secondary)] transition-colors"
        >
          {t("companion.menu.resetChat")}
        </button>
        <button
          onClick={onCollapse}
          title={t("companion.menu.collapse")}
          className="text-xs px-1.5 rounded text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-secondary)] transition-colors"
        >
          −
        </button>
      </div>

      {/* Activity list */}
      <div className="flex-1 overflow-y-auto px-2 py-2 space-y-0.5 min-h-0">
        <div className="px-1.5 pb-1 text-[10px] uppercase tracking-wide text-[var(--text-secondary)]">
          {t("companion.card.activityTitle")}
        </div>
        {sorted.length === 0 ? (
          <div className="px-2 py-6 text-center text-xs text-[var(--text-secondary)]">
            {t("companion.card.noActivity")}
          </div>
        ) : (
          sorted.map((rec) => <ActivityRow key={rec.id} rec={rec} now={now} />)
        )}
      </div>

      {/* Q&A */}
      <div className="shrink-0 border-t border-[var(--border)] flex flex-col max-h-[45%]">
        <div className="flex-1 overflow-y-auto px-3 py-2 space-y-2 min-h-0">
          {!brainAvailable && (
            <div className="text-[10px] text-amber-400/80">{t("companion.card.brainOffline")}</div>
          )}
          {history.length === 0 && streamedAnswer === "" && !isAsking && (
            <div className="text-xs text-[var(--text-secondary)] italic">
              {t("companion.card.askHint")}
            </div>
          )}
          {history.map((e, i) => (
            <div key={i} className="space-y-1">
              <div className="text-xs text-[var(--text-primary)] text-right">{"Q: " + e.question}</div>
              <div className="text-xs text-[var(--text-secondary)] whitespace-pre-wrap">
                {e.answer}
              </div>
            </div>
          ))}
          {(isAsking || streamedAnswer) && (
            <div className="text-xs text-[var(--text-secondary)] whitespace-pre-wrap">
              {streamedAnswer || "…"}
            </div>
          )}
          <div ref={chatBottomRef} />
        </div>
        <form
          className="flex items-center gap-1.5 px-2.5 py-2 border-t border-[var(--border)]"
          onSubmit={(e) => {
            e.preventDefault();
            const q = question.trim();
            if (!q || isAsking) return;
            setQuestion("");
            onAsk(q);
          }}
        >
          <input
            value={question}
            onChange={(e) => setQuestion(e.target.value)}
            placeholder={t("companion.card.askPlaceholder")}
            disabled={isAsking}
            className="flex-1 min-w-0 bg-[var(--bg-secondary)] border border-[var(--border)] rounded-lg px-2.5 py-1.5 text-xs text-[var(--text-primary)] placeholder:text-[var(--text-secondary)] focus:outline-none focus:border-[var(--accent)]/50 disabled:opacity-50"
          />
          <button
            type="submit"
            disabled={isAsking || !question.trim()}
            className="shrink-0 text-xs px-2.5 py-1.5 rounded-lg bg-[var(--accent)]/15 text-[var(--accent)] border border-[var(--accent)]/30 hover:bg-[var(--accent)]/25 transition-colors disabled:opacity-40"
          >
            {isAsking ? "…" : "→"}
          </button>
        </form>
      </div>
    </div>
  );
}
