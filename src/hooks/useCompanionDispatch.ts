import { useEffect, useRef, useState } from "react";
import { listen, emit } from "@tauri-apps/api/event";
import { getCurrentWindow } from "@tauri-apps/api/window";
import type { AgentEngineId } from "../types";
import type { CompanionDispatch } from "../companion/types";

/**
 * Companion task dispatch: when the user accepts a task proposal in the pet's
 * action card, the pet emits `companion-dispatch`. The main window (which owns
 * conversation state) creates a FRESH conversation for the task — the pet chat
 * is context, not history; a dedicated session stays independently stoppable,
 * retryable, and visible in the sidebar with a 🐾 badge — and immediately
 * sends the (self-contained) task instruction.
 *
 * Workspace resolution order: the proposal's suggestion → the parent dir of
 * the first attachment (registered as a workspace if new) → the app's current
 * default. The conversation is marked origin="companion".
 *
 * If the main window is hidden, the task still runs — dispatching never
 * steals focus; the pet reports progress in its own card.
 */
export function useCompanionDispatch(
  addWorkspacePath: (path: string) => string,
  createConversation: (
    workspaceId?: string,
    engine?: AgentEngineId,
    model?: string,
    metadata?: { origin?: "companion" },
  ) => string,
  sendMessage: (content: string, convIdOverride?: string) => Promise<void> | void,
  workspaces: { id: string; path: string }[]
): string | null {
  // Refs so the listener subscribes once; callbacks stay fresh.
  const addWorkspacePathRef = useRef(addWorkspacePath);
  const createConversationRef = useRef(createConversation);
  const sendMessageRef = useRef(sendMessage);
  const workspacesRef = useRef(workspaces);
  useEffect(() => {
    addWorkspacePathRef.current = addWorkspacePath;
    createConversationRef.current = createConversation;
    sendMessageRef.current = sendMessage;
    workspacesRef.current = workspaces;
  });

  /** The most recently dispatched conversation id, so the pet's [View] can
   * navigate straight to the task it launched (null until one exists). */
  const [lastDispatchedId, setLastDispatchedId] = useState<string | null>(null);

  // Follow-up: the pet routes a follow-up instruction into an existing
  // dispatched conversation. No new session — the agent keeps its context,
  // so "改列名" lands where the table was just built.
  useEffect(() => {
    const un = listen<{ conversation_id: string; message: string }>(
      "companion-followup",
      async (e) => {
        const { conversation_id, message } = e.payload ?? {};
        if (!conversation_id || !message?.trim()) return;
        await sendMessageRef.current(message, conversation_id);
      }
    );
    return () => {
      void un.then((f) => f());
    };
  }, []);

  useEffect(() => {
    const un = listen<CompanionDispatch>("companion-dispatch", async (e) => {
      const { task, workspace, engine, attachments } = e.payload ?? {};
      if (!task?.trim()) return;

      // Resolve the workspace the task should run in.
      let wsId: string | null = null;
      if (workspace && workspace.trim()) {
        wsId = workspace.trim();
      } else if (attachments.length > 0) {
        const parent = attachments[0].replace(/\/[^/]*$/, "");
        if (parent) wsId = parent;
      }
      const known = workspacesRef.current.some((w) => w.path === wsId || w.id === wsId);
      if (wsId && !known) {
        // Register the dir as a workspace (capped, deduped — see useChat).
        addWorkspacePathRef.current(wsId);
      }

      const convId = createConversationRef.current(
        wsId ?? undefined,
        engine && engine.trim() ? (engine.trim() as AgentEngineId) : undefined,
        undefined,
        { origin: "companion" },
      );
      if (!convId) return;
      setLastDispatchedId(convId);
      // Tell the pet window which conversation the dispatch landed in, so its
      // [View] button navigates there (not just "open the main window").
      void emit("companion-dispatched", { conversation_id: convId }).catch(() => {});

      // Let React flush the conversation state created above: sendMessage
      // reads the conversation (for engine / pendingWorkspaceId) from a ref
      // that a synchronous follow-up call would still see empty.
      await new Promise((r) => setTimeout(r, 0));

      // The task text is self-contained by protocol — the new session needs
      // nothing from the pet chat that produced it.
      await sendMessageRef.current(task, convId);

      // Focus follow: only bring the main window forward if it's ALREADY
      // visible — a hidden window means the user is elsewhere; the pet card
      // reports progress instead.
      try {
        const win = getCurrentWindow();
        if (await win.isVisible()) {
          await win.show();
          await win.setFocus();
        }
      } catch {
        /* best-effort */
      }
    });
    return () => {
      void un.then((f) => f());
    };
  }, []);

  return lastDispatchedId;
}
