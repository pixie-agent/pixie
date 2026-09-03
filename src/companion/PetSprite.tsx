import { useRef } from "react";
import { useTranslation } from "react-i18next";
import { getCurrentWindow } from "@tauri-apps/api/window";
import type { PetState } from "./types";

/** Pointer travel beyond this (px) means the press was a drag, not a click —
 *  hand the press to the native window drag and suppress the click that
 *  follows, so dragging never expands the card. */
const DRAG_THRESHOLD_PX = 6;

// One shared svg body; two fills per element via stacked copies.
const SpriteSvg = ({
  idPrefix,
  fillCore,
  fillWingR,
  fillWingL,
  strokeColor,
  strokeWidth,
  strokeOpacity,
  flapDuration,
  glowFilter,
}: {
  idPrefix: string;
  fillCore: string;
  fillWingR: string;
  fillWingL: string;
  strokeColor: string;
  strokeWidth: number;
  strokeOpacity: number;
  flapDuration: string;
  glowFilter?: string;
}) => (
  <svg
    viewBox="0 0 512 512"
    className="absolute inset-0 w-full h-full"
    style={glowFilter ? { filter: glowFilter } : undefined}
  >
    <defs>
      {/* Glow filters: feDropShadow on the GROUP follows only the sprite's
          own shapes — light hugs the silhouette; no backdrop rectangles. */}
      <filter id="pet-glow-purple" x="-60%" y="-60%" width="220%" height="220%">
        <feDropShadow dx="0" dy="0" stdDeviation="14" floodColor="#8b80ff" floodOpacity="0.55" />
      </filter>
      <filter id="pet-glow-white" x="-60%" y="-60%" width="220%" height="220%">
        <feDropShadow dx="0" dy="0" stdDeviation="16" floodColor="#ffffff" floodOpacity="0.9" />
        <feDropShadow dx="0" dy="0" stdDeviation="34" floodColor="#e6e1ff" floodOpacity="0.45" />
      </filter>
      <linearGradient id={`${idPrefix}-wingR`} x1="300" y1="282" x2="470" y2="92" gradientUnits="userSpaceOnUse">
        <stop offset="0%" stopColor="#c8bdff" />
        <stop offset="50%" stopColor="#7d72ff" />
        <stop offset="100%" stopColor="#6c63ff" stopOpacity="0.1" />
      </linearGradient>
      <linearGradient id={`${idPrefix}-wingL`} x1="212" y1="282" x2="42" y2="92" gradientUnits="userSpaceOnUse">
        <stop offset="0%" stopColor="#c8bdff" />
        <stop offset="50%" stopColor="#7d72ff" />
        <stop offset="100%" stopColor="#6c63ff" stopOpacity="0.1" />
      </linearGradient>
      <linearGradient id={`${idPrefix}-wingWhiteR`} x1="300" y1="282" x2="470" y2="92" gradientUnits="userSpaceOnUse">
        <stop offset="0%" stopColor="#ffffff" stopOpacity="1" />
        <stop offset="60%" stopColor="#ffffff" stopOpacity="0.95" />
        <stop offset="100%" stopColor="#ffffff" stopOpacity="0.35" />
      </linearGradient>
      <linearGradient id={`${idPrefix}-wingWhiteL`} x1="212" y1="282" x2="42" y2="92" gradientUnits="userSpaceOnUse">
        <stop offset="0%" stopColor="#ffffff" stopOpacity="1" />
        <stop offset="60%" stopColor="#ffffff" stopOpacity="0.95" />
        <stop offset="100%" stopColor="#ffffff" stopOpacity="0.35" />
      </linearGradient>
      <radialGradient id={`${idPrefix}-core`} cx="46%" cy="38%" r="62%">
        <stop offset="0%" stopColor="#ffffff" />
        <stop offset="32%" stopColor="#e7e1ff" />
        <stop offset="72%" stopColor="#8b80ff" />
        <stop offset="100%" stopColor="#5a52d5" />
      </radialGradient>
      <radialGradient id={`${idPrefix}-coreAlert`} cx="46%" cy="38%" r="62%">
        <stop offset="0%" stopColor="#ffffff" />
        <stop offset="32%" stopColor="#fef3c7" />
        <stop offset="72%" stopColor="#fbbf24" />
        <stop offset="100%" stopColor="#b45309" />
      </radialGradient>
      <radialGradient id={`${idPrefix}-coreWhite`} cx="46%" cy="38%" r="62%">
        <stop offset="0%" stopColor="#ffffff" />
        <stop offset="55%" stopColor="#ffffff" />
        <stop offset="100%" stopColor="#f2f0ff" />
      </radialGradient>
    </defs>

    {/* Wings flap around their body-side roots (L ≈ (200,258), R ≈ (312,258)). */}
    <g
      className="origin-[312px_258px] animate-[pet-flap-r_var(--flap-duration)_ease-in-out_infinite]"
      style={{ ["--flap-duration" as string]: flapDuration }}
    >
      <path d="M322 244C380 168 440 128 468 92C444 176 388 248 318 272Z" fill={fillWingR} />
    </g>
    <g
      className="origin-[200px_258px] animate-[pet-flap-l_var(--flap-duration)_ease-in-out_infinite]"
      style={{ ["--flap-duration" as string]: flapDuration }}
    >
      <path d="M190 244C132 168 72 128 44 92C68 176 124 248 194 272Z" fill={fillWingL} />
    </g>

    {/* Body orb — no face, abstract like the logo. */}
    <circle cx="256" cy="256" r="66" fill={fillCore} />
    <circle
      cx="256"
      cy="256"
      r="66"
      fill="none"
      stroke={strokeColor}
      strokeWidth={strokeWidth}
      opacity={strokeOpacity}
    />
    <ellipse cx="238" cy="232" rx="18" ry="11" fill="#ffffff" opacity="0.75" />
  </svg>
);


