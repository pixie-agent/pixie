import { useEffect, useState } from "react";
import { useTranslation } from "../hooks/useTranslation";
import { invoke } from "@tauri-apps/api/core";
import type { CompanionPrefs, CompanionSnapshot } from "../companion/types";

/**
 * Companion pet settings section. Reads/writes the backend's companion.json
 * via commands (NOT storage.ts — the companion window owns this state).
 */
export function CompanionSettings() {
  const { t } = useTranslation();
  const [prefs, setPrefs] = useState<CompanionPrefs | null>(null);

  useEffect(() => {
    void invoke<CompanionSnapshot>("get_companion_state")
      .then((snap) => setPrefs(snap.prefs))
      .catch(() => {});
  }, []);

  if (!prefs) return null;

  const update = (patch: Partial<CompanionPrefs>) => {
    const next = { ...prefs, ...patch };
    setPrefs(next);
    void invoke("set_companion_prefs", { prefs: next }).catch(() => {});
  };

  const dndActive = prefs.dnd_until ? new Date(prefs.dnd_until) > new Date() : false;

  return (
    <section className="space-y-3">
      <h3 className="text-sm font-semibold text-[var(--text-primary)]">
        {t("companion.settings.title")}
      </h3>
      <p className="text-xs text-[var(--text-secondary)]">
        {t("companion.settings.description")}
      </p>

      <label className="flex items-center justify-between gap-4">
        <span className="text-xs text-[var(--text-primary)]">
          {t("companion.settings.enable")}
        </span>
        <input
          type="checkbox"
          checked={prefs.enabled}
          onChange={(e) => update({ enabled: e.target.checked })}
        />
      </label>

      <label className="flex items-center justify-between gap-4">
        <span className="text-xs text-[var(--text-primary)]">
          {t("companion.settings.osNotifications")}
        </span>
        <input
          type="checkbox"
          checked={prefs.os_notifications}
          disabled={!prefs.enabled}
          onChange={(e) => update({ os_notifications: e.target.checked })}
        />
      </label>
      <p className="text-[10px] text-[var(--text-secondary)]">
        {t("companion.settings.osNotificationsHint")}
      </p>

      {(["notify_permission", "notify_error", "notify_completion"] as const).map((key) => (
        <label key={key} className="flex items-center justify-between gap-4">
          <span className="text-xs text-[var(--text-primary)]">
            {t(`companion.settings.${key}`)}
          </span>
          <input
            type="checkbox"
            checked={prefs[key]}
            disabled={!prefs.enabled}
            onChange={(e) => update({ [key]: e.target.checked })}
          />
        </label>
      ))}

      <div className="flex items-center justify-between gap-4">
        <span className="text-xs text-[var(--text-primary)]">
          {t("companion.settings.dnd")}
        </span>
        <button
          disabled={!prefs.enabled}
          onClick={() =>
            update({
              dnd_until: dndActive ? null : new Date(Date.now() + 60 * 60_000).toISOString(),
            })
          }
          className={`text-xs px-2.5 py-1 rounded-lg border transition-colors ${
            dndActive
              ? "bg-amber-500/15 text-amber-400 border-amber-500/30"
              : "bg-[var(--bg-secondary)] text-[var(--text-secondary)] border-[var(--border)] hover:text-[var(--text-primary)]"
          }`}
        >
          {dndActive ? t("companion.settings.dndActive") : t("companion.settings.dndEnable")}
        </button>
      </div>

      <label className="flex items-center justify-between gap-4">
        <span className="text-xs text-[var(--text-primary)]">
          {t("companion.settings.brainModel")}
        </span>
        <input
          type="text"
          value={prefs.brain_model ?? ""}
          placeholder={t("companion.settings.brainModelPlaceholder")}
          onChange={(e) => update({ brain_model: e.target.value || null })}
          className="w-56 bg-[var(--bg-secondary)] border border-[var(--border)] rounded-lg px-2.5 py-1.5 text-xs text-[var(--text-primary)] placeholder:text-[var(--text-secondary)] focus:outline-none focus:border-[var(--accent)]/50"
        />
      </label>
      <p className="text-[10px] text-[var(--text-secondary)]">
        {t("companion.settings.brainModelHint")}
      </p>
    </section>
  );
}
