import { useEffect, useMemo, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { getVersion } from "@tauri-apps/api/app";
import { useTranslation } from "../hooks/useTranslation";
import type { AgentEngineId, EngineModelConfigs, AcpAgentConfig, AcpCatalogEntry } from "../types";
import { useAcpAgents } from "../hooks/useAcpAgents";
import { engineLabel } from "../lib/i18nFormat";
import {
  DEFAULT_SHORTCUTS,
  SHORTCUT_ACTIONS,
  canonicalShortcut,
  eventToShortcut,
  formatShortcut,
  isBareModifierKey,
  type ShortcutAction,
  type ShortcutsConfig,
} from "../lib/shortcuts";
import { useUpdater } from "../hooks/useUpdater";
import { useDragRegion } from "../hooks/useDragRegion";
import { UI_SCALE_OPTIONS, type AppTheme, type UiScale } from "../lib/storage";
import LanguageSelector from "./LanguageSelector";
import { CompanionSettings } from "./CompanionSettings";

// Brand mark — same art as the app/README icon.
const iconUrl = new URL("../assets/icon.svg", import.meta.url).href;

/** One editable shortcut row: click the combo to re-record it. Captures the next
 *  valid key press (window-level, capture phase), validates it (Cmd/Ctrl combos,
 * Esc, F-keys), rejects conflicts with other actions, and commits atomically.
 *  Escape is special: the first press arms a hint, the second assigns Escape. */
function ShortcutRow({
  action,
  shortcuts,
  onChange,
  conflictWith,
  recording,
  setRecording,
}: {
  action: ShortcutAction;
  shortcuts: ShortcutsConfig;
  onChange: (next: ShortcutsConfig) => void;
  /** Another action already bound to this row's combo, if any. */
  conflictWith: ShortcutAction | null;
  recording: boolean;
  setRecording: (action: ShortcutAction | null) => void;
}) {
  const { t } = useTranslation();
  const [escArmed, setEscArmed] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const noteTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const flashNote = (msg: string) => {
    setNote(msg);
    if (noteTimerRef.current) clearTimeout(noteTimerRef.current);
    noteTimerRef.current = setTimeout(() => setNote(null), 2600);
  };

  useEffect(() => {
    return () => {
      if (noteTimerRef.current) clearTimeout(noteTimerRef.current);
    };
  }, []);

  const commit = (combo: string) => {
    onChange({ ...shortcuts, [action]: combo });
    setRecording(null);
    setEscArmed(false);
    setNote(null);
  };

  useEffect(() => {
    if (!recording) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      e.preventDefault();
      e.stopPropagation();
      if (isBareModifierKey(e.key)) return; // wait for the full combo
      if (e.key === "Escape") {
        if (escArmed) {
          commit("Escape");
        } else {
          setEscArmed(true);
          flashNote(t("settings.shortcutsEditor.pressEscAgain"));
        }
        return;
      }
      setEscArmed(false);
      const combo = eventToShortcut(e);
      if (!combo) {
        flashNote(t("settings.shortcutsEditor.invalid"));
        return;
      }
      const canon = canonicalShortcut(combo);
      const other = (Object.entries(shortcuts) as [ShortcutAction, string][]).find(
        ([a, s]) => a !== action && canonicalShortcut(s) === canon,
      );
      if (other) {
        flashNote(
          t("settings.shortcutsEditor.conflict", {
            action: t(`settings.shortcuts.${other[0]}`),
          }),
        );
        return;
      }
      commit(combo);
    };
    // Capture phase so the recorder sees the key before any app shortcut does.
    window.addEventListener("keydown", handleKeyDown, true);
    return () => window.removeEventListener("keydown", handleKeyDown, true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [recording, escArmed, shortcuts, action, t]);

  const isDefault = shortcuts[action] === DEFAULT_SHORTCUTS[action];
  const isConflict = conflictWith !== null;

  return (
    <div className="flex flex-col gap-1">
      <div className="flex items-center justify-between gap-2">
        <span className="text-xs text-[var(--text-secondary)] truncate">
          {t(`settings.shortcuts.${action}`)}
        </span>
        <div className="flex items-center gap-1 shrink-0">
          <button
            type="button"
            onClick={() => {
              setEscArmed(false);
              setNote(null);
              setRecording(recording ? null : action);
            }}
            className={`px-2 py-0.5 rounded border text-[11px] font-mono transition-colors ${
              recording
                ? "border-[var(--accent)] bg-[var(--accent)]/15 text-[var(--accent)] animate-pulse"
                : isConflict
                  ? "border-red-500/50 bg-red-500/10 text-red-300"
                  : "border-[var(--border-color)] bg-[var(--bg-primary)] text-[var(--text-primary)] hover:border-[var(--accent)]"
            }`}
            title={recording ? t("settings.shortcutsEditor.cancel") : t("settings.shortcutsEditor.clickToChange")}
          >
            {recording ? t("settings.shortcutsEditor.recording") : formatShortcut(shortcuts[action], t)}
          </button>
          {!isDefault && (
            <button
              type="button"
              onClick={() => commit(DEFAULT_SHORTCUTS[action])}
              className="p-1 rounded text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-tertiary)] transition-colors"
              title={t("settings.shortcutsEditor.resetOne")}
              aria-label={t("settings.shortcutsEditor.resetOne")}
            >
              <svg width="12" height="12" viewBox="0 0 14 14" fill="none">
                <path
                  d="M12 7a5 5 0 1 1-1.6-3.67M12 1.5V4h-2.5"
                  stroke="currentColor"
                  strokeWidth="1.5"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </svg>
            </button>
          )}
        </div>
      </div>
      {(recording || note || isConflict) && (
        <p className={`text-[10px] ${isConflict && !recording ? "text-red-400" : "text-[var(--text-secondary)]"}`}>
          {recording
            ? escArmed
              ? t("settings.shortcutsEditor.pressEscAgain")
              : t("settings.shortcutsEditor.recordingHint")
            : isConflict
              ? t("settings.shortcutsEditor.conflict", {
                  action: t(`settings.shortcuts.${conflictWith}`),
                })
              : note}
        </p>
      )}
    </div>
  );
}
const THEME_OPTIONS: { id: AppTheme; labelKey: string }[] = [
  { id: "dark", labelKey: "settings.dark" },
  { id: "light", labelKey: "settings.light" },
  { id: "cyber-teal", labelKey: "settings.cyberTeal" },
  { id: "paper-mint", labelKey: "settings.paperMint" },
];

interface SettingsProps {
  /** Engines that are installed + ready; the Preferred Engine picker is limited to these. */
  readyEngineIds: AgentEngineId[];
  defaultEngine: AgentEngineId;
  onDefaultEngineChange: (engine: AgentEngineId) => void;
  theme: AppTheme;
  onThemeChange: (theme: AppTheme) => void;
  uiScale: UiScale;
  onUiScaleChange: (scale: UiScale) => void;
  onClose: () => void;
  systemPrompt: string;
  onSystemPromptChange: (prompt: string) => void;
  engineModelConfigs: EngineModelConfigs;
  onEngineModelConfigChange: (
    engine: AgentEngineId,
    patch: Record<string, string | undefined>,
  ) => void;
  defaultWorkspacePath: string;
  onPickDefaultWorkspace: () => void;
  onResetDefaultWorkspace: () => void;
  vaultPath: string | null;
  onPickVault: () => void;
  onResetVault: () => void;
  defaultVaultPath: string | null;
  onBackfill: () => void;
  backfillStatus: string | null;
  /** User-customizable keyboard shortcuts (action id → combo). */
  shortcuts: ShortcutsConfig;
  /** Replace the shortcuts config (persisted via config.json). */
  onShortcutsChange: (next: ShortcutsConfig) => void;
}

export default function Settings({
  readyEngineIds,
  defaultEngine,
  onDefaultEngineChange,
  theme,
  onThemeChange,
  uiScale,
  onUiScaleChange,
  onClose,
  systemPrompt,
  onSystemPromptChange,
  engineModelConfigs,
  onEngineModelConfigChange,
  defaultWorkspacePath,
  onPickDefaultWorkspace,
  onResetDefaultWorkspace,
  vaultPath,
  onPickVault,
  onResetVault,
  defaultVaultPath,
  onBackfill,
  backfillStatus,
  shortcuts,
  onShortcutsChange,
}: SettingsProps) {
  const { t } = useTranslation();
  const handleDragRegion = useDragRegion();
  const { engines: allEngines } = useAcpAgents();
  const [expandedEngines, setExpandedEngines] = useState<Record<AgentEngineId, boolean>>({
    claude: false,
    cursor: false,
    codebuddy: false,
    builtin: false,
    codex: false,
  });
  // Draft state for a not-yet-committed custom env var per engine (key typed
  // locally so partial keys don't create junk config entries).
  const [customDrafts, setCustomDrafts] = useState<
    Record<AgentEngineId, { key: string; value: string } | null>
  >({ claude: null, cursor: null, codebuddy: null, builtin: null, codex: null });
  // Renaming an existing custom key: oldKey -> edited key, committed on blur.
  const [renameDrafts, setRenameDrafts] = useState<Record<string, string>>({});
  // Two-step delete confirmation: the row (engine + key) awaiting confirmation.
  const [pendingDelete, setPendingDelete] = useState<{
    engine: AgentEngineId;
    key: string;
  } | null>(null);
  const updater = useUpdater();
  const [appVersion, setAppVersion] = useState("");
  /** Which shortcut row is currently recording a new combo (null = none). */
  const [recordingShortcut, setRecordingShortcut] = useState<ShortcutAction | null>(null);

  // Standing conflicts between two actions bound to the same combo (possible
  // via the per-row reset). action → the other action it collides with.
  const conflicts = useMemo(() => {
    const byCanon = new Map<string, ShortcutAction[]>();
    for (const action of SHORTCUT_ACTIONS) {
      const canon = canonicalShortcut(shortcuts[action]);
      if (!canon) continue;
      byCanon.set(canon, [...(byCanon.get(canon) ?? []), action]);
    }
    const out = new Map<ShortcutAction, ShortcutAction>();
    for (const actions of byCanon.values()) {
      if (actions.length < 2) continue;
      for (const a of actions) {
        const other = actions.find((x) => x !== a);
        if (other) out.set(a, other);
      }
    }
    return out;
  }, [shortcuts]);

  useEffect(() => {
    getVersion().then(setAppVersion).catch(() => setAppVersion(""));
  }, []);

  return (
    <div className="settings-enter flex flex-col flex-1 min-h-0 bg-[var(--bg-secondary)]">
        {/* Header — drag empty areas to move window */}
        <div
          onMouseDown={handleDragRegion}
          className="shrink-0 flex items-center justify-between px-5 py-4 border-b border-[var(--border-color)]"
        >
          <h2 className="text-base font-semibold text-[var(--text-primary)]">
            {t('settings.title')}
          </h2>
          <button
            onClick={onClose}
            className="p-1.5 rounded-lg hover:bg-[var(--bg-tertiary)] text-[var(--text-secondary)] transition-colors"
            aria-label={t('common.close')}
          >
            <svg
              width="18"
              height="18"
              viewBox="0 0 18 18"
              fill="currentColor"
            >
              <path d="M4 4L14 14M14 4L4 14" stroke="currentColor" strokeWidth="2" strokeLinecap="round" fill="none" />
            </svg>
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-5 grid grid-cols-1 xl:grid-cols-2 gap-x-6 gap-y-5 content-start">
          {/* Preferred engine for new sessions */}
          <section>
            <h3 className="text-sm font-semibold text-[var(--text-primary)] mb-3">
              {t('settings.preferredEngine')}
            </h3>
            <select
              value={defaultEngine}
              onChange={(e) => onDefaultEngineChange(e.target.value as AgentEngineId)}
              className="w-full text-sm rounded-xl px-3 py-2 bg-[var(--bg-primary)] border border-[var(--border-color)] text-[var(--text-primary)]"
            >
              {allEngines
                .filter((e) => readyEngineIds.includes(e.id))
                .map((e) => (
                  <option key={e.id} value={e.id}>
                    {engineLabel(e.id, t)}
                  </option>
                ))}
            </select>
            <p className="text-xs text-[var(--text-secondary)] mt-2">
              {t('settings.preferredEngineHint')}
            </p>
          </section>

          {/* Working directory */}
          <section>
            <h3 className="text-sm font-semibold text-[var(--text-primary)] mb-3">
              {t('settings.workingDirectory')}
            </h3>
            <div className="bg-[var(--bg-primary)] rounded-xl p-4 border border-[var(--border-color)]">
              <p className="text-xs text-[var(--text-secondary)] break-all font-mono mb-3">
                {defaultWorkspacePath || t("common.notAvailable")}
              </p>
              <div className="flex gap-2">
                <button
                  onClick={onPickDefaultWorkspace}
                  className="px-3 py-1.5 rounded-lg bg-[var(--bg-tertiary)] hover:bg-[var(--accent)]/20 text-xs text-[var(--text-primary)] transition-colors"
                >
                  {t('settings.changeDirectory')}
                </button>
                <button
                  onClick={onResetDefaultWorkspace}
                  className="px-3 py-1.5 rounded-lg bg-[var(--bg-primary)] hover:bg-[var(--bg-tertiary)] text-xs text-[var(--text-secondary)] border border-[var(--border-color)] transition-colors"
                >
                  {t('settings.resetDirectory')}
                </button>
              </div>
            </div>
            <p className="text-xs text-[var(--text-secondary)] mt-2">
              {t('settings.workingDirectoryHint')}
            </p>
          </section>

          {/* Companion pet (小精灵) */}
          <CompanionSettings />

          {/* Knowledge Base */}
          <section>
            <h3 className="text-sm font-semibold text-[var(--text-primary)] mb-3">
              {t('settings.knowledgeBase')}
            </h3>
            <div className="bg-[var(--bg-primary)] rounded-xl p-4 border border-[var(--border-color)]">
              <p className="text-xs text-[var(--text-secondary)] break-all font-mono mb-3">
                {vaultPath || defaultVaultPath || t("common.notAvailable")}
              </p>
              <div className="flex gap-2 flex-wrap">
                <button
                  onClick={onPickVault}
                  className="px-3 py-1.5 rounded-lg bg-[var(--bg-tertiary)] hover:bg-[var(--accent)]/20 text-xs text-[var(--text-primary)] transition-colors"
                >
                  {t('settings.changeDirectory')}
                </button>
                {vaultPath && (
                  <button
                    onClick={onResetVault}
                    className="px-3 py-1.5 rounded-lg bg-[var(--bg-primary)] hover:bg-[var(--bg-tertiary)] text-xs text-[var(--text-secondary)] border border-[var(--border-color)] transition-colors"
                  >
                    {t('common.reset')}
                  </button>
                )}
                <button
                  onClick={async () => {
                    const path = vaultPath || defaultVaultPath;
                    if (!path) return;
                    try {
                      const installed = await invoke<boolean>("check_obsidian_installed");
                      if (!installed) {
                        alert(t('settings.obsidianNotInstalled'));
                        return;
                      }
                      await invoke("open_vault_in_obsidian", { vaultPath: path });
                    } catch (e) {
                      console.error(e);
                    }
                  }}
                  className="px-3 py-1.5 rounded-lg bg-[var(--accent)] hover:bg-[var(--accent-hover)] text-white text-xs font-medium transition-colors"
                >
                  {t('settings.openInObsidian')}
                </button>
                <button
                  onClick={() => {
                    const path = vaultPath || null;
                    invoke("open_vault_folder", { vaultPath: path }).catch(() => {});
                  }}
                  className="px-3 py-1.5 rounded-lg bg-[var(--bg-tertiary)] hover:bg-[var(--accent)]/20 text-xs text-[var(--text-primary)] transition-colors"
                >
                  {t('settings.openFolder')}
                </button>
                <button
                  onClick={onBackfill}
                  className="px-3 py-1.5 rounded-lg bg-[var(--bg-tertiary)] hover:bg-[var(--accent)]/20 text-xs text-[var(--text-primary)] transition-colors"
                >
                  {t('settings.backfillHistory')}
                </button>
              </div>
              {backfillStatus && (
                <p className="text-xs text-[var(--accent)] mt-2">{backfillStatus}</p>
              )}
            </div>
            <p className="text-xs text-[var(--text-secondary)] mt-2">
              {vaultPath
                ? t('settings.knowledgeBaseHint')
                : defaultVaultPath
                  ? t('settings.knowledgeBaseDefault')
                  : t('settings.knowledgeBaseNotSet')}
            </p>
          </section>

          {/* Theme */}
          <section>
            <h3 className="text-sm font-semibold text-[var(--text-primary)] mb-3">
              {t('settings.theme')}
            </h3>
            <div className="grid grid-cols-2 gap-2">
              {THEME_OPTIONS.map((option) => (
                <button
                  key={option.id}
                  onClick={() => onThemeChange(option.id)}
                  className={`py-2 px-3 rounded-lg text-sm font-medium transition-colors ${
                    theme === option.id
                      ? "bg-[var(--accent)] text-white"
                      : "bg-[var(--bg-primary)] text-[var(--text-secondary)] border border-[var(--border-color)]"
                  }`}
                >
                  {t(option.labelKey)}
                </button>
              ))}
            </div>
          </section>

          {/* Interface scale */}
          <section>
            <h3 className="text-sm font-semibold text-[var(--text-primary)] mb-3">
              {t('settings.interfaceScale')}
            </h3>
            <div className="grid grid-cols-4 gap-2">
              {UI_SCALE_OPTIONS.map((option) => (
                <button
                  key={option}
                  onClick={() => onUiScaleChange(option)}
                  className={`py-2 px-2 rounded-lg text-sm font-medium transition-colors ${
                    uiScale === option
                      ? "bg-[var(--accent)] text-white"
                      : "bg-[var(--bg-primary)] text-[var(--text-secondary)] border border-[var(--border-color)]"
                  }`}
                >
                  {Math.round(option * 100)}%
                </button>
              ))}
            </div>
            <p className="text-xs text-[var(--text-secondary)] mt-2">
              {t('settings.interfaceScaleHint')}
            </p>
          </section>

          {/* Language */}
          <section>
            <h3 className="text-sm font-semibold text-[var(--text-primary)] mb-3">
              {t('language.title')}
            </h3>
            <LanguageSelector className="w-full" />
            <p className="text-xs text-[var(--text-secondary)] mt-2">
              {t('language.select')}
            </p>
          </section>

          {/* Builtin engine env (the one non-ACP engine). CLI engines' env
              lives in each ACP agent's launch config below. */}
          <section className="xl:col-span-2">
            <h3 className="text-sm font-semibold text-[var(--text-primary)] mb-2">
              {t('settings.modelConfig')}
            </h3>
            <p className="text-xs text-[var(--text-secondary)] mb-3">
              {t('settings.modelConfigHint')}
            </p>
            <div className="space-y-2">
              {(() => {
                const id: AgentEngineId = "builtin";
                const expanded = expandedEngines[id];
                const config = (engineModelConfigs ?? {}) as Record<string, string | undefined>;
                // All env vars are user-managed: every key with a defined value
                // renders as an editable/removable row (no fixed field list).
                const envKeys = Object.keys(config).filter(
                  (k) => typeof config[k] === "string",
                );
                const filledCount = envKeys.length;
                const draft = customDrafts[id];
                const name = engineLabel(id, t);

                return (
                  <div
                    key={id}
                    className="bg-[var(--bg-primary)] rounded-xl border border-[var(--border-color)] overflow-hidden"
                  >
                    <button
                      type="button"
                      onClick={() =>
                        setExpandedEngines((prev) => ({ ...prev, [id]: !prev[id] }))
                      }
                      className="w-full flex items-center justify-between px-4 py-3 text-left hover:bg-[var(--bg-tertiary)]/40 transition-colors"
                    >
                      <div className="min-w-0">
                        <span className="text-sm font-medium text-[var(--text-primary)]">
                          {name}
                        </span>
                        {!expanded && filledCount > 0 && (
                          <span className="ml-2 text-[10px] text-[var(--text-secondary)]">
                            {t('settings.overrides', { count: filledCount })}
                          </span>
                        )}
                      </div>
                      <svg
                        width="14"
                        height="14"
                        viewBox="0 0 14 14"
                        fill="none"
                        className={`shrink-0 text-[var(--text-secondary)] transition-transform ${
                          expanded ? "rotate-180" : ""
                        }`}
                      >
                        <path
                          d="M3 5l4 4 4-4"
                          stroke="currentColor"
                          strokeWidth="1.5"
                          strokeLinecap="round"
                          strokeLinejoin="round"
                        />
                      </svg>
                    </button>

                    {expanded && (
                      <div className="px-4 pb-4 space-y-3 border-t border-[var(--border-color)]">
                        <p className="text-[10px] text-[var(--text-secondary)] pt-3">
                          {t('settings.appliesOnly', { name })}
                        </p>
                        {/* Environment variables — all user-managed */}
                        {envKeys.length > 0 && (
                          <div className="space-y-2">
                              {envKeys.map((k) => {
                                const keyNow = renameDrafts[k] ?? k;
                                // Red flag when a rename collides with another
                                // existing key of this engine.
                                const renameDuplicate =
                                  keyNow.trim() !== k &&
                                  envKeys.some(
                                    (other) =>
                                      other !== k &&
                                      other.toUpperCase() === keyNow.trim().toUpperCase(),
                                  );
                                const commitRename = () => {
                                  const next = (renameDrafts[k] ?? "").trim();
                                  setRenameDrafts((prev) => {
                                    const rest = { ...prev };
                                    delete rest[k];
                                    return rest;
                                  });
                                  if (!next || next === k) return;
                                  if (
                                    envKeys.some(
                                      (other) =>
                                        other !== k &&
                                        other.toUpperCase() === next.toUpperCase(),
                                    )
                                  )
                                    return; // duplicate: refuse to commit
                                  onEngineModelConfigChange(id, {
                                    [next]: config[k],
                                    [k]: undefined,
                                  });
                                };
                                const confirming =
                                  pendingDelete?.engine === id && pendingDelete.key === k;
                                return (
                                  <div key={k} className="flex items-center gap-2">
                                    <input
                                      type="text"
                                      value={keyNow}
                                      onChange={(e) =>
                                        setRenameDrafts((prev) => ({
                                          ...prev,
                                          [k]: e.target.value,
                                        }))
                                      }
                                      onBlur={commitRename}
                                      onKeyDown={(e) => {
                                        if (e.key === "Enter") {
                                          e.currentTarget.blur();
                                        }
                                      }}
                                      placeholder="KEY_NAME"
                                      className={`w-2/5 bg-[var(--bg-secondary)] border rounded-lg px-2 py-2 text-xs text-[var(--text-primary)] placeholder-[var(--text-secondary)] outline-none transition-colors font-mono uppercase ${
                                        renameDuplicate
                                          ? "border-red-500 focus:border-red-500"
                                          : "border-[var(--border-color)] focus:border-[var(--accent)]"
                                      }`}
                                    />
                                    <input
                                      type="text"
                                      value={config[k] ?? ""}
                                      onChange={(e) =>
                                        onEngineModelConfigChange(id, {
                                          [k]: e.target.value || undefined,
                                        })
                                      }
                                      placeholder="value"
                                      className="flex-1 bg-[var(--bg-secondary)] border border-[var(--border-color)] rounded-lg px-2 py-2 text-xs text-[var(--text-primary)] placeholder-[var(--text-secondary)] outline-none focus:border-[var(--accent)] transition-colors font-mono"
                                    />
                                    {confirming ? (
                                      <div className="shrink-0 flex items-center gap-1">
                                        <button
                                          type="button"
                                          onClick={() => {
                                            onEngineModelConfigChange(id, {
                                              [k]: undefined,
                                            });
                                            setPendingDelete(null);
                                          }}
                                          className="text-[10px] px-2 py-1 rounded-lg bg-red-500 text-white"
                                        >
                                          {t('settings.deleteConfirm')}
                                        </button>
                                        <button
                                          type="button"
                                          onClick={() => setPendingDelete(null)}
                                          className="text-[10px] px-2 py-1 rounded-lg text-[var(--text-secondary)] hover:text-[var(--text-primary)]"
                                        >
                                          {t('settings.cancelEnvVar')}
                                        </button>
                                      </div>
                                    ) : (
                                      <button
                                        type="button"
                                        aria-label={t('settings.removeEnvVar')}
                                        onClick={() =>
                                          setPendingDelete({ engine: id, key: k })
                                        }
                                        className="shrink-0 text-[var(--text-secondary)] hover:text-red-400 transition-colors p-1"
                                      >
                                        <svg
                                          width="14"
                                          height="14"
                                          viewBox="0 0 14 14"
                                          fill="none"
                                        >
                                          <path
                                            d="M3 3l8 8M11 3l-8 8"
                                            stroke="currentColor"
                                            strokeWidth="1.5"
                                            strokeLinecap="round"
                                          />
                                        </svg>
                                      </button>
                                    )}
                                  </div>
                                );
                              })}
                          </div>
                        )}

                        {/* Add a custom env var */}
                        {draft ? (() => {
                          const draftDuplicate =
                            draft.key.trim().length > 0 &&
                            envKeys.some(
                              (other) =>
                                other.toUpperCase() === draft.key.trim().toUpperCase(),
                            );
                          return (
                          <div className="flex items-center gap-2">
                            <input
                              type="text"
                              autoFocus
                              value={draft.key}
                              onChange={(e) =>
                                setCustomDrafts((prev) => ({
                                  ...prev,
                                  [id]: { ...draft, key: e.target.value.toUpperCase() },
                                }))
                              }
                              placeholder="KEY_NAME"
                              className={`w-2/5 bg-[var(--bg-secondary)] border rounded-lg px-2 py-2 text-xs text-[var(--text-primary)] placeholder-[var(--text-secondary)] outline-none transition-colors font-mono ${
                                draftDuplicate
                                  ? "border-red-500 focus:border-red-500"
                                  : "border-[var(--border-color)] focus:border-[var(--accent)]"
                              }`}
                            />
                            <input
                              type="text"
                              value={draft.value}
                              onChange={(e) =>
                                setCustomDrafts((prev) => ({
                                  ...prev,
                                  [id]: { ...draft, value: e.target.value },
                                }))
                              }
                              onKeyDown={(e) => {
                                if (e.key === "Enter" && draft.key.trim() && !draftDuplicate) {
                                  onEngineModelConfigChange(id, {
                                    [draft.key.trim()]: draft.value || undefined,
                                  });
                                  setCustomDrafts((prev) => ({ ...prev, [id]: null }));
                                }
                              }}
                              placeholder="value"
                              className="flex-1 bg-[var(--bg-secondary)] border border-[var(--border-color)] rounded-lg px-2 py-2 text-xs text-[var(--text-primary)] placeholder-[var(--text-secondary)] outline-none focus:border-[var(--accent)] transition-colors font-mono"
                            />
                            <button
                              type="button"
                              disabled={!draft.key.trim() || draftDuplicate}
                              onClick={() => {
                                onEngineModelConfigChange(id, {
                                  [draft.key.trim()]: draft.value || undefined,
                                });
                                setCustomDrafts((prev) => ({ ...prev, [id]: null }));
                              }}
                              className="shrink-0 text-xs px-2 py-1.5 rounded-lg bg-[var(--accent)] text-white disabled:opacity-40"
                            >
                              {t('settings.saveEnvVar')}
                            </button>
                            <button
                              type="button"
                              onClick={() => setCustomDrafts((prev) => ({ ...prev, [id]: null }))}
                              className="shrink-0 text-xs px-2 py-1.5 rounded-lg text-[var(--text-secondary)] hover:text-[var(--text-primary)]"
                            >
                              {t('settings.cancelEnvVar')}
                            </button>
                          </div>
                          );
                        })() : (
                          <button
                            type="button"
                            onClick={() =>
                              setCustomDrafts((prev) => ({
                                ...prev,
                                [id]: { key: "", value: "" },
                              }))
                            }
                            className="text-xs text-[var(--accent)] hover:underline"
                          >
                            + {t('settings.addEnvVar')}
                          </button>
                        )}
                      </div>
                    )}
                  </div>
                );
              })()}
            </div>
          </section>

          {/* ACP agents (Agent Client Protocol registry) */}
          <section className="xl:col-span-2">
            <h3 className="text-sm font-semibold text-[var(--text-primary)] mb-2">
              {t('settings.acpAgents')}
            </h3>
            <p className="text-xs text-[var(--text-secondary)] mb-3">
              {t('settings.acpAgentsHint')}
            </p>
            <AcpAgentsEditor t={t} />
          </section>

          {/* System Prompt */}
          <section>
            <h3 className="text-sm font-semibold text-[var(--text-primary)] mb-3">
              {t('settings.systemPrompt')}
            </h3>
            <textarea
              value={systemPrompt}
              onChange={(e) => onSystemPromptChange(e.target.value)}
              placeholder={t('settings.systemPromptPlaceholder')}
              rows={4}
              className="w-full bg-[var(--bg-primary)] border border-[var(--border-color)] rounded-xl px-4 py-3 text-sm text-[var(--text-primary)] placeholder-[var(--text-secondary)] resize-none outline-none focus:border-[var(--accent)] transition-colors"
            />
          </section>

          {/* About */}
          <section>
            <h3 className="text-sm font-semibold text-[var(--text-primary)] mb-3">
              {t('settings.about')}
            </h3>
            <div className="bg-[var(--bg-primary)] rounded-xl p-4 border border-[var(--border-color)] space-y-1">
              <div className="flex items-center gap-2">
                <img src={iconUrl} alt={t('app.name')} className="w-8 h-8 rounded-lg" />
                <p className="text-sm text-[var(--text-primary)]">{t('app.name')}</p>
              </div>
              <p className="text-xs text-[var(--text-secondary)]">
                {t('settings.aboutDescription')}
              </p>
              <p className="text-xs text-[var(--text-secondary)]">
                {t('settings.builtWith')}
              </p>
              <p className="text-xs text-[var(--text-secondary)]">
                {t('settings.version')}: {appVersion || "0.1.1"}
              </p>

              {/* Update check */}
              <div className="pt-2 mt-1 border-t border-[var(--border-color)]">
                {updater.status === "up-to-date" && (
                  <p className="text-xs text-[var(--text-secondary)] mb-2">
                    {t('updater.upToDate')}
                  </p>
                )}
                {updater.status === "available" && updater.newVersion && (
                  <p className="text-xs text-[var(--text-primary)] mb-2">
                    {t('settings.versionAvailable', { version: updater.newVersion })}
                  </p>
                )}
                {updater.status === "downloading" &&
                  updater.contentLength > 0 && (
                    <p className="text-xs text-[var(--text-secondary)] mb-2">
                      {t('settings.downloadingProgress', {
                        percent: Math.round(
                          (updater.downloaded / updater.contentLength) * 100
                        ),
                      })}
                    </p>
                  )}
                {updater.status === "installed" && (
                  <p className="text-xs text-[var(--text-primary)] mb-2">
                    {t('settings.updateReady')}
                  </p>
                )}
                {updater.status === "error" && updater.error && (
                  <p className="text-xs text-red-400 mb-2 break-all">
                    {updater.error}
                  </p>
                )}
                <div className="flex flex-wrap items-center gap-2">
                  <button
                    onClick={
                      updater.status === "available"
                        ? updater.downloadAndInstall
                        : updater.status === "installed"
                          ? updater.restart
                          : updater.checkForUpdates
                    }
                    disabled={
                      updater.status === "checking" ||
                      updater.status === "downloading"
                    }
                    className="px-3 py-1.5 rounded-lg bg-[var(--accent)] hover:bg-[var(--accent-hover)] text-white text-xs font-medium transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
                  >
                    {updater.status === "checking"
                      ? t('updater.checking')
                      : updater.status === "downloading"
                        ? t('updater.downloading')
                        : updater.status === "available"
                          ? t('settings.installVersion', { version: updater.newVersion })
                          : updater.status === "installed"
                            ? t('updater.restartNow')
                            : t('updater.checkForUpdates')}
                  </button>
                  <button
                    onClick={updater.installBeta}
                    disabled={
                      updater.status === "checking" ||
                      updater.status === "downloading" ||
                      updater.status === "installed"
                    }
                    title={t('updater.tryBetaHint')}
                    className="px-3 py-1.5 rounded-lg bg-[var(--bg-tertiary)] hover:opacity-80 text-[var(--text-primary)] text-xs font-medium transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
                  >
                    {t('updater.tryBeta')}
                  </button>
                </div>
              </div>
            </div>
          </section>

          {/* Keyboard shortcuts — user-customizable. Click a combo to re-record
              it; conflicts with other actions are rejected and flagged. */}
          <section>
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-sm font-semibold text-[var(--text-primary)]">
                {t('settings.keyboardShortcuts')}
              </h3>
              <button
                onClick={() => {
                  setRecordingShortcut(null);
                  onShortcutsChange({ ...DEFAULT_SHORTCUTS });
                }}
                className="px-2.5 py-1 rounded-lg bg-[var(--bg-tertiary)] hover:opacity-80 text-[var(--text-primary)] text-xs font-medium transition-colors"
              >
                {t('settings.shortcutsEditor.resetAll')}
              </button>
            </div>
            <div className="space-y-2 text-xs text-[var(--text-secondary)]">
              {SHORTCUT_ACTIONS.map((action) => (
                <ShortcutRow
                  key={action}
                  action={action}
                  shortcuts={shortcuts}
                  onChange={onShortcutsChange}
                  conflictWith={conflicts.get(action) ?? null}
                  recording={recordingShortcut === action}
                  setRecording={setRecordingShortcut}
                />
              ))}
              {/* Fixed composer bindings — not remappable (standard text-entry
                  behavior), listed for discoverability. */}
              <div className="flex justify-between pt-1 border-t border-[var(--border-color)]">
                <span>{t('settings.shortcuts.sendMessage')}</span>
                <kbd className="px-2 py-0.5 rounded bg-[var(--bg-primary)] border border-[var(--border-color)] text-[var(--text-primary)]">
                  {t('keys.enter')}
                </kbd>
              </div>
              <div className="flex justify-between">
                <span>{t('settings.shortcuts.newLine')}</span>
                <kbd className="px-2 py-0.5 rounded bg-[var(--bg-primary)] border border-[var(--border-color)] text-[var(--text-primary)]">
                  {t('keys.shiftEnter')}
                </kbd>
              </div>
            </div>
            <p className="text-xs text-[var(--text-secondary)] mt-2">
              {t('settings.shortcutsEditor.hint')}
            </p>
          </section>
        </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// ACP agents registry editor
// ---------------------------------------------------------------------------

type TFunc = ReturnType<typeof useTranslation>["t"];

/** One editable ACP agent row. Launch configs are data (Zed's agent_servers
 *  model): command + args + env, no per-agent code. */
function AcpAgentRow({
  agent,
  onChange,
  onDelete,
  t,
}: {
  agent: AcpAgentConfig;
  onChange: (next: AcpAgentConfig) => void;
  onDelete: () => void;
  t: TFunc;
}) {
  const [confirming, setConfirming] = useState(false);
  const inputCls =
    "bg-[var(--bg-secondary)] border border-[var(--border-color)] rounded-lg px-2 py-1.5 text-xs text-[var(--text-primary)] placeholder-[var(--text-secondary)] outline-none focus:border-[var(--accent)] transition-colors font-mono";
  return (
    <div className="rounded-xl border border-[var(--border-color)] bg-[var(--bg-primary)] p-3 space-y-2">
      <div className="flex items-center gap-2">
        <input
          type="text"
          value={agent.key}
          onChange={(e) => onChange({ ...agent, key: e.target.value.trim().replace(/\s+/g, "-") })}
          placeholder="key"
          title={t('settings.acpKeyTitle')}
          className={`${inputCls} w-28`}
        />
        <input
          type="text"
          value={agent.label}
          onChange={(e) => onChange({ ...agent, label: e.target.value })}
          placeholder={t('settings.acpLabelPlaceholder')}
          className={`${inputCls} w-40`}
        />
        <input
          type="text"
          value={agent.command}
          onChange={(e) => onChange({ ...agent, command: e.target.value })}
          placeholder={t('settings.acpCommandPlaceholder')}
          className={`${inputCls} flex-1`}
        />
        {confirming ? (
          <div className="shrink-0 flex items-center gap-1">
            <button
              type="button"
              onClick={onDelete}
              className="text-[10px] px-2 py-1 rounded-lg bg-red-500 text-white"
            >
              {t('settings.deleteConfirm')}
            </button>
            <button
              type="button"
              onClick={() => setConfirming(false)}
              className="text-[10px] px-2 py-1 rounded-lg text-[var(--text-secondary)] hover:text-[var(--text-primary)]"
            >
              {t('settings.cancelEnvVar')}
            </button>
          </div>
        ) : (
          <button
            type="button"
            aria-label={t('settings.acpRemoveAgent')}
            onClick={() => setConfirming(true)}
            className="shrink-0 text-[var(--text-secondary)] hover:text-red-400 transition-colors p-1"
          >
            <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
              <path d="M3 3l8 8M11 3l-8 8" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
            </svg>
          </button>
        )}
      </div>
      <input
        type="text"
        value={agent.args.join(" ")}
        onChange={(e) =>
          // Shell-style split preserving quoted args (simple: no escapes).
          onChange({
            ...agent,
            args: e.target.value.match(/"[^"]*"|\S+/g)?.map((s) => s.replace(/^"|"$/g, "")) ?? [],
          })
        }
        placeholder={t('settings.acpArgsPlaceholder')}
        className={`${inputCls} w-full`}
      />
      <p className="text-[10px] text-[var(--text-secondary)]">
        {t('settings.acpEngineId', { id: `acp/${agent.key}` })}
      </p>
    </div>
  );
}

/** One catalog entry row from the official ACP registry. Launchable entries
 *  (npx/uvx) enable in one click; binary ones link out. */
function AcpCatalogRow({
  entry,
  enabled,
  onEnable,
  enabling,
}: {
  entry: AcpCatalogEntry;
  enabled: boolean;
  onEnable: () => void;
  enabling: boolean;
}) {
  const { t } = useTranslation();
  return (
    <div className="flex items-start gap-3 rounded-xl border border-[var(--border-color)] bg-[var(--bg-primary)] p-3">
      {entry.icon ? (
        <img src={entry.icon} alt="" className="w-4 h-4 mt-0.5 shrink-0" draggable={false} />
      ) : (
        <span className="w-4 h-4 mt-0.5 shrink-0 rounded bg-sky-500/20 text-sky-300 grid place-items-center text-[9px] font-mono">
          {entry.name.slice(0, 1).toUpperCase()}
        </span>
      )}
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span className="text-sm font-medium text-[var(--text-primary)] truncate">
            {entry.name}
          </span>
          <span className="text-[10px] font-mono text-[var(--text-secondary)]">
            v{entry.version}
          </span>
          {!entry.launchable && (
            <span className="text-[10px] text-amber-400">
              {t('settings.acpBinaryOnly')}
            </span>
          )}
        </div>
        {entry.description && (
          <p className="text-xs text-[var(--text-secondary)] line-clamp-2 mt-0.5">
            {entry.description}
          </p>
        )}
      </div>
      {enabled ? (
        <span className="shrink-0 text-[10px] px-2 py-1 rounded-lg bg-emerald-500/15 text-emerald-300">
          {t('settings.acpEnabled')}
        </span>
      ) : (
        <button
          type="button"
          disabled={!entry.launchable || enabling}
          onClick={onEnable}
          title={entry.launchable ? undefined : entry.description}
          className="shrink-0 text-xs px-2.5 py-1 rounded-lg bg-[var(--accent)] text-white disabled:opacity-40 disabled:cursor-not-allowed"
        >
          {enabling ? t('settings.acpEnabling') : t('settings.acpEnable')}
        </button>
      )}
    </div>
  );
}

function AcpAgentsEditor({ t }: { t: TFunc }) {
  const { acpAgents, refresh } = useAcpAgents();
  const [catalog, setCatalog] = useState<AcpCatalogEntry[] | null>(null);
  const [catalogError, setCatalogError] = useState(false);
  const [query, setQuery] = useState("");
  const [enablingId, setEnablingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [manualAgents, setManualAgents] = useState<AcpAgentConfig[] | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const entries = await invoke<AcpCatalogEntry[]>("list_acp_catalog");
        if (!cancelled) setCatalog(Array.isArray(entries) ? entries : []);
      } catch {
        if (!cancelled) setCatalogError(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const enabledKeys = new Set(
    (manualAgents ?? acpAgents).map((a) => a.key),
  );

  const enable = async (entry: AcpCatalogEntry) => {
    setEnablingId(entry.id);
    setError(null);
    try {
      await invoke("enable_acp_catalog_agent", { entry });
      await refresh();
    } catch (e) {
      setError(String(e));
    } finally {
      setEnablingId(null);
    }
  };

  const q = query.trim().toLowerCase();
  const filtered = (catalog ?? []).filter(
    (e) =>
      !q ||
      e.name.toLowerCase().includes(q) ||
      e.id.toLowerCase().includes(q) ||
      e.description.toLowerCase().includes(q),
  );

  const commitManual = async (next: AcpAgentConfig[]) => {
    setManualAgents(next);
    setSaving(true);
    setError(null);
    try {
      await invoke<AcpAgentConfig[]>("save_acp_agents", { agents: next });
      await refresh();
      setManualAgents(null);
    } catch (e) {
      setError(String(e));
    } finally {
      setSaving(false);
    }
  };

  const addManual = () => {
    setManualAgents([
      ...(manualAgents ?? acpAgents),
      {
        key: `agent-${Date.now().toString(36)}`,
        label: "",
        command: "",
        args: [],
        env: {},
        probe_message: "ping",
      },
    ]);
  };

  return (
    <div className="space-y-3">
      {error && <p className="text-xs text-red-400">{error}</p>}

      {/* Official catalog */}
      {catalog === null ? (
        <p className="text-xs text-[var(--text-secondary)]">
          {catalogError
            ? t('settings.acpCatalogUnavailable')
            : t('settings.acpCatalogLoading')}
        </p>
      ) : (
        <>
          <input
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={t('settings.acpCatalogSearch')}
            className="w-full bg-[var(--bg-primary)] border border-[var(--border-color)] rounded-lg px-3 py-2 text-xs text-[var(--text-primary)] placeholder-[var(--text-secondary)] outline-none focus:border-[var(--accent)] transition-colors"
          />
          <div className="space-y-2 max-h-80 overflow-y-auto pr-1">
            {filtered.map((entry) => (
              <AcpCatalogRow
                key={entry.id}
                entry={entry}
                enabled={enabledKeys.has(entry.id)}
                enabling={enablingId === entry.id}
                onEnable={() => void enable(entry)}
              />
            ))}
            {filtered.length === 0 && (
              <p className="text-xs text-[var(--text-secondary)] py-2">
                {t('settings.acpCatalogNoMatch')}
              </p>
            )}
          </div>
        </>
      )}

      {/* Manual launch configs (fallback / binary agents) */}
      <details className="rounded-xl border border-[var(--border-color)] bg-[var(--bg-primary)] px-3 py-2">
        <summary className="text-xs text-[var(--text-secondary)] cursor-pointer select-none">
          {t('settings.acpManual')}
        </summary>
        <div className="space-y-2 pt-2">
          {(manualAgents ?? acpAgents).map((a, i) => (
            <AcpAgentRow
              // Index, not a.key: the key field is editable, and keying on it
              // would remount the row (dropping input focus) every keystroke.
              // The list only appends/deletes in place, so index identity is
              // stable; row lookup in the handlers below still matches by value.
              key={i}
              agent={a}
              t={t}
              onChange={(next) =>
                setManualAgents(
                  (manualAgents ?? acpAgents).map((x) => (x.key === a.key ? next : x)),
                )
              }
              onDelete={() =>
                commitManual((manualAgents ?? acpAgents).filter((x) => x.key !== a.key))
              }
            />
          ))}
          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={addManual}
              className="text-xs text-[var(--accent)] hover:underline"
            >
              + {t('settings.acpAddAgent')}
            </button>
            {manualAgents && (
              <button
                type="button"
                disabled={saving || manualAgents.some((a) => !a.key || !a.command)}
                onClick={() => commitManual(manualAgents)}
                className="text-xs px-3 py-1.5 rounded-lg bg-[var(--accent)] text-white disabled:opacity-40"
              >
                {saving ? t('settings.acpSaving') : t('settings.acpSave')}
              </button>
            )}
          </div>
        </div>
      </details>
    </div>
  );
}
