import { useCallback, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import rehypeRaw from "rehype-raw";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
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
  PetState,
} from "./types";

/// Toast bubble width (logical px); height is measured from content so long
/// agent output is fully visible instead of clipping.
const TOAST_WIDTH = 420;
const TOAST_MIN_HEIGHT = 140;
const TOAST_MAX_HEIGHT = 640;
const EXPANDED_SIZE = new LogicalSize(400, 560);

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
  // Fullscreen etiquette: when the window shares a Space with a fullscreen
  // app, shrink the sprite to a small dim dot so it never competes for
  // attention with focused full-screen work. Heuristic, refreshed on focus
  // changes + a slow poll (window focus toggles as the user swaps Spaces).
  const [dimmed, setDimmed] = useState(false);
  const askBufferRef = useRef("");
  const prefsRef = useRef<CompanionPrefs | null>(null);
  const expandedRef = useRef(false);

  useEffect(() => {
    expandedRef.current = expanded;
  }, [expanded]);

  useEffect(() => {
    let cancelled = false;
    const evaluate = async () => {
      if (cancelled) return;
      try {
        // Our own focus ⇒ the user is interacting with the pet or its Space
        // is not a fullscreen app's Space. When another window has focus we
        // can't tell fullscreen-ness directly from JS, so we approximate:
        // dim only while we are NOT focused AND an expanded card is closed.
        const focused = await win.isFocused();
        if (!cancelled) setDimmed(!focused);
      } catch {
        /* best-effort */
      }
    };
    const unFocus = win.onFocusChanged(({ payload }) => {
      // Focused = full presence; unfocused = quiet presence (dim), unless
      // the card is open (user is actively reading the pet).
      setDimmed(!payload && !expandedRef.current);
    });
    void evaluate();
    const poll = setInterval(evaluate, 10_000);
    return () => {
      cancelled = true;
      clearInterval(poll);
      void unFocus.then((f) => f());
    };
  }, []);

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
        setStreamedAnswer(askBufferRef.current);
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
  useEffect(() => {
    void (async () => {
      const factor = await win.scaleFactor().catch(() => 1);
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
      } else if (toast && !toastClosed) {
        // Bubble height from the rendered content (measured after paint).
        await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
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

      restoringRef.current = true; // suppress anchor updates from our own move
      await win.setPosition(new PhysicalPosition(x, y)).catch(() => {});
      await win.setSize(new PhysicalSize(w, h)).catch(() => {});
      // Hold the suppression through a grace window: macOS can deliver the
      // Moved event for the resize slightly AFTER setSize resolves.
      setTimeout(() => {
        restoringRef.current = false;
      }, 350);
    })();
  }, [expanded, toast, toastClosed]);

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
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setExpanded(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
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

  const ask = useCallback((q: string) => {
    askBufferRef.current = "";
    setStreamedAnswer("");
    setIsAsking(true);
    void invoke("companion_ask", { question: q }).catch(() => setIsAsking(false));
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
        if (!expanded) {
          e.preventDefault();
          setMenuOpen((v) => !v);
        }
      }}
    >
      {expanded ? (
        <CompanionCard
          activities={activities}
          history={history}
          brainAvailable={brainAvailable}
          isAsking={isAsking}
          streamedAnswer={streamedAnswer}
          dndActive={
            prefs?.dnd_until ? new Date(prefs.dnd_until) > new Date() : false
          }
          onCollapse={() => setExpanded(false)}
          onDnd={enableDnd}
          onResetChat={resetChat}
          onAsk={ask}
        />
      ) : (
        // The sprite occupies a FIXED 140×140 zone at the window's top-right
        // (vertically CENTERED in that zone — matching the anchor math, where
        // the sprite's visual center is window-top + SPRITE_H/2). A toast to
        // its left never affects it; a taller window grows downward only.
        <div className="w-full h-full flex justify-end gap-2">
          {toast && !toastClosed && (
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
          <div className="w-[120px] h-[140px] shrink-0 flex items-center justify-center">
            <PetSprite
              state={petState}
              badge={badge}
              dimmed={dimmed}
              onClick={() => setExpanded(true)}
              onContextMenu={() => setMenuOpen((v) => !v)}
            />
          </div>
        </div>
      )}

      {/* Collapsed context menu */}
      {menuOpen && !expanded && (
        <>
          <div className="fixed inset-0 z-10" onClick={() => setMenuOpen(false)} />
          <div className="absolute z-20 top-2 left-2 w-44 rounded-2xl border border-[var(--border)] bg-[var(--bg-primary)]/95 backdrop-blur-xl shadow-[0_12px_32px_rgba(0,0,0,0.4)] py-1.5 text-xs text-[var(--text-primary)]">
            <button
              className="w-full text-left px-3 py-1.5 hover:bg-[var(--bg-secondary)]"
              onClick={() => {
                setMenuOpen(false);
                enableDnd();
              }}
            >
              {t("companion.menu.dnd1h")}
            </button>
            <button
              className="w-full text-left px-3 py-1.5 hover:bg-[var(--bg-secondary)]"
              onClick={() => {
                setMenuOpen(false);
                void invoke("focus_conversation", { conversationId: "" }).catch(() => {});
              }}
            >
              {t("companion.menu.openMain")}
            </button>
            <button
              className="w-full text-left px-3 py-1.5 hover:bg-[var(--bg-secondary)]"
              onClick={() => {
                setMenuOpen(false);
                void win.hide();
              }}
            >
              {t("companion.menu.hide")}
            </button>
          </div>
        </>
      )}
    </div>
  );
}
