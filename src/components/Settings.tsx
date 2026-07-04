import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { getVersion } from "@tauri-apps/api/app";
import { useTranslation } from "../hooks/useTranslation";
import type { EngineStatus, AgentEngineId, EngineModelConfigs } from "../types";
import { AGENT_ENGINES, ENGINE_MODEL_FIELDS } from "../types";
import { engineLabel, modelFieldLabel, formatModShortcut } from "../lib/i18nFormat";
import { useUpdater } from "../hooks/useUpdater";
import { useDragRegion } from "../hooks/useDragRegion";
import LanguageSelector from "./LanguageSelector";

// Brand mark — same art as the app/README icon.
const iconUrl = new URL("../assets/icon.svg", import.meta.url).href;

interface SettingsProps {
  engineStatuses: EngineStatus[] | null;
  onRefreshStatus: () => void;
  /** Open the engine-setup modal (install / detect-ready / one-click login). */
  onOpenSetup: () => void;
  /** Engines that are installed + ready; the Preferred Engine picker is limited to these. */
  readyEngineIds: AgentEngineId[];
  defaultEngine: AgentEngineId;
  onDefaultEngineChange: (engine: AgentEngineId) => void;
  theme: "dark" | "light";
  onThemeChange: (theme: "dark" | "light") => void;
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
}

