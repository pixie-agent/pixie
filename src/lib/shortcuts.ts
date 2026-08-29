// Customizable keyboard shortcuts.
//
// A shortcut is stored as a canonical combo string, e.g. "Mod+K", "Mod+Shift+F",
// "Escape", "Mod+=" — where `Mod` means Cmd on macOS and Ctrl elsewhere (and,
// matching the previous hardcoded handlers, EITHER modifier triggers the
// shortcut on any platform). The string lives in config.json under
// `keyboard_shortcuts` (action id → combo), persisted via lib/storage.ts and
// round-tripped opaquely through the Rust AppConfig.
//
// Matching notes:
//  - "Mod" (or CmdOrCtrl) matches EITHER Ctrl or Cmd on any platform — the
//    cross-platform default (Mac: Cmd, Windows/Linux: Ctrl).
//  - "Ctrl" and "Cmd" are STRICT: a combo stored as "Ctrl+F" only fires on
//    Ctrl+F (Cmd+F does NOT match), and vice versa.
//  - "=" and "+" are aliases (Shift+= produces "+" on most layouts).
//  - An unspecified Shift in the stored combo is allowed to be pressed (so both
//    Ctrl+= and Ctrl+Shift+= (=Ctrl++) zoom in), but a stored Shift is required.

import type { TFunction } from "i18next";
import { isMacPlatform } from "./i18nFormat";

export type ShortcutAction =
  | "newChat"
  | "toggleSidebar"
  | "toggleSearch"
  | "toggleSettings"
  | "findInPage"
  | "stopGeneration"
  | "zoomIn"
  | "zoomOut"
  | "resetZoom";

/** Display order for the Settings shortcut editor. */
export const SHORTCUT_ACTIONS: ShortcutAction[] = [
  "newChat",
  "toggleSidebar",
  "toggleSearch",
  "findInPage",
  "toggleSettings",
  "stopGeneration",
  "zoomIn",
  "zoomOut",
  "resetZoom",
];

export type ShortcutsConfig = Record<ShortcutAction, string>;

/** Platform-aware default combos: ⌘ on macOS, Ctrl elsewhere. Evaluated once
 *  at module load, so every fallback site (storage, normalizeShortcuts, the
 *  Settings editor) hands out the same platform-appropriate set. */
function platformDefaultShortcuts(): ShortcutsConfig {
  const mod = isMacPlatform() ? "Cmd" : "Ctrl";
  return {
    newChat: `${mod}+N`,
    toggleSidebar: `${mod}+B`,
    toggleSearch: `${mod}+K`,
    findInPage: `${mod}+F`,
    toggleSettings: `${mod}+,`,
    stopGeneration: "Escape",
    zoomIn: `${mod}+=`,
    zoomOut: `${mod}+-`,
    resetZoom: `${mod}+0`,
  };
}

export const DEFAULT_SHORTCUTS: ShortcutsConfig = platformDefaultShortcuts();

export function isShortcutAction(v: unknown): v is ShortcutAction {
  return typeof v === "string" && (SHORTCUT_ACTIONS as string[]).includes(v);
}

export interface ParsedShortcut {
  /** "Mod": matches either Ctrl or Cmd (cross-platform default). */
  mod: boolean;
  /** Strict Ctrl: only e.ctrlKey fires (Cmd+F will NOT match Ctrl+F). */
  ctrl: boolean;
  /** Strict Cmd (⌘ / Meta): only e.metaKey fires. */
  cmd: boolean;
  shift: boolean;
  alt: boolean;
  /** Normalized main key: single char uppercased, or a named key ("Escape", "F2", …). */
  key: string;
}

/** Normalize a keyboard event's `key` into the canonical main-key form. */
function normalizeKey(raw: string): string | null {
  if (!raw) return null;
  if (raw.length === 1) return raw.toUpperCase();
  switch (raw) {
    case "Escape":
    case "Esc":
      return "Escape";
    case "ArrowUp":
      return "Up";
    case "ArrowDown":
      return "Down";
    case "ArrowLeft":
      return "Left";
    case "ArrowRight":
      return "Right";
    default:
      // Function keys F1–F12.
      return /^F([1-9]|1[0-2])$/.test(raw) ? raw : null;
  }
}

/** Parse a stored combo string into its parts, or null when invalid. */
export function parseShortcut(shortcut: string): ParsedShortcut | null {
  if (!shortcut || typeof shortcut !== "string") return null;
  const parts = shortcut.split("+").map((p) => p.trim()).filter(Boolean);
  let mod = false;
  let ctrl = false;
  let cmd = false;
  let shift = false;
  let alt = false;
  let key: string | null = null;
  for (const part of parts) {
    const p = part.toLowerCase();
    if (p === "mod" || p === "cmdorctrl") {
      mod = true;
      continue;
    }
    if (p === "ctrl" || p === "control") {
      ctrl = true;
      continue;
    }
    if (p === "cmd" || p === "meta" || p === "command") {
      cmd = true;
      continue;
    }
    if (p === "shift") {
      shift = true;
      continue;
    }
    if (p === "alt" || p === "option") {
      alt = true;
      continue;
    }
    if (key !== null) return null; // two main keys → invalid
    key = normalizeKey(part);
    if (!key) return null;
  }
  if (!key) return null;
  return { mod, ctrl, cmd, shift, alt, key };
}

/** True while the event is only a modifier press (used to ignore half-pressed combos). */
export function isBareModifierKey(key: string): boolean {
  return key === "Shift" || key === "Control" || key === "Meta" || key === "Alt" || key === "CapsLock";
}

