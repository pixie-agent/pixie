import { useCallback, useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import type {
  AgentEngineId,
  PixieApplicationAction,
  PixieApplicationField,
  PixieApplicationRunRecord,
  ResponseChunk,
  ResponseDone,
  ResponseError,
} from "../types";
import { useTranslation } from "../hooks/useTranslation";
import {
  APPLICATION_STATE_UPDATE_MESSAGE_TYPE,
  isApplicationStateMessage,
} from "../lib/applicationMessages";

/**
 * System-level floating chat for running AI Applications.
 *
 * Hard constraints (product decision):
 * - The chat is owned by the Pixie host, never by the application. It renders
 *   in the host DOM, outside every sandboxed iframe, so an app can neither
 *   restyle it nor move it.
 * - Fixed position/size (bottom-right, no drag, no resize). The only user
 *   control is collapse/expand. All applications see the exact same chat box.
 *
 * Conversation semantics: each message triggers the application's chat action
 * via the existing stateless run pipeline, with the app's last-reported state
 * attached as `currentState` so the agent can preserve or revise it.
 */

export type ApplicationChatTarget = {
  /** Marketplace-installed app (MarketplacePanel inline or fullscreen view). */
  kind: "marketplace";
  appId: string;
  appName: string;
  actions: PixieApplicationAction[];
  inputs: PixieApplicationField[];
  frameWindow: Window | null;
} | {
  /** Application Studio preview (RightPanel App tab). The manifest isn't
   *  loaded on this side — the backend resolves the chat action from the
   *  on-disk manifest via the reserved "chat" action id. */
  kind: "studio";
  appPath: string;
  appName: string;
  frameWindow: Window | null;
};

interface ChatMessage {
  role: "user" | "assistant";
  text: string;
  at: number;
  error?: boolean;
  /** Clickable quick replies suggested by the app's last run. */
  followups?: string[];
}

interface ApplicationChatProps {
  target: ApplicationChatTarget;
  defaultEngine: AgentEngineId;
  readyEngineIds: AgentEngineId[];
}

/** Reserved action id resolved by the backend (`resolve_application_action`):
 *  an explicit `chat` action, else the first action accepting `chatMessage`,
 *  else the app's only action. */
const CHAT_ACTION_ID = "chat";

/** First message of a build conversation teaches the agent the app contract.
 *  Later messages go bare — the session carries the context. */
const applicationBuildPrompt = `You are adjusting an existing Pixie AI Application in this workspace.

Files at the application root:
- pixie.application.json — the source of truth for inputs, outputs, actions, and the preview entry
- ui/index.html — the application UI the user sees (declared by manifest.entry)
- agent/instructions.md — the agent that powers the app's actions

Rules:
- Make visible changes in the entry file so the user immediately sees them in the preview.
- Keep manifest.entry previewable at all times.
- Keep inputs, outputs, and actions consistent with pixie.application.json when behavior changes.

User request:
`;

/** Stable conversation id per application path, so build sessions persist
 *  across panel remounts. */
function buildConversationId(appPath: string): string {
  const slug = appPath.replace(/[^a-zA-Z0-9-]/g, "-").replace(/-+/g, "-");
  return `app-build-${slug}`;
}

/** Front-end mirror of the backend's chat-action resolution, used only to
 *  decide whether the composer should be enabled. Build-mode conversations
 *  don't depend on the app's declared actions at all. */
function chatActionAvailable(target: ApplicationChatTarget): boolean {
  if (target.kind === "studio") return true;
  if (target.actions.length === 0) return false;
  return (
    target.actions.some((a) => a.id === CHAT_ACTION_ID) ||
    target.actions.some(
      (a) => a.inputs?.includes("chatMessage") ?? target.inputs.some((f) => f.id === "chatMessage"),
    ) ||
    target.actions.length === 1
  );
}

/** Chat runs only supply the message and the app's last state. Other required
 *  string inputs declared by the app are satisfied server-side by the chat
 *  message itself (see `run_application_action`'s chat-run handling). */
function buildChatInputs(text: string, currentState: unknown): Record<string, unknown> {
  const values: Record<string, unknown> = { chatMessage: text };
  if (currentState !== undefined && currentState !== null) {
    values.currentState = currentState;
  }
  return values;
}

/** Human-readable summary of a use-mode run. The raw appState JSON is for
 *  the app iframe, not the chat bubble — surface the semantic fields
 *  (brief/title/cards/followups) and fall back to the raw text only when
 *  there is nothing structured to show. */
function summarizeRunOutputs(outputs: Record<string, unknown>): { text: string; followups: string[] } {
  const lines: string[] = [];
  let followups: string[] = [];
  for (const [key, value] of Object.entries(outputs)) {
    let parsed: unknown = value;
    if (typeof value === "string") {
      try {
        parsed = JSON.parse(value);
      } catch {
        parsed = value;
      }
    }
    if (!parsed || typeof parsed !== "object") {
      lines.push(`${key}: ${typeof parsed === "string" ? parsed : JSON.stringify(parsed)}`);
      continue;
    }
    const obj = parsed as Record<string, unknown>;
    if (typeof obj.title === "string" && obj.title) lines.push(String(obj.title));
    if (typeof obj.brief === "string" && obj.brief) lines.push(String(obj.brief));
    if (Array.isArray(obj.cards)) {
      for (const card of obj.cards.slice(0, 4)) {
        if (card && typeof card === "object") {
          const c = card as Record<string, unknown>;
          const title = typeof c.title === "string" ? c.title : "";
          const body = typeof c.body === "string" ? c.body : "";
          if (title || body) lines.push(`• ${title}${body ? `：${body}` : ""}`);
        }
      }
    }
    if (Array.isArray(obj.followups)) {
      followups = obj.followups.filter((f): f is string => typeof f === "string").slice(0, 6);
    }
  }
  return { text: lines.join("\n").slice(0, 2000), followups };
}

function historyKey(target: ApplicationChatTarget): string {
  // Build and use histories are separate: one commands the app's
  // construction, the other drives its features. Never mix them.
  return target.kind === "marketplace"
    ? `pixie-app-chat-${target.appId}`
    : `pixie-app-chat-build-${target.appPath}`;
}

/** Whether a build conversation has started (independent of the visible
 *  history — clearing messages must not orphan the backend session). */
function buildStartedKey(target: ApplicationChatTarget): string {
  return `pixie-app-chat-build-started-${target.kind === "studio" ? target.appPath : ""}`;
}

function loadHistory(target: ApplicationChatTarget): ChatMessage[] {
  try {
    const raw = localStorage.getItem(historyKey(target));
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter((m) => m && typeof m.text === "string") : [];
  } catch {
    return [];
  }
}

function persistHistory(target: ApplicationChatTarget, messages: ChatMessage[]) {
  try {
    localStorage.setItem(historyKey(target), JSON.stringify(messages.slice(-200)));
  } catch {
    // Sandboxed environments may not expose persistent storage.
  }
}

/** Collapsed floating action button. The shell stays mounted across target
 *  switches so the expand/collapse choice survives. */
export default function ApplicationChat({ target, defaultEngine, readyEngineIds }: ApplicationChatProps) {
  const { t } = useTranslation();
  const [expanded, setExpanded] = useState(false);

  if (!expanded) {
    return (
      <button
        type="button"
        onClick={() => setExpanded(true)}
        title={t("applicationChat.expand")}
        aria-label={t("applicationChat.expand")}
        className="fixed bottom-6 right-6 z-[60] flex h-12 w-12 items-center justify-center rounded-full bg-[var(--accent)] text-white shadow-lg transition-transform hover:scale-105"
      >
        <svg width="20" height="20" viewBox="0 0 20 20" fill="none" aria-hidden="true">
          <path d="M3 5.5A2.5 2.5 0 0 1 5.5 3h9A2.5 2.5 0 0 1 17 5.5v6a2.5 2.5 0 0 1-2.5 2.5H8.4L5 17v-3h.5A2.5 2.5 0 0 1 3 11.5v-6Z" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round" />
        </svg>
      </button>
    );
  }

  // Keyed by history so switching applications remounts the panel with the
  // new app's history and fresh draft/state — no reset effects needed.
  return (
    <ChatPanel
      key={historyKey(target)}
      target={target}
      defaultEngine={defaultEngine}
      readyEngineIds={readyEngineIds}
      onCollapse={() => setExpanded(false)}
    />
  );
}

function ChatPanel({
  target,
  defaultEngine,
  readyEngineIds,
  onCollapse,
}: ApplicationChatProps & { onCollapse: () => void }) {
  const { t } = useTranslation();
  const [messages, setMessages] = useState<ChatMessage[]>(() => loadHistory(target));
  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);
  const listRef = useRef<HTMLDivElement | null>(null);
  const stateRef = useRef<unknown>(null);

  // Cache the app's last-reported state so the agent gets continuity.
  useEffect(() => {
    const handleMessage = (event: MessageEvent) => {
      if (event.source !== target.frameWindow) return;
      if (!isApplicationStateMessage(event.data)) return;
      stateRef.current = event.data.state;
    };
    window.addEventListener("message", handleMessage);
    return () => window.removeEventListener("message", handleMessage);
  }, [target]);

  // Keep the newest message in view.
  useEffect(() => {
    listRef.current?.scrollTo({ top: listRef.current.scrollHeight });
  }, [messages]);

  const appendMessage = useCallback((message: ChatMessage) => {
    setMessages((prev) => {
      const next = [...prev, message];
      persistHistory(target, next);
      return next;
    });
  }, [target]);

  const canChat = chatActionAvailable(target);
  const isBuildMode = target.kind === "studio";
  const effectiveEngine: AgentEngineId =
    readyEngineIds.includes(defaultEngine) ? defaultEngine : "builtin";

  // Build mode: the reply streams back over the regular agent events, routed
  // by conversation id. Accumulate deltas; done/error finalize the turn.
  const buildConvId = isBuildMode ? buildConversationId(target.appPath) : null;
  const streamRef = useRef("");
  useEffect(() => {
    if (!buildConvId) return;
    streamRef.current = "";
    const unsubs: Array<() => void> = [];
    let active = true;
    void (async () => {
      const u1 = await listen<ResponseChunk>("agent-response", (event) => {
        if (!active || event.payload.conversation_id !== buildConvId) return;
        streamRef.current += event.payload.content;
      });
      const u2 = await listen<ResponseDone>("agent-done", (event) => {
        if (!active || event.payload.conversation_id !== buildConvId) return;
        appendMessage({
          role: "assistant",
          text: (event.payload.full_text || streamRef.current).slice(0, 4000),
          at: Date.now(),
        });
        setSending(false);
      });
      const u3 = await listen<ResponseError>("agent-error", (event) => {
        if (!active || event.payload.conversation_id !== buildConvId) return;
        appendMessage({ role: "assistant", text: event.payload.error, at: Date.now(), error: true });
        setSending(false);
      });
      unsubs.push(u1, u2, u3);
    })();
    return () => {
      active = false;
      for (const fn of unsubs) fn();
    };
  }, [appendMessage, buildConvId]);

  const send = useCallback(async () => {
    const text = draft.trim();
    if (!text || sending || !canChat) return;
    setDraft("");
    setSending(true);
    appendMessage({ role: "user", text, at: Date.now() });
    try {
      if (isBuildMode && target.kind === "studio") {
        // Build mode drives the regular chat pipeline: the agent has file
        // tools and a persistent session, so it actually edits the app and
        // remembers earlier adjustments.
        const startedKey = buildStartedKey(target);
        let started = false;
        try {
          started = localStorage.getItem(startedKey) === "1";
        } catch { /* non-persistent storage: treat as first message */ }
        const message = started ? text : `${applicationBuildPrompt}${text}`;
        // Point the backend's spawn cwd at the app directory (same pattern
        // as the main chat's per-conversation workspace handling).
        await invoke("set_active_workspace", { path: target.appPath }).catch(() => {});
        await invoke("send_message", {
          message,
          conversationId: buildConversationId(target.appPath),
          engine: effectiveEngine,
          isContinue: started,
          model: null,
        });
        if (!started) {
          try {
            localStorage.setItem(startedKey, "1");
          } catch { /* ignore */ }
        }
        // The reply arrives via the agent-response/done/error listeners.
        return;
      }
      // Use mode: stateless run against the app's chat action. Only
      // marketplace targets reach here — build mode returned above.
      if (target.kind !== "marketplace") return;
      const inputs = buildChatInputs(text, stateRef.current);
      const record: PixieApplicationRunRecord = await invoke("application_run", {
        id: target.appId,
        actionId: CHAT_ACTION_ID,
        inputs,
        engine: effectiveEngine,
        model: null,
      });
      const { text: summary, followups } = summarizeRunOutputs(record.outputs);
      appendMessage({
        role: "assistant",
        text: summary || record.rawResult.slice(0, 2000) || t("applicationChat.done"),
        at: Date.now(),
        followups,
      });
      // Push the fresh outputs to the app so it can re-render itself.
      target.frameWindow?.postMessage(
        {
          type: APPLICATION_STATE_UPDATE_MESSAGE_TYPE,
          outputs: record.outputs,
          actionId: CHAT_ACTION_ID,
        },
        "*",
      );
    } catch (e) {
      appendMessage({ role: "assistant", text: String(e), at: Date.now(), error: true });
      setSending(false);
    } finally {
      if (!isBuildMode) setSending(false);
    }
  }, [appendMessage, canChat, draft, effectiveEngine, isBuildMode, sending, t, target]);

  return (
    <div className="fixed bottom-6 right-6 z-[60] flex h-[520px] w-[380px] flex-col overflow-hidden rounded-xl border border-[var(--border-color)] bg-[var(--bg-primary)] shadow-2xl">
      {/* Header — fixed chrome, identical for every application. */}
      <div className="flex shrink-0 items-center gap-2 border-b border-[var(--border-color)] px-3 py-2">
        <span className="h-2 w-2 shrink-0 rounded-full bg-[var(--accent)]" aria-hidden="true" />
        <span className="min-w-0 flex-1 truncate text-xs font-medium text-[var(--text-primary)]">
          {target.appName}
        </span>
        <span className="shrink-0 rounded bg-[var(--bg-tertiary)] px-1.5 py-0.5 text-[10px] text-[var(--text-secondary)]">
          {isBuildMode ? t("applicationChat.badgeBuild") : t("applicationChat.badge")}
        </span>
        <button
          type="button"
          onClick={() => {
            if (!window.confirm(t("applicationChat.clearConfirm"))) return;
            setMessages([]);
            persistHistory(target, []);
          }}
          title={t("applicationChat.clear")}
          aria-label={t("applicationChat.clear")}
          className="shrink-0 rounded p-1 text-[var(--text-secondary)] transition-colors hover:bg-[var(--bg-tertiary)] hover:text-[var(--text-primary)]"
        >
          <svg width="13" height="13" viewBox="0 0 14 14" fill="none" aria-hidden="true">
            <path d="M2 3.5h10M5.5 3V2h3v1M3.5 3.5l.5 8h6l.5-8M5.75 6v3M8.25 6v3" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </button>
        <button
          type="button"
          onClick={onCollapse}
          title={t("applicationChat.collapse")}
          aria-label={t("applicationChat.collapse")}
          className="shrink-0 rounded p-1 text-[var(--text-secondary)] transition-colors hover:bg-[var(--bg-tertiary)] hover:text-[var(--text-primary)]"
        >
          <svg width="13" height="13" viewBox="0 0 14 14" fill="none" aria-hidden="true">
            <path d="M3 9l4-4 4 4" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </button>
      </div>

      {/* Message list. */}
      <div ref={listRef} className="flex-1 min-h-0 space-y-2 overflow-y-auto px-3 py-3">
        {messages.length === 0 && (
          <p className="px-1 text-xs leading-relaxed text-[var(--text-secondary)]">
            {isBuildMode ? t("applicationChat.emptyBuild") : t("applicationChat.empty")}
          </p>
        )}
        {messages.map((message, index) => (
          <div key={index} className={message.role === "user" ? "flex flex-col items-end" : ""}>
            <div
              className={`max-w-[85%] rounded-lg px-2.5 py-1.5 text-xs leading-relaxed whitespace-pre-wrap break-words ${
                message.role === "user"
                  ? "bg-[var(--accent)] text-white"
                  : message.error
                    ? "bg-red-500/10 text-red-300"
                    : "bg-[var(--bg-tertiary)] text-[var(--text-primary)]"
              }`}
            >
              {message.text}
            </div>
            {!!message.followups?.length && (
              <div className="mt-1 flex max-w-[85%] flex-wrap justify-end gap-1">
                {message.followups.map((followup) => (
                  <button
                    key={followup}
                    type="button"
                    onClick={() => setDraft(followup)}
                    className="rounded-full border border-[var(--border-color)] px-2 py-0.5 text-[10px] text-[var(--text-secondary)] transition-colors hover:border-[var(--accent)] hover:text-[var(--accent)]"
                  >
                    {followup}
                  </button>
                ))}
              </div>
            )}
          </div>
        ))}
        {sending && (
          <div className="flex items-center gap-2 px-1 text-xs text-[var(--text-secondary)]">
            <span className="h-3 w-3 animate-spin rounded-full border-2 border-[var(--accent)] border-t-transparent" />
            {isBuildMode ? t("applicationChat.sendingBuild") : t("applicationChat.sending")}
          </div>
        )}
      </div>

      {/* Composer. */}
      {!canChat ? (
        <div className="shrink-0 border-t border-[var(--border-color)] px-3 py-2 text-xs text-[var(--text-secondary)]">
          {t("applicationChat.noAction")}
        </div>
      ) : (
        <div className="flex shrink-0 items-end gap-2 border-t border-[var(--border-color)] p-2">
          <textarea
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                void send();
              }
            }}
            disabled={sending}
            rows={2}
            placeholder={isBuildMode ? t("applicationChat.placeholderBuild") : t("applicationChat.placeholder")}
            aria-label={isBuildMode ? t("applicationChat.placeholderBuild") : t("applicationChat.placeholder")}
            className="max-h-28 min-h-[2.4rem] flex-1 resize-none rounded-lg border border-[var(--border-color)] bg-[var(--bg-secondary)] px-2.5 py-1.5 text-xs text-[var(--text-primary)] placeholder-[var(--text-secondary)] outline-none focus:border-[var(--accent)] disabled:opacity-50"
          />
          <button
            type="button"
            onClick={() => void send()}
            disabled={sending || !draft.trim()}
            title={t("applicationChat.send")}
            aria-label={t("applicationChat.send")}
            className="shrink-0 rounded-lg bg-[var(--accent)] p-2 text-white transition-colors hover:bg-[var(--accent-hover)] disabled:opacity-40"
          >
            <svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden="true">
              <path d="M7 11.5V2.5M7 2.5L3 6.5M7 2.5l4 4" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </button>
        </div>
      )}
    </div>
  );
}