export default function Settings({
  engineStatuses,
  onRefreshStatus,
  onOpenSetup,
  readyEngineIds,
  defaultEngine,
  onDefaultEngineChange,
  theme,
  onThemeChange,
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
}: SettingsProps) {
  const { t } = useTranslation();
  const handleDragRegion = useDragRegion();
  const [_checking, setChecking] = useState(false);
  const [expandedEngines, setExpandedEngines] = useState<Record<AgentEngineId, boolean>>({
    claude: false,
    cursor: false,
    codebuddy: false,
    builtin: false,
    codex: false,
  });
  const updater = useUpdater();
  const [appVersion, setAppVersion] = useState("");

  useEffect(() => {
    getVersion().then(setAppVersion).catch(() => setAppVersion(""));
  }, []);

  const handleRefresh = async () => {
    setChecking(true);
    await onRefreshStatus();
    setChecking(false);
  };

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

        <div className="flex-1 overflow-y-auto p-5 space-y-6">
          {/* Agent engines */}
          <section>
            <h3 className="text-sm font-semibold text-[var(--text-primary)] mb-3">
              {t('settings.agentEngines')}
            </h3>
            <div className="space-y-3">
              {engineStatuses ? (
                engineStatuses.map((status) => {
                  const ready = status.available && status.auth_state === "ready";
                  const label = !status.available
                    ? t('engineSetup.status.notInstalled')
                    : ready
                      ? t('engineSetup.status.ready')
                      : status.auth_state === "unknown"
                        ? t('engineSetup.status.probing')
                        : t('engineSetup.status.notReady');
                  const dot = !status.available
                    ? "bg-red-400"
                    : ready
                      ? "bg-green-400"
                      : "bg-amber-400";
                  return (
                    <div
                      key={status.id}
                      className="flex items-center justify-between bg-[var(--bg-primary)] rounded-xl px-4 py-3 border border-[var(--border-color)]"
                    >
                      <div className="flex items-center gap-2 min-w-0">
                        <div className={`w-2.5 h-2.5 rounded-full shrink-0 ${dot}`} />
                        <span className="text-sm font-medium text-[var(--text-primary)] truncate">
                          {engineLabel(status.id, t)}
                        </span>
                      </div>
                      <span
                        className={`text-xs shrink-0 ${
                          ready ? "text-emerald-400" : "text-[var(--text-secondary)]"
                        }`}
                      >
                        {label}
                      </span>
                    </div>
                  );
                })
              ) : (
                <p className="text-sm text-[var(--text-secondary)]">{t('common.loading')}</p>
              )}
              <div className="flex gap-2">
                <button
                  onClick={onOpenSetup}
                  className="px-3 py-1.5 rounded-lg bg-[var(--accent)] hover:bg-[var(--accent-hover)] text-white text-xs font-medium transition-colors"
                >
                  {t('common.configure')}
                </button>
                <button
                  onClick={handleRefresh}
                  disabled={_checking}
                  className="px-3 py-1.5 rounded-lg bg-[var(--bg-tertiary)] hover:bg-[var(--accent)]/20 text-xs text-[var(--text-primary)] transition-colors disabled:opacity-50"
                >
                  {_checking ? t('updater.checking') : t('common.refresh')}
                </button>
              </div>
            </div>
          </section>

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
              {AGENT_ENGINES.filter((e) => readyEngineIds.includes(e.id)).map((e) => (
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
            <div className="flex gap-2">
              <button
                onClick={() => onThemeChange("dark")}
                className={`flex-1 py-2 px-3 rounded-lg text-sm font-medium transition-colors ${
                  theme === "dark"
                    ? "bg-[var(--accent)] text-white"
                    : "bg-[var(--bg-primary)] text-[var(--text-secondary)] border border-[var(--border-color)]"
                }`}
              >
                {t('settings.dark')}
              </button>
              <button
                onClick={() => onThemeChange("light")}
                className={`flex-1 py-2 px-3 rounded-lg text-sm font-medium transition-colors ${
                  theme === "light"
                    ? "bg-[var(--accent)] text-white"
                    : "bg-[var(--bg-primary)] text-[var(--text-secondary)] border border-[var(--border-color)]"
                }`}
              >
                {t('settings.light')}
              </button>
            </div>
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

          {/* Model Configuration (per engine, collapsed by default) */}
          <section>
            <h3 className="text-sm font-semibold text-[var(--text-primary)] mb-2">
              {t('settings.modelConfig')}
            </h3>
            <p className="text-xs text-[var(--text-secondary)] mb-3">
              {t('settings.modelConfigHint')}
            </p>
            <div className="space-y-2">
              {AGENT_ENGINES.map(({ id }) => {
                const expanded = expandedEngines[id];
                const fields = ENGINE_MODEL_FIELDS[id];
                const config = engineModelConfigs[id] as Record<string, string | undefined>;
                const filledCount = fields.filter((f) => config[f.key]?.trim()).length;
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
                        {fields.map(({ key, label: fieldLabel, secret }) => (
                          <div key={key}>
                            <label className="block text-xs text-[var(--text-secondary)] mb-1">
                              {modelFieldLabel(fieldLabel, t)}{" "}
                              <code className="text-[10px] opacity-60">{key}</code>
                            </label>
                            <input
                              type={secret ? "password" : "text"}
                              value={config[key] ?? ""}
                              onChange={(e) =>
                                onEngineModelConfigChange(id, {
                                  [key]: e.target.value || undefined,
                                })
                              }
                              placeholder={`$${key}`}
                              className="w-full bg-[var(--bg-secondary)] border border-[var(--border-color)] rounded-lg px-3 py-2 text-sm text-[var(--text-primary)] placeholder-[var(--text-secondary)] outline-none focus:border-[var(--accent)] transition-colors font-mono"
                            />
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
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

          {/* Keyboard shortcuts */}
          <section>
            <h3 className="text-sm font-semibold text-[var(--text-primary)] mb-3">
              {t('settings.keyboardShortcuts')}
            </h3>
            <div className="space-y-2 text-xs text-[var(--text-secondary)]">
              <div className="flex justify-between">
                <span>{t('settings.shortcuts.newChat')}</span>
                <kbd className="px-2 py-0.5 rounded bg-[var(--bg-primary)] border border-[var(--border-color)] text-[var(--text-primary)]">
                  {formatModShortcut(t, 'N')}
                </kbd>
              </div>
              <div className="flex justify-between">
                <span>{t('settings.shortcuts.stopGeneration')}</span>
                <kbd className="px-2 py-0.5 rounded bg-[var(--bg-primary)] border border-[var(--border-color)] text-[var(--text-primary)]">
                  {t('keys.escape')}
                </kbd>
              </div>
              <div className="flex justify-between">
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
              <div className="flex justify-between">
                <span>{t('settings.shortcuts.toggleSidebar')}</span>
                <kbd className="px-2 py-0.5 rounded bg-[var(--bg-primary)] border border-[var(--border-color)] text-[var(--text-primary)]">
                  {formatModShortcut(t, 'B')}
                </kbd>
              </div>
              <div className="flex justify-between">
                <span>{t('settings.shortcuts.toggleSearch')}</span>
                <kbd className="px-2 py-0.5 rounded bg-[var(--bg-primary)] border border-[var(--border-color)] text-[var(--text-primary)]">
                  {formatModShortcut(t, 'K')}
                </kbd>
              </div>
              <div className="flex justify-between">
                <span>{t('settings.shortcuts.toggleSettings')}</span>
                <kbd className="px-2 py-0.5 rounded bg-[var(--bg-primary)] border border-[var(--border-color)] text-[var(--text-primary)]">
                  {formatModShortcut(t, ',')}
                </kbd>
              </div>
            </div>
          </section>
        </div>
    </div>
  );
}