/** "=" and "+" are the same physical key on most layouts — treat them as aliases. */
function keysAliasMatch(a: string, b: string): boolean {
  if (a === b) return true;
  const fold = (k: string) => (k === "=" || k === "+" ? "=" : k);
  return fold(a) === fold(b);
}

/** Does a live KeyboardEvent match the stored combo? */
export function shortcutMatches(shortcut: string, e: KeyboardEvent): boolean {
  const parsed = parseShortcut(shortcut);
  if (!parsed) return false;
  if (isBareModifierKey(e.key)) return false;
  const eventKey = normalizeKey(e.key);
  if (!eventKey) return false;
  if (!keysAliasMatch(parsed.key, eventKey)) return false;
  // Modifier matching — "Mod" fires on either Ctrl or Cmd; strict "Ctrl" /
  // "Cmd" require (and are exclusive of) their exact modifier, so Ctrl+F and
  // Cmd+F are genuinely distinct shortcuts.
  if (parsed.mod) {
    if (!e.ctrlKey && !e.metaKey) return false;
  } else {
    if (parsed.ctrl !== e.ctrlKey) return false;
    if (parsed.cmd !== e.metaKey) return false;
  }
  if (parsed.alt !== e.altKey) return false;
  // Stored Shift must be pressed; an *unstored* Shift is tolerated (so "+"
  // reachable via Shift+= still matches a stored "=").
  if (parsed.shift && !e.shiftKey) return false;
  return true;
}

/** Convert a keyboard event into a canonical combo string for recording, or
 *  null when the combo is not usable as a global shortcut (bare letters would
 *  fire while typing; dead/IME keys are meaningless). */
export function eventToShortcut(e: KeyboardEvent): string | null {
  if (isBareModifierKey(e.key)) return null;
  const key = normalizeKey(e.key);
  if (!key) return null;
  const mod = e.ctrlKey || e.metaKey;
  // Standalone keys allowed without a modifier: Escape and F1–F12.
  const standaloneOk = key === "Escape" || /^F([1-9]|1[0-2])$/.test(key);
  if (!mod && !standaloneOk) return null;
  const parts: string[] = [];
  // Record the ACTUAL modifiers so strict Ctrl vs Cmd combos are preserved
  // ("Ctrl+F" and "Cmd+F" stay distinct in storage and matching).
  if (e.ctrlKey) parts.push("Ctrl");
  if (e.metaKey) parts.push("Cmd");
  if (e.shiftKey) parts.push("Shift");
  if (e.altKey) parts.push("Alt");
  parts.push(key);
  return parts.join("+");
}

/** Canonical comparison key — two combos conflict when these are equal. */
export function canonicalShortcut(shortcut: string): string | null {
  const p = parseShortcut(shortcut);
  if (!p) return null;
  // Fold "+" onto "=" so "Mod++" and "Mod+=" are the same shortcut.
  const key = p.key === "+" ? "=" : p.key;
  const modPart = p.mod ? "M" : p.ctrl ? "C" : p.cmd ? "D" : "-";
  return `${modPart}${p.shift ? "S" : "-"}${p.alt ? "A" : "-"}+${key}`;
}

/** Localized, platform-aware display label, e.g. "⌘K" style "Cmd+K" / "Ctrl+K". */
export function formatShortcut(shortcut: string, t: TFunction): string {
  const parsed = parseShortcut(shortcut);
  if (!parsed) return shortcut;
  const parts: string[] = [];
  if (parsed.mod) parts.push(t(isMacPlatform() ? "keys.cmd" : "keys.ctrl"));
  if (parsed.ctrl) parts.push(t("keys.ctrl"));
  if (parsed.cmd) parts.push(t("keys.cmd"));
  if (parsed.shift) parts.push(t("keys.shift"));
  if (parsed.alt) parts.push(t("keys.alt"));
  parts.push(parsed.key === "Escape" ? t("keys.escape") : parsed.key);
  return parts.join("+");
}

/** Coerce an unknown persisted blob (config.json `keyboard_shortcuts`) into a
 *  complete, valid config: unknown actions and unparsable combos fall back to
 *  their defaults so a hand-edited file can never brick the shortcuts.
 *
 *  Legacy migration: combos stored as "Mod+…" come from the old defaults
 *  (Ctrl and Cmd BOTH fired). The recorder can no longer produce "Mod", so
 *  any occurrence is a stale default — rewritten to the platform-specific
 *  strict modifier (⌘ on macOS, Ctrl elsewhere) so exactly one fires. */
export function normalizeShortcuts(raw: unknown): ShortcutsConfig {
  const out: ShortcutsConfig = { ...DEFAULT_SHORTCUTS };
  if (raw && typeof raw === "object" && !Array.isArray(raw)) {
    for (const [action, value] of Object.entries(raw as Record<string, unknown>)) {
      if (!isShortcutAction(action)) continue;
      if (typeof value !== "string") continue;
      const parsed = parseShortcut(value);
      if (!parsed) continue;
      out[action] = migrateLegacyMod(value, parsed);
    }
  }
  return out;
}

/** "Mod+K" → "Cmd+K" on macOS / "Ctrl+K" elsewhere. Strict Ctrl/Cmd combos
 *  (and "Mod" mixed with a strict modifier) are returned unchanged. */
function migrateLegacyMod(value: string, parsed: ParsedShortcut): string {
  if (!parsed.mod || parsed.ctrl || parsed.cmd) return value;
  const prefix = isMacPlatform() ? "Cmd+" : "Ctrl+";
  return value.replace(/^\s*Mod\s*\+\s*/i, prefix);
}
