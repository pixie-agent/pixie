import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import rehypeRaw from "rehype-raw";
import { invoke } from "@tauri-apps/api/core";
import type {
  ActivityRecord,
  ActivityStatus,
  CompanionChatEntry,
  CompanionProposal,
  PetAttachment,
} from "./types";

/** Read a clipboard image Blob as bare base64 (data-URL prefix stripped). */
function blobToBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = reader.result;
      if (typeof result !== "string") {
        reject(new Error("Failed to read image"));
        return;
      }
      const comma = result.indexOf(",");
      resolve(comma >= 0 ? result.slice(comma + 1) : result);
    };
    reader.onerror = () => reject(reader.error ?? new Error("read failed"));
    reader.readAsDataURL(blob);
  });
}

function mimeToExt(mime: string): string {
  const sub = mime.split("/")[1] ?? "";
  if (sub === "jpeg") return "jpg";
  return sub || "png";
}

/** File name of a path (last segment) for chip/attachment labels. */
function pathBasename(path: string): string {
  const parts = path.split("/").filter(Boolean);
  return parts.length ? parts[parts.length - 1] : path;
}

/** Image-extension check → the chip shows 📷 (captures land as png here). */
function isImageFile(path: string): boolean {
  return /\.(png|jpe?g|gif|webp|bmp|tiff?)$/i.test(path);
}

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

/** Action card for a task proposal: run as-is, edit the instruction (fills
 * the input in dispatch mode), or dismiss. Dispatch state lives in the
 * parent (one proposal can be dispatched once, from either path). */
function ProposalCard({
  proposal,
  attachments,
  isDispatched,
  isEditing,
  dispatchedConvId,
  onDispatch,
  onEdit,
  onCancelEdit,
  onFollowUp,
}: {
  proposal: CompanionProposal;
  attachments: PetAttachment[];
  /** This proposal has already been dispatched (buttons lock to [View]). */
  isDispatched: boolean;
  /** This proposal is currently being edited in the input (dispatch mode). */
  isEditing: boolean;
  /** Conversation the (most recent) dispatch landed in; [View] opens it. */
  dispatchedConvId: string | null;
  onDispatch: (task: string, workspace: string, engine: string, atts: PetAttachment[]) => void;
  onEdit: (task: string) => void;
  onCancelEdit: () => void;
  /** Enter follow-up mode: the input's next send goes to the dispatched
   * session. Absent when the card has no session to follow up on. */
  onFollowUp?: () => void;
}) {
  const { t } = useTranslation();

  return (
    <div className="rounded-xl border border-[var(--accent)]/30 bg-[var(--accent)]/5 px-2.5 py-2 space-y-1.5">
      <div className="text-[10px] font-medium text-[var(--accent)]">
        {t("companion.card.proposalTitle")}
      </div>
      <div className="text-xs text-[var(--text-primary)] whitespace-pre-wrap">
        {proposal.task}
      </div>
      {(proposal.workspace || attachments.length > 0) && (
        <div className="text-[9px] text-[var(--text-secondary)] truncate">
          {proposal.workspace ? `📁 ${pathBasename(proposal.workspace)}` : ""}
          {attachments.length > 0
            ? `${proposal.workspace ? " · " : ""}📎 ${attachments.map((a) => a.preview).join(", ")}`
            : ""}
        </div>
      )}
      {isDispatched ? (
        <div className="flex items-center gap-2 pt-0.5">
          <span className="text-[10px] text-[var(--text-secondary)]">
            ✓ {t("companion.card.proposalDispatched")}
          </span>
          <button
            onClick={() => {
              void invoke("focus_conversation", {
                conversationId: dispatchedConvId ?? "",
              }).catch(() => {});
            }}
            className="text-[10px] px-2 py-0.5 rounded-lg text-[var(--accent)] border border-[var(--accent)]/30 hover:bg-[var(--accent)]/15 transition-colors"
          >
            {t("companion.card.proposalView")}
          </button>
          {onFollowUp && (
            <button
              onClick={onFollowUp}
              className="text-[10px] px-2 py-0.5 rounded-lg text-[var(--text-secondary)] border border-[var(--border)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-secondary)] transition-colors"
            >
              {t("companion.card.proposalFollowUp")}
            </button>
          )}
        </div>
      ) : isEditing ? (
        <div className="flex items-center gap-2 pt-0.5">
          {/* No instruction text — the accented input + 🚀 send button carry
              the mode; a label would just narrate what's already visible. */}
          <div className="flex-1" />
          <button
            onClick={onCancelEdit}
            className="text-[10px] px-2 py-0.5 rounded-lg text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-secondary)] transition-colors"
          >
            {t("companion.card.proposalCancelEdit")}
          </button>
        </div>
      ) : (
        <div className="flex items-center gap-1.5 pt-0.5">
          <button
            onClick={() =>
              onDispatch(proposal.task, proposal.workspace, proposal.engine, attachments)
            }
            className="text-[10px] px-2 py-1 rounded-lg bg-[var(--accent)]/20 text-[var(--accent)] border border-[var(--accent)]/40 hover:bg-[var(--accent)]/30 transition-colors"
          >
            {t("companion.card.proposalDo")}
          </button>
          <button
            onClick={() => onEdit(proposal.task)}
            className="text-[10px] px-2 py-1 rounded-lg text-[var(--text-secondary)] border border-[var(--border)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-secondary)] transition-colors"
          >
            ✏️ {t("companion.card.proposalEdit")}
          </button>
          {/* Dismiss just hides the card (no state to undo) — the proposal
              stays in persisted history, so a look-back is still possible. */}
        </div>
      )}
    </div>
  );
}

