import { useCallback, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import {
  getCurrentWindow,
  LogicalSize,
  PhysicalPosition,
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

const COLLAPSED_SIZE = new LogicalSize(96, 120);
/// Collapsed + toast bubble: wider so the text fits to the LEFT of the sprite.
const TOAST_SIZE = new LogicalSize(340, 120);
const EXPANDED_SIZE = new LogicalSize(400, 560);

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
  kind: string; // "done" | "info"
  title: string;
  body: string;
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
  const askBufferRef = useRef("");
  const prefsRef = useRef<CompanionPrefs | null>(null);
  const toastTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Ambient bubble: every notification the pet fires also pops a text bubble
  // beside the sprite for a few seconds — visible even with the chat window
  // closed and the OS notification center cleared.
  useEffect(() => {
    const un = listen<CompanionToast>("companion-toast", (e) => {
      setToast(e.payload);
      if (toastTimerRef.current) clearTimeout(toastTimerRef.current);
      toastTimerRef.current = setTimeout(() => setToast(null), 6_000);
    });
    return () => {
      if (toastTimerRef.current) clearTimeout(toastTimerRef.current);
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
        // The final text was appended to history on the Rust side; refresh it.
        void invoke<CompanionSnapshot>("get_companion_state")
          .then((snap) => {
            setHistory(snap.history);
            setBrainAvailable(snap.brain_available);
          })
          .catch(() => {});
      } else if (event_type === "error") {
        setStreamedAnswer("");
        setIsAsking(false);
      }
    });
    return () => {
      void un.then((f) => f());
    };
  }, []);

  // Window size follows expand/collapse/toast. The toast widens the window to
  // the LEFT of the sprite — the sprite stays anchored at its right edge so
  // the pet never appears to jump. Before expanding, slide the window so the
  // larger size still fits its monitor (a card stuck off-screen can't be
  // dragged back, since its header is the only drag region).
  useEffect(() => {
    void (async () => {
      const target = expanded ? EXPANDED_SIZE : toast ? TOAST_SIZE : COLLAPSED_SIZE;
      if (expanded) {
        try {
          const [pos, factor, monitor] = await Promise.all([
            win.outerPosition(),
            win.scaleFactor(),
            currentMonitor(),
          ]);
          if (monitor) {
            // All Tauri geometry here is physical px; compare in one space.
            const w = EXPANDED_SIZE.width * factor;
            const h = EXPANDED_SIZE.height * factor;
            const maxX = monitor.position.x + monitor.size.width - w - 8 * factor;
            const maxY = monitor.position.y + monitor.size.height - h - 8 * factor;
            const x = Math.min(pos.x, Math.max(monitor.position.x, maxX));
            const y = Math.min(pos.y, Math.max(monitor.position.y, maxY));
            if (x !== pos.x || y !== pos.y) {
              await win.setPosition(new PhysicalPosition(x, y));
            }
          }
        } catch {
          // best-effort — fall through to the plain resize
        }
      } else if (toast) {
        // Widen leftward: keep the sprite's right edge where it was.
        try {
          const [pos, size, factor] = await Promise.all([
            win.outerPosition(),
            win.outerSize(),
            win.scaleFactor(),
          ]);
          const grow = (TOAST_SIZE.width - COLLAPSED_SIZE.width) * factor;
          await win.setPosition(new PhysicalPosition(pos.x - grow, pos.y));
          await win.setSize(TOAST_SIZE);
          void size;
          void factor;
        } catch {
          await win.setSize(TOAST_SIZE).catch(() => {});
        }
      }
      await win.setSize(target).catch(() => {});
    })();
  }, [expanded, toast]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setExpanded(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  // Persist drag position (debounced). `outerPosition` returns PHYSICAL
  // pixels; convert to logical so the saved value restores correctly
  // regardless of the display's scale factor.
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | null = null;
    const un = win.onMoved(() => {
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
    const until = new Date(Date.now() + 60 * 60_000).toISOString();
    const next = { ...p, dnd_until: until };
    setPrefs(next);
    void invoke("set_companion_prefs", { prefs: next }).catch(() => {});
  }, []);

  const resetChat = useCallback(() => {
    void invoke("reset_companion_chat")
      .then(() => setHistory([]))
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
          onCollapse={() => setExpanded(false)}
          onDnd={enableDnd}
          onResetChat={resetChat}
          onAsk={ask}
        />
      ) : (
        <div className="w-full h-full flex items-center justify-end gap-2">
          {/* Toast bubble: appears to the LEFT of the sprite when a
              notification fires; the window widens to make room. */}
          {toast && (
            <div
              className={`max-w-[236px] rounded-2xl border px-3 py-2 shadow-[0_8px_24px_rgba(0,0,0,0.35)] backdrop-blur-xl animate-[pet-toast-in_0.25s_ease-out] ${
                toast.kind === "done"
                  ? "bg-green-500/15 border-green-500/30"
                  : "bg-[var(--bg-primary)]/90 border-[var(--border)]"
              }`}
            >
              <div className="text-[10px] font-semibold text-[var(--text-secondary)] truncate">
                {toast.title}
              </div>
              <div className="text-[11px] text-[var(--text-primary)] leading-snug line-clamp-3">
                {toast.body}
              </div>
            </div>
          )}
          <PetSprite
            state={petState}
            badge={badge}
            onClick={() => setExpanded(true)}
            onContextMenu={() => setMenuOpen((v) => !v)}
          />
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
