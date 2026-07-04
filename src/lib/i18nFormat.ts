import type { TFunction } from "i18next";
import type { ScheduleSpec, AgentEngineId } from "../types";
import { AGENT_ENGINES } from "../types";

const MODEL_FIELD_LABEL_KEYS: Record<string, string> = {
  "API Key": "modelFields.apiKey",
  "Base URL": "modelFields.baseUrl",
  Model: "modelFields.model",
  "Opus Model": "modelFields.opusModel",
  "Sonnet Model": "modelFields.sonnetModel",
  "Haiku Model": "modelFields.haikuModel",
  "Subagent Model": "modelFields.subagentModel",
  "Effort Level": "modelFields.effortLevel",
};

/** True when running on macOS (Cmd vs Ctrl modifier labels). */
export function isMacPlatform(): boolean {
  return typeof navigator !== "undefined" && navigator.platform?.includes("Mac");
}

/** Platform-appropriate modifier key label (Cmd on Mac, Ctrl elsewhere). */
export function modKeyLabel(t: TFunction): string {
  return t(isMacPlatform() ? "keys.cmd" : "keys.ctrl");
}

/** Keyboard shortcut with modifier, e.g. `Cmd+N` / `Ctrl+N`. */
export function formatModShortcut(t: TFunction, key: string): string {
  return `${modKeyLabel(t)}+${key}`;
}

/** Map i18n language code to a BCP 47 tag for `Intl` / `Date` formatting. */
export function appLocale(language: string): string {
  const base = language.split("-")[0];
  if (base === "zh") return "zh-CN";
  if (base === "ja") return "ja-JP";
  return "en-US";
}

export function engineLabel(id: AgentEngineId, t: TFunction): string {
  return t(`engines.${id}`, {
    defaultValue: AGENT_ENGINES.find((e) => e.id === id)?.label ?? id,
  });
}

export function modelFieldLabel(label: string, t: TFunction): string {
  const key = MODEL_FIELD_LABEL_KEYS[label];
  return key ? t(key) : label;
}

export function pad(n: number): string {
  return String(n).padStart(2, "0");
}

export function formatSchedule(s: ScheduleSpec, t: TFunction): string {
  switch (s.type) {
    case "daily_time":
      return t("schedule.dailyAt", { hour: pad(s.hour), minute: pad(s.minute) });
    case "weekdays_time":
      return t("schedule.weekdaysAt", { hour: pad(s.hour), minute: pad(s.minute) });
    case "every_n_minutes":
      return t("schedule.everyNMinutes", { minutes: s.minutes });
    case "every_n_hours":
      return t("schedule.everyNHours", { count: s.hours, hours: s.hours });
  }
}

export function relativeFromIso(iso: string | null, t: TFunction): string {
  if (!iso) return t("common.notAvailable");
  const ts = Date.parse(iso);
  if (Number.isNaN(ts)) return t("common.notAvailable");
  const diff = ts - Date.now();
  const abs = Math.abs(diff);
  const mins = Math.floor(abs / 60000);
  if (mins < 1) return diff >= 0 ? t("time.inMoment") : t("time.justNow");
  if (mins < 60) {
    return diff >= 0
      ? t("time.minutesFromNow", { count: mins })
      : t("time.minutesAgo", { count: mins });
  }
  const hours = Math.floor(mins / 60);
  if (hours < 24) {
    return diff >= 0
      ? t("time.hoursFromNow", { count: hours })
      : t("time.hoursAgo", { count: hours });
  }
  const days = Math.floor(hours / 24);
  return diff >= 0
    ? t("time.daysFromNow", { count: days })
    : t("time.daysAgo", { count: days });
}

export function relativeTime(ts: number, t: TFunction, language?: string): string {
  const diff = Date.now() - ts;
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return t("time.justNow");
  if (mins < 60) return t("time.minutesAgo", { count: mins });
  const hours = Math.floor(mins / 60);
  if (hours < 24) return t("time.hoursAgo", { count: hours });
  const days = Math.floor(hours / 24);
  if (days < 7) return t("time.daysAgo", { count: days });
  const locale = language ? appLocale(language) : undefined;
  return new Date(ts).toLocaleDateString(locale);
}

/** Format an ISO timestamp as a short calendar date in the user's locale. */
export function formatShortDate(iso: string, language: string): string {
  const ts = Date.parse(iso);
  if (Number.isNaN(ts)) return iso.split("T")[0] ?? iso;
  return new Date(ts).toLocaleDateString(appLocale(language));
}

/** Compact token count (e.g. 1.2k / 1.2万) for usage stats. */
export function formatTokenCount(n: number, language: string): string {
  const locale = appLocale(language);
  if (n < 1000) return n.toLocaleString(locale);
  return new Intl.NumberFormat(locale, {
    notation: "compact",
    maximumFractionDigits: n >= 10000 ? 0 : 1,
  }).format(n);
}

/** Human-readable duration for agent usage stats. */
export function formatDurationMs(ms: number | undefined, t: TFunction): string {
  if (ms == null) return "";
  if (ms < 1000) return t("time.millisecondsShort", { count: ms });
  const s = ms / 1000;
  if (s < 60) {
    const value = s < 10 ? s.toFixed(1) : String(Math.round(s));
    return t("time.secondsDecimal", { value });
  }
  const mins = Math.floor(s / 60);
  const secs = Math.round(s % 60);
  return t("time.minutesSeconds", { minutes: mins, seconds: secs });
}

/** USD cost with locale-aware decimal grouping. */
export function formatCostUsd(usd: number, language: string): string {
  return new Intl.NumberFormat(appLocale(language), {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: usd < 0.01 ? 4 : 2,
    maximumFractionDigits: usd < 0.01 ? 4 : 2,
  }).format(usd);
}