export function CompanionCard({
  activities,
  history,
  brainAvailable,
  isAsking,
  streamedAnswer,
  attachments,
  onRemoveAttachment,
  dndActive,
  dispatchedConvId,
  onCollapse,
  onDnd,
  onResetChat,
  onAsk,
  onDispatch,
  onFollowUp,
  onAddFileAttachments,
}: {
  activities: ActivityRecord[];
  history: CompanionChatEntry[];
  brainAvailable: boolean;
  isAsking: boolean;
  streamedAnswer: string;
  attachments: PetAttachment[];
  onRemoveAttachment: (id: string) => void;
  dndActive: boolean;
  dispatchedConvId: string | null;
  onCollapse: () => void;
  onDnd: () => void;
  onResetChat: () => void;
  onAsk: (q: string, atts?: PetAttachment[]) => void;
  onDispatch: (task: string, workspace: string, engine: string, atts: PetAttachment[]) => void;
  onFollowUp: (conversationId: string, message: string) => void;
  /** Stage pasted-image files (path from the backend's save_pasted_image). */
  onAddFileAttachments: (paths: string[]) => void;
}) {
  const { t } = useTranslation();
  const [question, setQuestion] = useState("");
  const [now, setNow] = useState(0);
  // Dispatch-edit mode: which history entry's proposal is being edited in
  // the input. Submitting in this mode DISPATCHES (same as [直接做]) instead
  // of asking the brain again — "edit then run" and "run" must land in the
  // same place. Keyed by history index.
  const [editingIndex, setEditingIndex] = useState<number | null>(null);
  // Follow-up mode: the input's next send routes to an already-dispatched
  // task's conversation instead of the pet brain. Keyed by history index.
  const [followUpIndex, setFollowUpIndex] = useState<number | null>(null);
  // History indexes already dispatched (from either [直接做] or edit-send) —
  // locked so a card can never fire twice.
  const [dispatchedIndexes, setDispatchedIndexes] = useState<number[]>([]);
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
          className={`text-[10px] px-1.5 py-0.5 rounded border transition-colors ${
            dndActive
              ? "bg-amber-500/15 text-amber-300 border-amber-500/40"
              : "text-[var(--text-secondary)] border-transparent hover:text-[var(--text-primary)] hover:bg-[var(--bg-secondary)]"
          }`}
        >
          {dndActive ? t("companion.menu.dndActive") : t("companion.menu.dnd1h")}
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
              <div className="text-xs text-[var(--text-primary)] text-right">
                {"Q: " + e.question}
                {e.attachments && e.attachments.length > 0 && (
                  <span className="block text-[9px] text-[var(--text-secondary)]/80 truncate">
                    📎 {e.attachments.map(pathBasename).join(", ")}
                  </span>
                )}
              </div>
              <div className="companion-markdown markdown-body text-xs text-[var(--text-secondary)]">
                <ReactMarkdown remarkPlugins={[remarkGfm]} rehypePlugins={[rehypeRaw]}>
                  {e.answer}
                </ReactMarkdown>
              </div>
              {e.proposal && (
                <ProposalCard
                  proposal={e.proposal}
                  // History entries persist plain file paths — adapt to chips.
                  attachments={(e.attachments ?? []).map((p) => ({
                    id: `hist-${i}-${p}`,
                    kind: "file" as const,
                    value: p,
                    preview: pathBasename(p),
                  }))}
                  isDispatched={dispatchedIndexes.includes(i)}
                  isEditing={editingIndex === i}
                  dispatchedConvId={dispatchedConvId}
                  onDispatch={(task, ws, engine, atts) => {
                    onDispatch(task, ws, engine, atts);
                    setDispatchedIndexes((prev) => [...prev, i]);
                  }}
                  onEdit={(task) => {
                    setEditingIndex(i);
                    setFollowUpIndex(null);
                    setQuestion(task);
                  }}
                  onCancelEdit={() => {
                    setEditingIndex(null);
                    setQuestion("");
                  }}
                  onFollowUp={
                    dispatchedConvId
                      ? () => {
                          setFollowUpIndex(i);
                          setEditingIndex(null);
                          setQuestion("");
                        }
                      : undefined
                  }
                />
              )}
            </div>
          ))}
          {(isAsking || streamedAnswer) && (
            <div className="companion-markdown markdown-body text-xs text-[var(--text-secondary)]">
              <ReactMarkdown remarkPlugins={[remarkGfm]} rehypePlugins={[rehypeRaw]}>
                {streamedAnswer || "…"}
              </ReactMarkdown>
            </div>
          )}
          <div ref={chatBottomRef} />
        </div>
        {/* Staged attachment chips (drag-and-drop / capture / clipboard).
            Sending consumes them. */}
        {attachments.length > 0 && (
          <div className="flex flex-wrap gap-1 px-2.5 pt-2">
            {attachments.map((a) => (
              <span
                key={a.id}
                title={a.kind === "file" ? a.value : a.value.slice(0, 200)}
                className="inline-flex items-center gap-1 max-w-full px-1.5 py-0.5 rounded-md bg-[var(--accent)]/10 border border-[var(--accent)]/25 text-[10px] text-[var(--accent)]"
              >
                <span className="truncate">
                  {a.kind === "clipboard" ? "📋" : isImageFile(a.value) ? "📷" : "📎"}{" "}
                  {a.preview}
                </span>
                <button
                  type="button"
                  onClick={() => onRemoveAttachment(a.id)}
                  className="shrink-0 opacity-60 hover:opacity-100"
                  aria-label="remove attachment"
                >
                  ×
                </button>
              </span>
            ))}
          </div>
        )}
        {/* Directed-mode exit: a tiny ✕ appears beside the input while it
            targets a specific destination (edit-dispatch / follow-up), so a
            stray mode never traps the box. Icon-only, like the chip removes. */}
        {(editingIndex !== null || followUpIndex !== null) && (
          <div className="flex justify-end px-2.5 pt-1.5">
            <button
              type="button"
              onClick={() => {
                setEditingIndex(null);
                setFollowUpIndex(null);
                setQuestion("");
              }}
              className="text-[10px] px-1.5 py-0.5 rounded text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-secondary)] transition-colors"
            >
              ✕
            </button>
          </div>
        )}
        <form
          className="flex items-center gap-1.5 px-2.5 py-2 border-t border-[var(--border)]"
          onSubmit={(e) => {
            e.preventDefault();
            const q = question.trim();
            // With attachments staged, an empty box is NOT a dead end — but
            // the instruction is the point of the exercise, so still require
            // text (the chips alone carry no intent).
            if (!q || isAsking) return;
            // Dispatch-edit mode: the input holds an edited proposal — send
            // it to the main window (a fresh agent session), NOT back to the
            // pet brain. Edits and [直接做] share one destination.
            if (editingIndex !== null) {
              const entry = history[editingIndex];
              setQuestion("");
              setEditingIndex(null);
              if (entry?.proposal) {
                setDispatchedIndexes((prev) => [...prev, editingIndex]);
                onDispatch(
                  q,
                  entry.proposal.workspace,
                  entry.proposal.engine,
                  (entry.attachments ?? []).map((p) => ({
                    id: `edit-${editingIndex}-${p}`,
                    kind: "file" as const,
                    value: p,
                    preview: pathBasename(p),
                  })),
                );
              }
              return;
            }
            // Follow-up mode: route to the already-dispatched task's session.
            // No new conversation — the agent there knows what it just did.
            if (followUpIndex !== null) {
              setQuestion("");
              setFollowUpIndex(null);
              if (dispatchedConvId) onFollowUp(dispatchedConvId, q);
              return;
            }
            // Attachments staged = work to do, not a question. Dispatch
            // DIRECTLY to a fresh main-window session — no brain round-trip:
            // the file paths + instruction form a self-contained task, and
            // the executing agent reads the files itself.
            if (attachments.length > 0) {
              const files = attachments.filter((a) => a.kind === "file");
              const fileList = files.length
                ? `\n\nFiles:\n${files.map((a) => `- ${a.value}`).join("\n")}`
                : "";
              const task = `${q}${fileList}`;
              setQuestion("");
              onDispatch(task, "", "", attachments);
              return;
            }
            setQuestion("");
            onAsk(q);
          }}
        >
          <input
            value={question}
            onChange={(e) => setQuestion(e.target.value)}
            onPaste={async (e) => {
              // Pasted images follow the main window's pipeline: base64 over
              // IPC → save_pasted_image → staged as a 📷 file chip. Plain
              // text pastes fall through to the input untouched.
              const items = e.clipboardData?.items;
              if (!items) return;
              let sawImage = false;
              for (const item of Array.from(items)) {
                if (item.kind === "file" && item.type.startsWith("image/")) {
                  const file = item.getAsFile();
                  if (!file) continue;
                  sawImage = true;
                  try {
                    const base64 = await blobToBase64(file);
                    const path = await invoke<string>("save_pasted_image", {
                      data: base64,
                      ext: mimeToExt(item.type),
                    });
                    onAddFileAttachments([path]);
                  } catch {
                    /* ignore decode/write failures — paste silently no-ops */
                  }
                }
              }
              if (sawImage) e.preventDefault();
            }}
            placeholder={
              attachments.length > 0
                ? t("companion.card.attachPlaceholder")
                : t("companion.card.askPlaceholder")
            }
            disabled={isAsking}
            className={`flex-1 min-w-0 bg-[var(--bg-secondary)] border rounded-lg px-2.5 py-1.5 text-xs text-[var(--text-primary)] placeholder:text-[var(--text-secondary)] focus:outline-none disabled:opacity-50 ${
              editingIndex !== null || followUpIndex !== null || attachments.length > 0
                ? "border-[var(--accent)]/60 focus:border-[var(--accent)]"
                : "border-[var(--border)] focus:border-[var(--accent)]/50"
            }`}
          />
          <button
            type="submit"
            disabled={isAsking || !question.trim()}
            className={`shrink-0 text-xs px-2.5 py-1.5 rounded-lg border transition-colors disabled:opacity-40 ${
              editingIndex !== null || followUpIndex !== null || attachments.length > 0
                ? "bg-[var(--accent)]/25 text-[var(--accent)] border-[var(--accent)]/50 hover:bg-[var(--accent)]/35"
                : "bg-[var(--accent)]/15 text-[var(--accent)] border border-[var(--accent)]/30 hover:bg-[var(--accent)]/25"
            }`}
          >
            {isAsking
              ? "…"
              : editingIndex !== null
                ? "🚀"
                : followUpIndex !== null
                  ? "↩"
                  : attachments.length > 0
                    ? "🚀"
                    : "→"}
          </button>
        </form>
      </div>
    </div>
  );
}
