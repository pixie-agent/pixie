import { useCallback, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import rehypeRaw from "rehype-raw";
import { invoke } from "@tauri-apps/api/core";
import { listen, emit } from "@tauri-apps/api/event";
import {
  getCurrentWindow,
  LogicalSize,
  PhysicalPosition,
  PhysicalSize,
  currentMonitor,
} from "@tauri-apps/api/window";
import { PetSprite } from "./PetSprite";
import { CompanionCard } from "./CompanionCard";
import type {
  ActivityRecord,
  CompanionChatEntry,
  CompanionPrefs,
  CompanionResponse,
  CompanionSnapshot,
  PetAttachment,
  PetState,
} from "./types";

/// Toast bubble width (logical px); height is measured from content so long
/// agent output is fully visible instead of clipping.
const TOAST_WIDTH = 420;
const TOAST_MIN_HEIGHT = 140;
const TOAST_MAX_HEIGHT = 640;
const EXPANDED_SIZE = new LogicalSize(400, 560);
/// Collapsed context-menu size: w-44 (176) + 16px breathing room; height
/// fits 5 icon rows + separator + padding with margin to spare (a tight fit
/// shows a scrollbar). The collapsed window is only SPRITE_W×SPRITE_H —
/// without this the menu renders clipped.
const MENU_SIZE = new LogicalSize(192, 176);
/// Cap on staged drag-and-drop attachments (chips + prompt stay bounded).
const MAX_ATTACHMENTS = 5;

/// Monochrome 16×16 line icon for context-menu rows — one visual weight for
/// every item (no mixed emoji), aligned by the fixed box.
function MenuIcon({ d, stroke }: { d: string; stroke?: boolean }) {
  return (
    <svg
      viewBox="0 0 16 16"
      width="14"
      height="14"
      fill={stroke ? "none" : "currentColor"}
      stroke={stroke ? "currentColor" : undefined}
      strokeWidth={stroke ? 1.4 : undefined}
      className="shrink-0 opacity-70"
    >
      <path d={d} />
    </svg>
  );
}

/// The pet's on-screen anchor: the sprite's right edge x and vertical center
/// y (logical px, screen space). Every size change (expand / collapse / toast)
/// recomputes the window position so THIS point never moves — the user parked
/// the pet here, and it stays here.
const SPRITE_W = 120; // collapsed window = the sprite's hitbox
const SPRITE_H = 140;

const win = getCurrentWindow();

function derivePetState(activities: ActivityRecord[], now: number): PetState {
  const needsHuman = activities.some(
    (r) =>
      r.status === "waiting_permission" ||
      (r.status === "failed" && now - (r.finished_at ?? 0) < 5 * 60_000)
  );
  if (needsHuman) return "alert";
  if (activities.some((r) => r.status === "running")) return "watching";
  return "idle";
}

function badgeCount(activities: ActivityRecord[]): number {
  return activities.filter(
    (r) => r.status === "waiting_permission" || r.status === "failed"
  ).length;
}

/// While streaming, a partial ```pixie-task block may be arriving. Cut from
/// the opening fence on: complete blocks are replaced by the action card on
/// "done", and a half-written one would just flash raw JSON at the user.
function stripStreamingTaskBlock(text: string): string {
  const idx = text.indexOf("```pixie-task");
  return idx === -1 ? text : text.slice(0, idx).trimEnd();
}

interface CompanionToast {
  kind: string; // "done" | "error" | "info"
  main: string;
  label: string;
}

export function CompanionApp() {
  const { t } = useTranslation();
  const [activities, setActivities] = useState<ActivityRecord[]>([]);
  const [prefs, setPrefs] = useState<CompanionPrefs | null>(null);
  const [history, setHistory] = useState<CompanionChatEntry[]>([]);
  const [brainAvailable, setBrainAvailable] = useState(true);
  const [expanded, setExpanded] = useState(false);
  const [isAsking, setIsAsking] = useState(false);
  const [streamedAnswer, setStreamedAnswer] = useState("");
  const [menuOpen, setMenuOpen] = useState(false);
  const [toast, setToast] = useState<CompanionToast | null>(null);
  const [toastClosed, setToastClosed] = useState(false);
  // Staged attachments (dragged files, region captures, clipboard text),
  // rendered as chips above the input until sent.
  const [attachments, setAttachments] = useState<PetAttachment[]>([]);
  const askBufferRef = useRef("");
  const prefsRef = useRef<CompanionPrefs | null>(null);

  // Ambient bubble: STICKY — a new notification REPLACES the current bubble
  // in place; it never auto-dismisses. The user closes it by clicking the ×
  // (a new message reopens it). This is the pet's voice, not a transient hint.
  useEffect(() => {
    const un = listen<CompanionToast>("companion-toast", (e) => {
      setToast(e.payload);
      setToastClosed(false);
    });
    return () => {
      void un.then((f) => f());
    };
  }, []);

  useEffect(() => {
    prefsRef.current = prefs;
  }, [prefs]);

  // Theme: mirror the main window's persisted theme so the pet matches.
  useEffect(() => {
    const apply = (theme: string | null) => {
      if (theme) document.documentElement.setAttribute("data-theme", theme);
    };
    let cancelled = false;
    void invoke<Record<string, unknown>>("load_app_config").then((cfg) => {
      if (!cancelled) apply((cfg?.theme as string) ?? null);
    });
    const un = win.listen<{ theme?: string } | null>("companion-theme", (e) => {
      apply(e.payload?.theme ?? null);
    });
    return () => {
      cancelled = true;
      void un.then((f) => f());
    };
  }, []);

  // The main window confirms each dispatch with the conversation id it
  // landed in; [View] on the dispatched card navigates there.
  const [dispatchedConvId, setDispatchedConvId] = useState<string | null>(null);
  useEffect(() => {
    const un = listen<{ conversation_id: string }>("companion-dispatched", (e) => {
      if (e.payload?.conversation_id) setDispatchedConvId(e.payload.conversation_id);
    });
    return () => {
      void un.then((f) => f());
    };
  }, []);

  // File drag-and-drop onto the pet (window-wide — dropping anywhere on the
  // sprite counts). Paths are staged as attachment chips; the accompanying
  // instruction is whatever the user then types. Capped to keep the prompt
  // and chip row bounded.
  /** Stage file paths as chips (deduped by path, capped). */
  const addFileAttachments = useCallback((paths: string[]) => {
    setAttachments((prev) => {
      const existing = new Set(
        prev.filter((a): a is PetAttachment & { kind: "file" } => a.kind === "file").map((a) => a.value)
      );
      const fresh = paths
        .filter((p) => !existing.has(p))
        .map((p) => ({
          id: `${p}#${Date.now()}`,
          kind: "file" as const,
          value: p,
          preview: p.split("/").filter(Boolean).pop() || p,
        }));
      return [...prev, ...fresh].slice(-MAX_ATTACHMENTS);
    });
  }, []);

  useEffect(() => {
    const un = win.onDragDropEvent((event) => {
      if (event.payload.type === "drop") {
        const paths = event.payload.paths;
        if (!paths.length) return;
        // Dropping onto the collapsed sprite expands the card so the chips
        // are immediately visible — otherwise the drop looks like a no-op.
        setExpanded(true);
        addFileAttachments(paths);
      }
    });
    return () => {
      void un.then((f) => f());
    };
  }, [addFileAttachments]);

  /** Interactive region capture ("look at my screen"): the user draws the
   * region (that gesture is the authorization); the saved shot is staged
   * like a dragged-in file. ESC / cancel is a silent no-op. */
  const captureScreen = useCallback(async () => {
    try {
      const path = await invoke<string | null>("capture_screen_region");
      if (!path) return; // cancelled
      setExpanded(true);
      addFileAttachments([path]);
    } catch (e) {
      console.error("[companion] capture failed", e);
    }
  }, [addFileAttachments]);

  /** Read the clipboard as text and stage it as a quote chip. Empty or
   * non-text clipboards are a silent no-op. */
  const readClipboard = useCallback(async () => {
    try {
      const text = await invoke<string | null>("read_clipboard_text");
      if (!text) return;
      setExpanded(true);
      setAttachments((prev) =>
        [
          ...prev,
          {
            id: `clip#${Date.now()}`,
            kind: "clipboard" as const,
            value: text,
            preview: text.replace(/\s+/g, " ").slice(0, 30) || "(text)",
          },
        ].slice(-MAX_ATTACHMENTS),
      );
    } catch (e) {
      console.error("[companion] clipboard read failed", e);
    }
  }, []);

  // Initial snapshot.
  useEffect(() => {
    void invoke<CompanionSnapshot>("get_companion_state")
      .then((snap) => {
        setActivities(snap.activities);
        setPrefs(snap.prefs);
        setHistory(snap.history);
        setBrainAvailable(snap.brain_available);
      })
      .catch((e) => console.error("[companion] snapshot failed", e));
  }, []);

  // Live activity updates (upsert by id).
  useEffect(() => {
    const un = listen<ActivityRecord>("companion-activity", (e) => {
      const rec = e.payload;
      setActivities((prev) => {
        const idx = prev.findIndex((r) => r.id === rec.id);
        if (idx === -1) return [...prev, rec];
        const next = [...prev];
        next[idx] = rec;
        return next;
      });
    });
    return () => {
      void un.then((f) => f());
    };
  }, []);

  // Streamed Q&A answers.
  useEffect(() => {
    const un = listen<CompanionResponse>("companion-response", (e) => {
      const { content, event_type } = e.payload;
      if (event_type === "delta") {
        askBufferRef.current += content;
        // Hide a streaming pixie-task block — it's machine protocol, not prose
        // for the user; the parsed proposal card arrives with "done".
        setStreamedAnswer(stripStreamingTaskBlock(askBufferRef.current));
      } else if (event_type === "done") {
        setStreamedAnswer("");
        setIsAsking(false);
        // The final text was appended to history on the Rust side (persist
        // happens BEFORE this event); refresh the snapshot. A second, delayed
        // pull guards against any fs-sync edge the first read might hit.
        const pull = () =>
          void invoke<CompanionSnapshot>("get_companion_state")
            .then((snap) => {
              setHistory(snap.history);
              setBrainAvailable(snap.brain_available);
            })
            .catch(() => {});
        pull();
        setTimeout(pull, 300);
      } else if (event_type === "error") {
        setStreamedAnswer("");
        setIsAsking(false);
      }
    });
    return () => {
      void un.then((f) => f());
    };
  }, []);

  // ---- Pet anchoring ------------------------------------------------------
  // The sprite's anchor (right-edge x / vertical-center y, PHYSICAL screen px)
  // is the single source of truth for WHERE the pet lives. All math runs in
  // physical pixels — logical↔physical round-trips are what caused the 1px
  // drift between toast-open and toast-closed. Size changes recompute the
  // window position from the anchor — never the other way — so expanding,
  // collapsing, and toasts leave the sprite pixel-stationary.
  const anchorRef = useRef<{ rx: number; cy: number } | null>(null);
  const toastRef = useRef<HTMLDivElement>(null);
  const restoringRef = useRef(false);

  // Size/position for the current mode, derived from the anchor.
  // MUTEXED: rapid open→close→open of the menu (or toast racing a menu)
  // launches overlapping setSize/setPosition sequences; concurrent native
  // resizes corrupt the anchor grace-window and can wedgethe webview (the
  // "second menu open crashes" bug). A run token makes stale runs abandon
  // themselves — only the newest target completes.
  const geoRunRef = useRef(0);
  // True while the run that FOLLOWS a menu close is applying — see the
  // deferred shrink inside the effect.
  const menuJustClosedRef = useRef(false);
  useEffect(() => {
    const run = ++geoRunRef.current;
    void (async () => {
      const isStale = () => run !== geoRunRef.current;
      const factor = await win.scaleFactor().catch(() => 1);
      if (isStale()) {
        return;
      }
      const spriteW = Math.round(SPRITE_W * factor);
      const spriteH = Math.round(SPRITE_H * factor);

      // Seed the anchor on first run from the actual window position.
      if (!anchorRef.current) {
        const pos = await win.outerPosition();
        anchorRef.current = {
          rx: pos.x + spriteW,
          cy: pos.y + spriteH / 2,
        };
      }
      const { rx, cy } = anchorRef.current;

      let w = spriteW;
      let h = spriteH;

      if (expanded) {
        w = Math.round(EXPANDED_SIZE.width * factor);
        h = Math.round(EXPANDED_SIZE.height * factor);
      } else if (menuOpen) {
        // Context menu needs more room than the sprite-sized window — grow
        // leftward from the anchor (same trick as toasts) so the pet itself
        // never moves. The menu WINS over a visible toast: letting a toast
        // re-expand the window on menu-close produced a 3-way resize fight
        // (menu 192 ↔ toast 420 ↔ sprite 120) that crashed the webview on
        // rapid open/close cycles.
        w = Math.round(MENU_SIZE.width * factor);
        h = Math.round(MENU_SIZE.height * factor);
      } else if (toast && !toastClosed) {
        // Bubble height from the rendered content (measured after paint).
        await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
        if (isStale()) return;
        h = Math.max(
          Math.round(TOAST_MIN_HEIGHT * factor),
          Math.min(
            Math.round(TOAST_MAX_HEIGHT * factor),
            Math.ceil((toastRef.current?.offsetHeight ?? 0) * factor) + 8 * factor
          )
        );
        w = Math.round(TOAST_WIDTH * factor);
      }

      // Window x/y so the sprite's right edge = rx and its center = cy.
      const physX = rx - w;
      const physY = cy - spriteH / 2;

      // Clamp into the current monitor — only as much as visibility requires.
      let x = physX;
      let y = physY;
      try {
        const monitor = await currentMonitor();
        if (monitor) {
          const minX = monitor.position.x;
          const minY = monitor.position.y;
          const maxX = monitor.position.x + monitor.size.width - w;
          const maxY = monitor.position.y + monitor.size.height - h;
          x = Math.max(minX, Math.min(x, maxX));
          y = Math.max(minY, Math.min(y, maxY));
        }
      } catch {
        // best-effort
      }
      if (isStale()) return;

      // Real right-clicks end a WebKit context-menu tracking session at menu
      // close; a setSize in flight at that exact moment is the suspected
      // window-reordering trigger. Defer the shrink ~200ms so the native
      // tracking teardown finishes first (rank-2 hypothesis, cheap insurance).
      if (menuJustClosedRef.current && !expanded && !menuOpen) {
        menuJustClosedRef.current = false;
        await new Promise<void>((resolve) => setTimeout(resolve, 200));
        if (isStale()) return;
      }

      restoringRef.current = true; // suppress anchor updates from our own move
      await win.setPosition(new PhysicalPosition(x, y)).catch(() => {});
      if (isStale()) {
        return; // stop halfway: a newer run owns the geometry now
      }
      await win.setSize(new PhysicalSize(w, h)).catch(() => {});
      // Hold the suppression through a grace window: macOS can deliver the
      // Moved event for the resize slightly AFTER setSize resolves. The
      // timer is TOKEN-GATED: an older run's timer must NOT clear the flag
      // while a NEWER run's resize is still in flight — that race let a
      // mid-transition Moved (pos=rx-192, size still 120) update the anchor
      // and corrupt it 72px left per menu cycle (the "second right-click
      // at the same spot crashes; dragging the pet fixes it" bug).
      setTimeout(() => {
        if (isStale()) return; // superseded — leave the flag to the new run
        restoringRef.current = false;
      }, 350);
    })();
  }, [expanded, menuOpen, toast, toastClosed]);

  // Drag → update the anchor (physical px). Only GENUINE user drags count:
  // (a) grace window after our own transitions, (b) window must be at
  // collapsed sprite size — programmatic toast/card geometry is rejected.
  useEffect(() => {
    const un = win.onMoved(async () => {
      if (restoringRef.current) return;
      const pos = await win.outerPosition();
      const size = await win.outerSize();
      const factor = await win.scaleFactor().catch(() => 1);
      const spriteW = Math.round(SPRITE_W * factor);
      if (Math.abs(size.width - spriteW) > 2) return; // not sprite-sized
      anchorRef.current = {
        rx: pos.x + spriteW,
        cy: pos.y + Math.round(SPRITE_H * factor) / 2,
      };
    });
    return () => {
      void un.then((f) => f());
    };
  }, []);

  useEffect(() => {
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        // Close the context menu first if open; otherwise collapse the card.
        setMenuOpen((menu) => {
          if (menu) return false;
          setExpanded(false);
          return menu;
        });
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  // Click-away closes the context menu. macOS blur events are unreliable
  // here (skip-taskbar + acceptFirstMouse windows don't reliably become key,
  // so tauri://blur often never fires). Deterministic layers instead:
  //  * Capture-phase pointerdown: any press NOT inside the menu closes it.
  //    Covers in-window clicks without a fragile full-size backdrop.
  //  * Poll isFocused while the menu is open: a click OUTSIDE this window
  //    doesn't reach the webview at all — polling is the only way to notice.
  //  * tauri://blur still closes when it does fire (free extra layer).
  //  * Escape in the key handler above.
  const menuRef = useRef<HTMLDivElement | null>(null);
  // The sprite's 120×140 hitbox (right column of the collapsed window) — the
  // ONLY context-menu trigger zone (see the root onContextMenu guard).
  const spriteZoneRef = useRef<HTMLDivElement | null>(null);
  const menuOpenRef = useRef(menuOpen);
  useEffect(() => {
    menuOpenRef.current = menuOpen;
  }, [menuOpen]);

  useEffect(() => {
    if (!menuOpen) return;
    // Menu lifecycle follows the NATIVE focus model:
    //   right-click -> menu opens (macOS makes this window key, via
    //   acceptFirstMouse) -> clicking elsewhere hands key state away ->
    //   native blur -> menu closes -> next right-click starts over.
    // The blur listener (below) is the primary close signal. This poll is
    // the fallback for the case where the window never became key (WebKit
    // swallows synthetic/odd right-clicks): if the cursor has LEFT our
    // window entirely AND another app is frontmost, the user is gone —
    // close. No setFocus() anywhere: activation is the crash path.
    const onDown = (e: PointerEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setMenuOpen(false);
      }
    };
    document.addEventListener("pointerdown", onDown, true);
    const poll = setInterval(() => {
      void invoke<{ companion_is_key: boolean; cursor_inside: boolean } | null>(
        "menu_click_state",
      )
        .then((state) => {
          if (!state || !menuOpenRef.current) return;
          // Clicked elsewhere = cursor left the pet window AND the pet window
          // is not the key window. Window-level, not app-level: clicking the
          // MAIN window (same bundle) must close the menu too.
          if (!state.cursor_inside && !state.companion_is_key) {
            setMenuOpen(false);
          }
        })
        .catch(() => {});
    }, 300);
    return () => {
      // Menu just closed — flag the geometry effect to defer its shrink
      // (WebKit tracking teardown, see comment there).
      menuJustClosedRef.current = true;
      document.removeEventListener("pointerdown", onDown, true);
      clearInterval(poll);
    };
  }, [menuOpen]);

  useEffect(() => {
    const un = win.onFocusChanged(({ payload: focused }) => {
      if (!focused && menuOpenRef.current) {
        setMenuOpen(false);
      }
    });
    return () => {
      void un.then((f) => f());
    };
  }, []);

  // Persist drag position (debounced). `outerPosition` returns PHYSICAL
  // pixels; convert to logical so the saved value restores correctly
  // regardless of the display's scale factor. Programmatic re-anchoring does
  // NOT persist (only genuine user drags do).
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | null = null;
    const un = win.onMoved(() => {
      if (restoringRef.current) return; // our own setPosition, not a drag
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => {
        void (async () => {
          const pos = await win.outerPosition();
          const factor = await win.scaleFactor();
          const p = prefsRef.current;
          if (!p) return;
          await invoke("set_companion_prefs", {
            prefs: {
              ...p,
              window_x: Math.round(pos.x / factor),
              window_y: Math.round(pos.y / factor),
            },
          }).catch(() => {});
        })();
      }, 500);
    });
    return () => {
      if (timer) clearTimeout(timer);
      void un.then((f) => f());
    };
  }, []);

  // Closing hides instead of destroying (the window is never rebuilt).
  useEffect(() => {
    const un = win.onCloseRequested(async (event) => {
      event.preventDefault();
      await win.hide();
    });
    return () => {
      void un.then((f) => f());
    };
  }, []);

  // Ticking "now" for elapsed-time display and pet-state derivation (alert
  // fades 5min after a failure); kept in state so render stays pure.
  const [now, setNow] = useState(0);
  useEffect(() => {
    const raf = requestAnimationFrame(() => setNow(Date.now()));
    const id = setInterval(() => setNow(Date.now()), 2_000);
    return () => {
      cancelAnimationFrame(raf);
      clearInterval(id);
    };
  }, []);

  const petState = derivePetState(activities, now);
  const badge = badgeCount(activities);
  const runningCount = activities.filter((r) => r.status === "running").length;

  const ask = useCallback(
    (q: string, atts?: PetAttachment[]) => {
      const withAtts = atts ?? attachments;
      askBufferRef.current = "";
      setStreamedAnswer("");
      setIsAsking(true);
      // Attachments are consumed by this send — chips clear with the input.
      setAttachments([]);
      // Clipboard text has no file to point the brain at — inline it into
      // the question so it is visible in one place.
      const clipNotes = withAtts
        .filter((a) => a.kind === "clipboard")
        .map((a, i) => `[clipboard ${i + 1}]\n${a.value}`)
        .join("\n\n");
      const question = clipNotes ? `${q}\n\n${clipNotes}` : q;
      const files = withAtts
        .filter((a): a is PetAttachment & { kind: "file" } => a.kind === "file")
        .map((a) => a.value);
      void invoke("companion_ask", {
        question,
        // Omit when empty so the backend's Option<Vec> deserializes to None.
        ...(files.length > 0 ? { attachments: files } : {}),
      }).catch(() => setIsAsking(false));
    },
    [attachments],
  );

  /** Dispatch an accepted proposal to the main window (it owns conversation
   * state). The reply event carries the new conversation id, remembered so
   * [View] on the dispatched card can navigate to it. */
  const dispatchProposal = useCallback(
    (task: string, workspace: string, engine: string, atts: PetAttachment[]) => {
      // Split the staged attachments: files travel as paths (the executing
      // agent reads them itself); clipboard text is inlined into the task.
      const files = atts
        .filter((a): a is PetAttachment & { kind: "file" } => a.kind === "file")
        .map((a) => a.value);
      const clipNotes = atts
        .filter((a) => a.kind === "clipboard")
        .map((a, i) => `[clipboard ${i + 1}]\n${a.value}`)
        .join("\n\n");
      const fullTask = [task, clipNotes || null].filter(Boolean).join("\n\n");
      void emit("companion-dispatch", {
        task: fullTask,
        workspace,
        engine,
        attachments: files,
      })
        .then(() => setAttachments([]))
        .catch((e) => console.error("[companion] dispatch failed", e));
    },
    []
  );

  /** Send a follow-up instruction into an already-dispatched task's
   * conversation — the agent there keeps its context; no new session. */
  const followUp = useCallback((conversationId: string, message: string) => {
    void emit("companion-followup", {
      conversation_id: conversationId,
      message,
    }).catch((e) => console.error("[companion] followup failed", e));
  }, []);

  const enableDnd = useCallback(() => {
    const p = prefsRef.current;
    if (!p) return;
    const dndActive = p.dnd_until ? new Date(p.dnd_until) > new Date() : false;
    // Toggle: a second click CANCELS do-not-disturb.
    const next = {
      ...p,
      dnd_until: dndActive ? null : new Date(Date.now() + 60 * 60_000).toISOString(),
    };
    setPrefs(next);
    prefsRef.current = next;
    void invoke("set_companion_prefs", { prefs: next }).catch(() => {});
    // Visible confirmation — the pet "speaks" so the click never feels dead.
    setToast({
      kind: "info",
      main: dndActive ? "🔔 已取消免打扰" : "🔕 免打扰已开启（1 小时）",
      label: "",
    });
    setToastClosed(false);
  }, []);

  const resetChat = useCallback(() => {
    void invoke("reset_companion_chat")
      .then(() => {
        setHistory([]);
        setToast({ kind: "info", main: "🧹 对话已清空", label: "" });
        setToastClosed(false);
      })
      .catch(() => {});
  }, []);

  return (
    <div
      className={`w-screen h-screen bg-transparent ${expanded ? "p-3 overflow-visible" : "overflow-hidden"}`}
      onContextMenu={(e) => {
        // Only the SPRITE is a context-menu target. The toast bubble (which
        // fills most of the window when visible) must not toggle the menu —
        // a right-click there previously opened the menu AND tripped the
        // outside-click close in the same gesture (flicker/crash source).
        if (expanded || !spriteZoneRef.current?.contains(e.target as Node)) return;
        e.preventDefault();
        setMenuOpen((v) => !v);
      }}
    >
      {expanded ? (
        <CompanionCard
          activities={activities}
          history={history}
          brainAvailable={brainAvailable}
          isAsking={isAsking}
          streamedAnswer={streamedAnswer}
          attachments={attachments}
          onRemoveAttachment={(id) =>
            setAttachments((prev) => prev.filter((a) => a.id !== id))
          }
          dndActive={
            prefs?.dnd_until ? new Date(prefs.dnd_until) > new Date() : false
          }
          onCollapse={() => setExpanded(false)}
          onDnd={enableDnd}
          onResetChat={resetChat}
          onAsk={ask}
          onDispatch={dispatchProposal}
          onFollowUp={followUp}
          onAddFileAttachments={addFileAttachments}
          dispatchedConvId={dispatchedConvId}
        />
      ) : (
        // The sprite occupies a FIXED 140×140 zone at the window's top-right
        // (vertically CENTERED in that zone — matching the anchor math, where
        // the sprite's visual center is window-top + SPRITE_H/2). A toast to
        // its left never affects it; a taller window grows downward only.
        <div className="w-full h-full flex justify-end gap-2">
          {toast && !toastClosed && !menuOpen && (
            // flex-1 min-w-0: the bubble fills the space LEFT of the fixed
            // sprite zone exactly — never wider than the window (a fixed
            // w-[288px] overflowed the 380px window and got clipped).
            <div className="flex-1 min-w-0 flex items-center h-[140px]">
              <div
                ref={toastRef}
                className={`relative flex flex-col w-full rounded-2xl border px-3 py-2 shadow-[0_8px_24px_rgba(0,0,0,0.35)] backdrop-blur-xl animate-[pet-toast-in_0.25s_ease-out] max-h-full ${
                  toast.kind === "done"
                    ? "bg-green-950/85 border-green-500/30"
                    : toast.kind === "error"
                      ? "bg-red-950/85 border-red-500/30"
                      : "bg-[var(--bg-primary)]/90 border-[var(--border)]"
                }`}
              >
                <button
                  onClick={() => setToastClosed(true)}
                  className="absolute top-1 right-1.5 w-4 h-4 flex items-center justify-center rounded text-[10px] text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-white/10 transition-colors"
                  aria-label="dismiss"
                >
                  ×
                </button>
                {toast.label && (
                  <div className="pr-4 text-[9px] text-[var(--text-secondary)]/70 truncate mb-0.5">
                    {toast.label}
                  </div>
                )}
                {/* Markdown-rendered body (agent output is markdown). Compact
                    variant: the bubble is ~290px wide, so code blocks and
                    lists must stay small; window height follows the rendered
                    height. */}
                <div className="companion-markdown markdown-body min-h-0 flex-1 overflow-y-auto text-[12px] text-[var(--text-primary)]">
                  <ReactMarkdown remarkPlugins={[remarkGfm]} rehypePlugins={[rehypeRaw]}>
                    {toast.main}
                  </ReactMarkdown>
                </div>
              </div>
            </div>
          )}
          <div
            ref={spriteZoneRef}
            className="w-[120px] h-[140px] shrink-0 flex items-center justify-center"
          >
            <PetSprite
              state={petState}
              badge={badge}
              runningCount={runningCount}
              onClick={() => setExpanded(true)}
              onContextMenu={(e) => {
                // Stop the event before it reaches the root div's handler —
                // both toggle menuOpen, and a double toggle cancels itself
                // (the menu could never open).
                e.preventDefault();
                e.stopPropagation();
                setMenuOpen((v) => !v);
              }}
            />
          </div>
        </div>
      )}

      {/* Collapsed context menu (closed by pointerdown-outside / focus-poll
          / Escape — see the effects above; no backdrop div needed). */}
      {menuOpen && !expanded && (
        <div
          ref={menuRef}
          className="absolute z-20 top-2 left-2 w-44 rounded-2xl border border-[var(--border)] bg-[var(--bg-primary)]/95 backdrop-blur-xl shadow-[0_12px_32px_rgba(0,0,0,0.4)] p-1.5 text-xs text-[var(--text-primary)]"
        >
            {/* Icon column keeps every row aligned; monochrome line icons
                match the main window (no mixed emoji). */}
            <button
              className="w-full flex items-center gap-2 px-2 py-1.5 rounded-lg hover:bg-[var(--bg-secondary)] text-left"
              onClick={() => {
                setMenuOpen(false);
                void captureScreen();
              }}
            >
              <MenuIcon d="M3 5.5A1.5 1.5 0 0 1 4.5 4h9A1.5 1.5 0 0 1 15 5.5v7a1.5 1.5 0 0 1-1.5 1.5h-9A1.5 1.5 0 0 1 3 12.5v-7Zm3.2 1.2v4.6l4-2.3-4-2.3ZM6 1.8h6v1.4H6V1.8Z" />
              <span className="truncate">{t("companion.menu.captureScreen")}</span>
            </button>
            <button
              className="w-full flex items-center gap-2 px-2 py-1.5 rounded-lg hover:bg-[var(--bg-secondary)] text-left"
              onClick={() => {
                setMenuOpen(false);
                void readClipboard();
              }}
            >
              <MenuIcon d="M5 2h8a1 1 0 0 1 1 1v11a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V3a1 1 0 0 1 1-1Zm1.5 3h5v1h-5V5Zm0 2.5h5v1h-5v-1Zm0 2.5h3.5v1H6.5v-1Z" />
              <span className="truncate">{t("companion.menu.readClipboard")}</span>
            </button>
            <button
              className="w-full flex items-center gap-2 px-2 py-1.5 rounded-lg hover:bg-[var(--bg-secondary)] text-left"
              onClick={() => {
                setMenuOpen(false);
                enableDnd();
              }}
            >
              <MenuIcon d="M8.5 2.5v1.55a4.5 4.5 0 0 0 0 8.9V14.5a6 6 0 0 1 0-12Zm1 0a6 6 0 0 1 0 12v-1.55a4.5 4.5 0 0 0 0-8.9V2.5ZM8 6l2.5 3.5H8.9L8 8.2l-.9 1.3H5.5L8 6Z" />
              <span className="truncate">{t("companion.menu.dnd1h")}</span>
            </button>
            {/* Window controls below. */}
            <div className="my-1 mx-1 h-px bg-[var(--border)]/70" />
            <button
              className="w-full flex items-center gap-2 px-2 py-1.5 rounded-lg hover:bg-[var(--bg-secondary)] text-left"
              onClick={() => {
                setMenuOpen(false);
                void invoke("focus_conversation", { conversationId: "" }).catch(() => {});
              }}
            >
              <MenuIcon d="M3.5 3.5h9v6h-1.5V5H5v7h4.5v1.5h-6v-10Zm6 6h4v5h-5v-4h1v-1Z" />
              <span className="truncate">{t("companion.menu.openMain")}</span>
            </button>
            <button
              className="w-full flex items-center gap-2 px-2 py-1.5 rounded-lg hover:bg-[var(--bg-secondary)] text-left"
              onClick={() => {
                setMenuOpen(false);
                void win.hide();
              }}
            >
              <MenuIcon d="M4.9 11.1 11.1 4.9M8 2.8a5.2 5.2 0 1 0 0 10.4A5.2 5.2 0 0 0 8 2.8Z" stroke />
              <span className="truncate">{t("companion.menu.hide")}</span>
            </button>
        </div>
      )}
    </div>
  );
}