/**
 * The collapsed pet: the logo's glowing sprite — gradient wings that FLAP,
 * a light-orb body that gently hovers — floating directly on the desktop
 * (fully transparent background; no panel, no container).
 *
 * The RUNNING (watching) state cross-fades the ENTIRE sprite into a
 * blinding-white variant: the purple sprite and the white sprite are stacked
 * and CSS-transitioned, so starting a session melts purple→white (~1s) and
 * finishing melts it back. The white layer also carries a slow radiant pulse
 * (glow "breathing") so it reads as EMITTING light, not just being white.
 */
export function PetSprite({
  state,
  badge,
  runningCount,
  onClick,
  onContextMenu,
}: {
  state: PetState;
  badge: number;
  /** How many sessions are currently running — drives the flap cadence. */
  runningCount: number;
  onClick: () => void;
  onContextMenu: (e: React.MouseEvent) => void;
}) {
  const { t } = useTranslation();
  // Manual drag arbitration. `data-tauri-drag-region` hands the press to the
  // native drag loop on MOUSEDOWN — the webview then receives no pointermove
  // during the drag, so travel-based "was this a drag?" detection could never
  // fire and mouseup synthesized a click that expanded the card mid-drag.
  // Instead: track movement ourselves, and only past the threshold call
  // startDragging() to hand the press to the native loop. The flag then
  // reliably suppresses the trailing click.
  const downPosRef = useRef<{ x: number; y: number } | null>(null);
  const draggedRef = useRef(false);

  // Flap cadence carries the state: lazy → brisk → urgent. While WATCHING,
  // cadence scales with HOW MANY sessions run concurrently — more parallel
  // work, faster wings. Session counts are small, so each one takes a big
  // visible step; floor at 0.18s where more sessions stop being readable
  // and start being noise.
  const flapDuration =
    state === "alert"
      ? "0.35s"
      : state === "watching"
        ? `${Math.max(0.18, 0.5 - 0.1 * (runningCount - 1)).toFixed(2)}s`
        : "1.4s";
  const running = state === "watching";
  // White layer opacity drives the cross-fade (CSS transition does the ramp).
  const whiteOpacity = running ? 1 : 0;

  return (
    <div className="w-full h-full flex items-start justify-center select-none">
      <button
        className="relative w-28 h-28 cursor-pointer"
        onPointerDown={(e) => {
          // Only the primary button starts drag arbitration; secondary is
          // context-menu territory (handled by onContextMenu).
          if (e.button !== 0) return;
          downPosRef.current = { x: e.clientX, y: e.clientY };
          draggedRef.current = false;
        }}
        onPointerMove={(e) => {
          const down = downPosRef.current;
          if (!down || draggedRef.current) return;
          const dx = e.clientX - down.x;
          const dy = e.clientY - down.y;
          if (Math.hypot(dx, dy) > DRAG_THRESHOLD_PX) {
            draggedRef.current = true;
            // Hand the press to the native window-drag loop. Must run while
            // the button is held; failures ignored — the click suppression
            // below still prevents a spurious expand either way.
            void getCurrentWindow().startDragging().catch(() => {});
          }
        }}
        onPointerUp={() => {
          downPosRef.current = null;
        }}
        onPointerLeave={() => {
          // Pointer left without dragging — forget the press so a later move
          // (e.g. re-entry) can't resurrect it.
          if (!draggedRef.current) downPosRef.current = null;
        }}
        onClick={(e) => {
          if (draggedRef.current) {
            e.preventDefault();
            e.stopPropagation();
            draggedRef.current = false; // reset for the next press
            return; // this press was a drag — not a click
          }
          onClick();
        }}
        onContextMenu={onContextMenu}
        title={t(`companion.tooltip.${state}`)}
        aria-label={t("companion.title")}
      >
        {/* Decorative layers are pointer-transparent so mousedown always lands
            on the drag-region button itself (Tauri checks the attribute on the
            event target, not its ancestors). */}
        <span className="pointer-events-none absolute inset-0 flex items-center justify-center animate-[pet-hover_3s_ease-in-out_infinite]">
          <span className="relative w-24 h-24">
            {/* Base (purple) sprite — always present, fades under the white one.
                Glow lives on the SVG itself (per-shape filter), never on a
                container: no rectangles, only the sprite's own silhouette. */}
            <span className="absolute inset-0 transition-opacity duration-[2500ms] ease-in-out">
              <SpriteSvg
                idPrefix="pet-base"
                fillCore={state === "alert" ? "url(#pet-base-coreAlert)" : "url(#pet-base-core)"}
                fillWingR="url(#pet-base-wingR)"
                fillWingL="url(#pet-base-wingL)"
                strokeColor="#6c63ff"
                strokeWidth={3}
                strokeOpacity={0.4}
                flapDuration={flapDuration}
                glowFilter="url(#pet-glow-purple)"
              />
            </span>

            {/* RUNNING overlay: the all-white sprite. Its glow is an SVG
                filter bound to the sprite's own shapes — light hugs the
                silhouette instead of lighting a backdrop rectangle. */}
            <span
              className="absolute inset-0 transition-opacity duration-[2500ms] ease-in-out animate-[pet-radiance_1.6s_ease-in-out_infinite]"
              style={{ opacity: whiteOpacity }}
            >
              <SpriteSvg
                idPrefix="pet-white"
                fillCore="url(#pet-white-coreWhite)"
                fillWingR="url(#pet-white-wingWhiteR)"
                fillWingL="url(#pet-white-wingWhiteL)"
                strokeColor="#ffffff"
                strokeWidth={5}
                strokeOpacity={0.9}
                flapDuration={flapDuration}
                glowFilter="url(#pet-glow-white)"
              />
            </span>
          </span>
        </span>

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
