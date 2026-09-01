import { useRef } from "react";
import { useTranslation } from "react-i18next";
import type { PetState } from "./types";

/** Pointer travel beyond this (px) means the press was a drag, not a click —
 *  suppress the click that follows so dragging never expands the card. */
const DRAG_THRESHOLD_PX = 6;

/**
 * The collapsed pet: the app's logo mark — a glowing orb sprite with two
 * gradient wings (mirrors src/assets/icon.svg) — breathing on the desktop.
 * State is encoded in glow color and pulse speed so status reads peripherally:
 *   idle      dim halo, slow breath
 *   watching  brand-purple glow, steady pulse (something is streaming)
 *   alert     warm amber, fast pulse (permission / failure needs a human)
 */
export function PetSprite({
  state,
  badge,
  onClick,
  onContextMenu,
}: {
  state: PetState;
  badge: number;
  onClick: () => void;
  onContextMenu: (e: React.MouseEvent) => void;
}) {
  const { t } = useTranslation();
  // Suppress the click that follows a drag: Tauri's drag-region takes over on
  // mousedown, but the browser still fires click on mouseup — without this,
  // every drag past a few px would expand the card.
  const downPosRef = useRef<{ x: number; y: number } | null>(null);
  const draggedRef = useRef(false);

  const haloClass =
    state === "alert"
      ? "bg-amber-400/50 animate-[pet-pulse_0.8s_ease-in-out_infinite]"
      : state === "watching"
        ? "bg-[#6c63ff]/50 animate-[pet-pulse_1.6s_ease-in-out_infinite]"
        : "bg-[#6c63ff]/25 animate-[pet-breathe_4s_ease-in-out_infinite]";
  const coreShadow =
    state === "alert"
      ? "shadow-[0_0_18px_4px_rgba(251,191,36,0.5)]"
      : "shadow-[0_0_16px_3px_rgba(124,114,255,0.45)]";

  return (
    <div className="w-full h-full flex items-center justify-center select-none">
      <button
        data-tauri-drag-region
        onPointerDown={(e) => {
          downPosRef.current = { x: e.clientX, y: e.clientY };
          draggedRef.current = false;
        }}
        onPointerMove={(e) => {
          const down = downPosRef.current;
          if (!down) return;
          const dx = e.clientX - down.x;
          const dy = e.clientY - down.y;
          if (Math.hypot(dx, dy) > DRAG_THRESHOLD_PX) {
            draggedRef.current = true;
          }
        }}
        onClick={(e) => {
          if (draggedRef.current) {
            e.preventDefault();
            e.stopPropagation();
            return; // this press was a drag — not a click
          }
          onClick();
        }}
        onContextMenu={onContextMenu}
        title={t(`companion.tooltip.${state}`)}
        className="relative w-20 h-20 cursor-pointer"
        aria-label={t("companion.title")}
      >
        {/* Decorative layers are pointer-transparent so mousedown always lands
            on the drag-region button itself (Tauri checks the attribute on the
            event target, not its ancestors). */}
        {/* Halo behind everything. */}
        <span className={`pointer-events-none absolute -inset-2 rounded-full blur-lg ${haloClass}`} />

        {/* Wings — simplified from the logo's gradient wings. */}
        <span className="pointer-events-none absolute inset-0 flex items-center justify-center">
          <svg viewBox="0 0 512 512" className="w-full h-full drop-shadow-[0_0_6px_rgba(108,99,255,0.4)]">
            <defs>
              <linearGradient id="wingR" x1="300" y1="282" x2="470" y2="92" gradientUnits="userSpaceOnUse">
                <stop offset="0%" stopColor="#c8bdff" />
                <stop offset="50%" stopColor="#7d72ff" />
                <stop offset="100%" stopColor="#6c63ff" stopOpacity="0.12" />
              </linearGradient>
              <linearGradient id="wingL" x1="212" y1="282" x2="42" y2="92" gradientUnits="userSpaceOnUse">
                <stop offset="0%" stopColor="#c8bdff" />
                <stop offset="50%" stopColor="#7d72ff" />
                <stop offset="100%" stopColor="#6c63ff" stopOpacity="0.12" />
              </linearGradient>
              <radialGradient id="coreG" cx="46%" cy="38%" r="62%">
                <stop offset="0%" stopColor="#ffffff" />
                <stop offset="32%" stopColor="#e7e1ff" />
                <stop offset="72%" stopColor="#8b80ff" />
                <stop offset="100%" stopColor="#5a52d5" />
              </radialGradient>
              <radialGradient id="coreAlert" cx="46%" cy="38%" r="62%">
                <stop offset="0%" stopColor="#ffffff" />
                <stop offset="32%" stopColor="#fef3c7" />
                <stop offset="72%" stopColor="#fbbf24" />
                <stop offset="100%" stopColor="#b45309" />
              </radialGradient>
            </defs>
            {/* Right wing. */}
            <path d="M322 244C380 168 440 128 468 92C444 176 388 248 318 272Z" fill="url(#wingR)" />
            {/* Left wing. */}
            <path d="M190 244C132 168 72 128 44 92C68 176 124 248 194 272Z" fill="url(#wingL)" />
            {/* Core orb (alert swaps to warm palette). */}
            {state === "alert" ? (
              <circle cx="256" cy="256" r="66" fill="url(#coreAlert)" />
            ) : (
              <circle cx="256" cy="256" r="66" fill="url(#coreG)" />
            )}
            <circle cx="256" cy="256" r="66" fill="none" stroke="#6c63ff" strokeWidth="3" opacity="0.45" />
            {/* Eye highlight. */}
            <ellipse cx="238" cy="236" rx="20" ry="13" fill="#ffffff" opacity="0.8" />
            {/* Sparkles. */}
            <g fill="#b8acff" opacity="0.75">
              <path d="M478 45l3.1 9.9L511 58l-29.9 3.1L478 71l-3.1-9.9L445 58l29.9-3.1Z" />
              <path d="M34 45l3.1 9.9L67 58l-29.9 3.1L34 71l-3.1-9.9L1 58l29.9-3.1Z" />
              <path d="M258 93l2.4 7.6L268 103l-7.6 2.4L258 113l-2.4-7.6L248 103l7.6-2.4Z" />
            </g>
          </svg>
        </span>

        {/* Core glow tint (state color washes over the orb). */}
        <span
          className={`pointer-events-none absolute inset-[22%] rounded-full mix-blend-overlay ${coreShadow}`}
        />

        {/* Attention badge. */}
        {badge > 0 && (
          <span className="pointer-events-none absolute -top-0.5 -right-0.5 min-w-[18px] h-[18px] px-1 rounded-full bg-red-500 text-white text-[10px] font-bold flex items-center justify-center shadow">
            {badge > 9 ? "9+" : badge}
          </span>
        )}
      </button>
    </div>
  );
}
