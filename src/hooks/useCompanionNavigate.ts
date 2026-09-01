import { useEffect } from "react";
import { listen } from "@tauri-apps/api/event";

/**
 * Companion-window navigation: when the user clicks an activity row in the
 * floating pet card, the backend focuses the main window and emits
 * `companion-navigate`; this hook opens that conversation. Self-contained so
 * App.tsx only adds a single hook call.
 */
export function useCompanionNavigate(
  switchConversation: (id: string, workspaceId?: string) => void,
  setMainView: (view: "chat") => void
) {
  useEffect(() => {
    const un = listen<{ conversation_id: string }>("companion-navigate", (e) => {
      const id = e.payload?.conversation_id;
      if (!id) return;
      setMainView("chat");
      switchConversation(id);
    });
    return () => {
      void un.then((f) => f());
    };
  }, [switchConversation, setMainView]);
}
