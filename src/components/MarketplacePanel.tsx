import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { TFunction } from "i18next";
import { invoke } from "@tauri-apps/api/core";
import type {
  AgentEngineId,
  EngineModelConfigs,
  MarketplaceInfo,
  PixieApplicationEntry,
  PixieApplicationField,
  PixieApplicationRunRecord,
  PluginCatalog,
  PluginInfo,
} from "../types";
import { useDragRegion } from "../hooks/useDragRegion";
import { useTranslation } from "../hooks/useTranslation";
import EngineModelPicker from "./EngineModelPicker";
import type { ApplicationChatTarget } from "./ApplicationChat";
import {
  APPLICATION_RUN_MESSAGE_TYPE,
  APPLICATION_RUN_RESULT_MESSAGE_TYPE,
} from "../lib/applicationMessages";

interface MarketplacePanelProps {
  onClose: () => void;
  section: "skills" | "applications";
  /** Called after install/uninstall so App can refresh the ✨ skills dropdown. */
  onSkillsChanged: () => void;
  onStartApplicationStudio: (brief: string) => void;
  defaultEngine: AgentEngineId;
  /** Engines that are installed + ready; limits the application run picker. */
  readyEngineIds: AgentEngineId[];
  engineModelConfigs: EngineModelConfigs;
  /** One-shot: auto-expand this application once listed, then report back so
   *  the caller can clear it (otherwise reopening the view re-expands it). */
  openApplicationId?: string | null;
  onOpenedApplication?: () => void;
  /** Reports the app the system floating chat should attach to (null when no
   *  app is running in this host). */
  onAppChatTargetChange?: (target: ApplicationChatTarget | null) => void;
}

/** Seed marketplaces shown as tabs. Keyed by repo so "added" state is stable
 *  even when the marketplace's declared `name` differs from its repo. */
const SUGGESTED: { repo: string; tabKey: "official" | "knowledgeWork" | "plusSkills" | "composio" }[] = [
  { repo: "anthropics/claude-plugins-official", tabKey: "official" },
  { repo: "anthropics/knowledge-work-plugins", tabKey: "knowledgeWork" },
  { repo: "jeremylongshore/claude-code-plugins-plus-skills", tabKey: "plusSkills" },
  { repo: "ComposioHQ/awesome-claude-skills", tabKey: "composio" },
];

const CUSTOM_TAB = "__add_custom__";
const INSTALLED_TAB = "__installed__";

function formatCount(n: number | undefined, t: TFunction): string {
  if (!n) return "";
  if (n >= 1000) {
    const k = parseFloat((n / 1000).toFixed(1).replace(/\.0$/, ""));
    return t("marketplace.installsK", { count: k });
  }
  return t("marketplace.installs", { count: n });
}

function defaultFieldValue(field: PixieApplicationField): unknown {
  if (field.default !== undefined) return field.default;
  if (field.type === "boolean") return false;
  return "";
}

/** Coerce a stored input value to the field's declared type at the submission
 *  boundary. Values are edited as strings; a number field that is empty or
 *  non-numeric must not reach the backend as `""` or `NaN`. */
function coerceApplicationInputValue(field: PixieApplicationField, value: unknown): unknown {
  if (field.type !== "number") return value;
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value === "string") {
    const trimmed = value.trim();
    if (!trimmed) return field.default ?? null;
    const parsed = Number(trimmed);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return value;
}

function formatOutputValue(value: unknown): string {
  if (typeof value === "string") return value;
  return JSON.stringify(value, null, 2);
}

function applicationRunStatusLabel(status: string, t: TFunction): string {
  if (status === "ok") return t("marketplace.applications.statusOk");
  if (status === "error") return t("marketplace.applications.statusError");
  if (status === "output_contract_failed") return t("marketplace.applications.statusOutputContractFailed");
  if (status === "completed_with_parse_warning") return t("marketplace.applications.statusParseWarning");
  return status;
}

function applicationInputDefaults(app: PixieApplicationEntry): Record<string, unknown> {
  return Object.fromEntries(app.inputs.map((field) => [field.id, defaultFieldValue(field)]));
}

function applicationActionInputs(
  app: PixieApplicationEntry,
  actionId: string,
  values: Record<string, unknown> | undefined,
): Record<string, unknown> {
  const defaults = applicationInputDefaults(app);
  const source = values ?? defaults;
  const action = app.actions.find((item) => item.id === actionId);
  const allowed = new Set(action?.inputs?.length ? action.inputs : app.inputs.map((field) => field.id));
  const merged = Object.entries({ ...defaults, ...source }).filter(([key]) => allowed.has(key));
  return Object.fromEntries(
    merged.map(([key, value]) => {
      const field = app.inputs.find((item) => item.id === key);
      return [key, field ? coerceApplicationInputValue(field, value) : value];
    }),
  );
}

function latestApplicationRuns(
  runs: PixieApplicationRunRecord[],
): Record<string, PixieApplicationRunRecord> {
  return runs.reduce<Record<string, PixieApplicationRunRecord>>((acc, run) => {
    const current = acc[run.appId];
    if (!current || Date.parse(run.finishedAt) >= Date.parse(current.finishedAt)) {
      acc[run.appId] = run;
    }
    return acc;
  }, {});
}

export default function MarketplacePanel({ onClose, section, onSkillsChanged, onStartApplicationStudio, defaultEngine, readyEngineIds, engineModelConfigs, openApplicationId, onOpenedApplication, onAppChatTargetChange }: MarketplacePanelProps) {
  const { t } = useTranslation();
  const handleDragRegion = useDragRegion();
  const [marketplaces, setMarketplaces] = useState<MarketplaceInfo[]>([]);
  const [catalog, setCatalog] = useState<PluginCatalog>({ installed: [], available: [] });
  const [applications, setApplications] = useState<PixieApplicationEntry[]>([]);
  const [activeRepo, setActiveRepo] = useState<string>(SUGGESTED[0].repo);
  const [query, setQuery] = useState("");
  const [customSource, setCustomSource] = useState("");
  const [appGithubSource, setAppGithubSource] = useState("");
  const [appGithubBranch, setAppGithubBranch] = useState("");
  const [expandedAppId, setExpandedAppId] = useState<string | null>(null);
  const [appInputs, setAppInputs] = useState<Record<string, Record<string, unknown>>>({});
  const [appRunResults, setAppRunResults] = useState<Record<string, PixieApplicationRunRecord>>({});
  // Per-app engine/model selection for runs (in-memory only). Falling back to
  // the global default engine keeps behavior unchanged until the user picks.
  const [appRunEngines, setAppRunEngines] = useState<Record<string, AgentEngineId>>({});
  const [appRunModels, setAppRunModels] = useState<Record<string, string | undefined>>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  /** Action key of the in-flight operation, to disable overlapping actions. */
  const [busy, setBusy] = useState<string | null>(null);
  const [createOpen, setCreateOpen] = useState(false);
  const [applicationBrief, setApplicationBrief] = useState("");
  const [applicationContent, setApplicationContent] = useState<Record<string, string>>({});
  const [pendingOpenApplicationId, setPendingOpenApplicationId] = useState<string | null>(null);
  /** App id whose run view is expanded to a full-window overlay (Esc exits). */
  const [fullscreenAppId, setFullscreenAppId] = useState<string | null>(null);
  /** Bumped on iframe load so the chat-target effect can pick up the fresh
   *  contentWindow reference. */
  const [appFrameReadyTick, setAppFrameReadyTick] = useState(0);
  const applicationFrameRef = useRef<HTMLIFrameElement | null>(null);

  const reload = useCallback(async () => {
    setError(null);
    let nextError: string | null = null;
    const [marketplaceResult, pluginResult, applicationResult, applicationRunsResult] = await Promise.allSettled([
      invoke<string>("plugin_marketplace_list"),
      invoke<string>("plugin_available"),
      invoke<PixieApplicationEntry[]>("application_list"),
      invoke<PixieApplicationRunRecord[]>("application_runs"),
    ]);

    if (marketplaceResult.status === "fulfilled") {
      let parsedList: MarketplaceInfo[] = [];
      try {
        const a = JSON.parse(marketplaceResult.value);
        if (Array.isArray(a)) parsedList = a;
      } catch { /* ignore */ }
      setMarketplaces(parsedList);
    } else {
      nextError = String(marketplaceResult.reason);
      setMarketplaces([]);
    }

    if (pluginResult.status === "fulfilled") {
      let parsedCatalog: PluginCatalog = { installed: [], available: [] };
      try {
        const c = JSON.parse(pluginResult.value);
        if (c && Array.isArray(c.available)) parsedCatalog = c;
      } catch { /* ignore */ }
      setCatalog(parsedCatalog);
    } else {
      nextError = nextError ?? String(pluginResult.reason);
      setCatalog({ installed: [], available: [] });
    }

    if (applicationResult.status === "fulfilled") {
      setApplications(applicationResult.value);
    } else {
      nextError = nextError ?? String(applicationResult.reason);
      setApplications([]);
    }

    if (applicationRunsResult.status === "fulfilled") {
      setAppRunResults(latestApplicationRuns(applicationRunsResult.value));
    } else {
      nextError = nextError ?? String(applicationRunsResult.reason);
      setAppRunResults({});
    }

    setError(nextError);
    setLoading(false);
  }, []);

  useEffect(() => {
    // Initial load of marketplaces + catalog. Data fetching on mount is a
    // legitimate effect use; reload() also runs after each mutating action.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    reload();
  }, [reload]);

  const addedRepos = useMemo(() => new Set(marketplaces.map((m) => m.repo)), [marketplaces]);

  // Tabs = suggested + any custom-added marketplaces not in the suggested list.
  const tabs = useMemo(() => {
    const custom = marketplaces
      .filter((m) => !SUGGESTED.some((s) => s.repo === m.repo))
      .map((m) => ({ repo: m.repo, label: m.name }));
    return [
      ...SUGGESTED.map((s) => ({ repo: s.repo, label: t(`marketplace.tabs.${s.tabKey}`) })),
      ...custom,
    ];
  }, [marketplaces, t]);

  // Keep activeRepo valid as tabs change (e.g. after a remove).
  if (
    activeRepo !== INSTALLED_TAB &&
    activeRepo !== CUSTOM_TAB &&
    !tabs.some((t) => t.repo === activeRepo)
  ) {
    setActiveRepo(tabs[0]?.repo ?? CUSTOM_TAB);
  }

  const activeMarketplace = marketplaces.find((m) => m.repo === activeRepo);
  const activeName = activeMarketplace?.name;
  const isActiveAdded = activeMarketplace !== undefined;

  const installedIds = useMemo(
    () => new Set(catalog.installed.map((p) => p.pluginId)),
    [catalog.installed],
  );

  const plugins = useMemo(() => {
    if (!activeName) return [];
    return catalog.available
      .filter((p) => p.marketplaceName === activeName)
      .sort((a, b) => (b.installCount ?? 0) - (a.installCount ?? 0));
  }, [catalog.available, activeName]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return plugins;
    return plugins.filter(
      (p) => p.name.toLowerCase().includes(q) || p.description.toLowerCase().includes(q),
    );
  }, [plugins, query]);

  const addMarketplace = useCallback(
    async (source: string) => {
      const key = `add:${source}`;
      setBusy(key);
      setError(null);
      try {
        await invoke("plugin_marketplace_add", { source, scope: null });
        await reload();
      } catch (e) {
        setError(String(e));
      } finally {
        setBusy(null);
      }
    },
    [reload],
  );

  const removeMarketplace = useCallback(
    async (name: string) => {
      const key = `remove:${name}`;
      setBusy(key);
      setError(null);
      try {
        await invoke("plugin_marketplace_remove", { name });
        await reload();
      } catch (e) {
        setError(String(e));
      } finally {
        setBusy(null);
      }
    },
    [reload],
  );

  const install = useCallback(
    async (plugin: PluginInfo) => {
      const key = `install:${plugin.pluginId}`;
      setBusy(key);
      setError(null);
      try {
        await invoke("plugin_install", { pluginId: plugin.pluginId });
        await reload();
        onSkillsChanged();
      } catch (e) {
        setError(String(e));
      } finally {
        setBusy(null);
      }
    },
    [reload, onSkillsChanged],
  );

  const uninstall = useCallback(
    async (plugin: PluginInfo) => {
      const key = `uninstall:${plugin.name}`;
      setBusy(key);
      setError(null);
      try {
        await invoke("plugin_uninstall", { name: plugin.name });
        await reload();
        onSkillsChanged();
      } catch (e) {
        setError(String(e));
      } finally {
        setBusy(null);
      }
    },
    [reload, onSkillsChanged],
  );

  const handleAddCustom = () => {
    const src = customSource.trim();
    if (!src) return;
    void addMarketplace(src);
    setCustomSource("");
  };

  const installGithubApplication = useCallback(async () => {
    const source = appGithubSource.trim();
    if (!source) return;
    setBusy(`app-github:${source}`);
    setError(null);
    try {
      const entry = await invoke<PixieApplicationEntry>("application_install_github", {
        source,
        branch: appGithubBranch.trim() || null,
      });
      setAppGithubSource("");
      setAppGithubBranch("");
      setPendingOpenApplicationId(entry.id);
      await reload();
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(null);
    }
  }, [appGithubSource, appGithubBranch, reload]);

  const installLocalApplication = useCallback(
    async (link: boolean) => {
      setError(null);
      try {
        const path = await invoke<string | null>("pick_folder");
        if (!path) return;
        setBusy(link ? `app-link:${path}` : `app-local:${path}`);
        const entry = await invoke<PixieApplicationEntry>("application_install_local", { path, link });
        setPendingOpenApplicationId(entry.id);
        await reload();
      } catch (e) {
        setError(String(e));
      } finally {
        setBusy(null);
      }
    },
    [reload],
  );

  const openApplication = useCallback(async (id: string) => {
    setBusy(`app-open:${id}`);
    setError(null);
    try {
      const content = await invoke<string>("application_entry_content", { id });
      setApplicationContent((prev) => ({ ...prev, [id]: content }));
      setExpandedAppId(id);
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(null);
    }
  }, []);

  const autoOpenedApplicationRef = useRef<string | null>(null);
  useEffect(() => {
    if (!openApplicationId || autoOpenedApplicationRef.current === openApplicationId) return;
    if (!applications.some((app) => app.id === openApplicationId)) return;
    autoOpenedApplicationRef.current = openApplicationId;
    const timer = window.setTimeout(() => {
      void openApplication(openApplicationId);
      onOpenedApplication?.();
    }, 0);
    return () => window.clearTimeout(timer);
  }, [applications, openApplication, openApplicationId, onOpenedApplication]);

  useEffect(() => {
    if (!pendingOpenApplicationId) return;
    if (!applications.some((app) => app.id === pendingOpenApplicationId)) return;
    const id = pendingOpenApplicationId;
    const timer = window.setTimeout(() => {
      setPendingOpenApplicationId(null);
      void openApplication(id);
    }, 0);
    return () => window.clearTimeout(timer);
  }, [applications, openApplication, pendingOpenApplicationId]);

  // Resolve the engine a run should use: the app's picked engine if still
  // ready, else the global default if ready, else the first ready engine.
  const effectiveRunEngine = useCallback(
    (appId: string): AgentEngineId => {
      const picked = appRunEngines[appId];
      if (picked && readyEngineIds.includes(picked)) return picked;
      if (readyEngineIds.includes(defaultEngine)) return defaultEngine;
      return readyEngineIds[0] ?? defaultEngine;
    },
    [appRunEngines, defaultEngine, readyEngineIds],
  );

  // Keep picks readable through the handler closure without stale-state bugs.
  const appRunEnginesRef = useRef(appRunEngines);
  const appRunModelsRef = useRef(appRunModels);
  useEffect(() => {
    appRunEnginesRef.current = appRunEngines;
  }, [appRunEngines]);
  useEffect(() => {
    appRunModelsRef.current = appRunModels;
  }, [appRunModels]);

  // Esc exits the application fullscreen overlay (same interaction as the
  // right panel's fullscreen mode).
  useEffect(() => {
    if (!fullscreenAppId) return;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setFullscreenAppId(null);
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [fullscreenAppId]);

  // Report the running app to the system floating chat. The fullscreen app
  // wins over the inline one when both are set (only one iframe is live at a
  // time anyway — the inline copy is not rendered while fullscreen).
  useEffect(() => {
    if (section !== "applications") return;
    const activeId = fullscreenAppId ?? expandedAppId;
    const app = applications.find((a) => a.id === activeId);
    if (!app || !applicationContent[app.id]) {
      onAppChatTargetChange?.(null);
      return;
    }
    onAppChatTargetChange?.({
      kind: "marketplace",
      appId: app.id,
      appName: app.name,
      actions: app.actions,
      inputs: app.inputs,
      frameWindow: applicationFrameRef.current?.contentWindow ?? null,
    });
  }, [appFrameReadyTick, applications, expandedAppId, fullscreenAppId, applicationContent, onAppChatTargetChange, section]);

  useEffect(() => {
    const handleApplicationMessage = (event: MessageEvent) => {
      if (event.source !== applicationFrameRef.current?.contentWindow) return;
      const message = event.data as Record<string, unknown> | null;
      if (!message || message.type !== APPLICATION_RUN_MESSAGE_TYPE) return;
      if (typeof message.requestId !== "string" || typeof message.actionId !== "string") return;
      if (!message.inputs || typeof message.inputs !== "object" || Array.isArray(message.inputs)) return;
      const appId = expandedAppId;
      if (!appId) return;
      const picked = appRunEnginesRef.current[appId];
      const engine =
        picked && readyEngineIds.includes(picked)
          ? picked
          : readyEngineIds.includes(defaultEngine)
            ? defaultEngine
            : (readyEngineIds[0] ?? defaultEngine);
      void invoke<PixieApplicationRunRecord>("application_run", {
        id: appId,
        actionId: message.actionId,
        inputs: message.inputs,
        engine,
        model: appRunModelsRef.current[appId] ?? null,
      }).then((record) => {
        setAppRunResults((prev) => ({ ...prev, [appId]: record }));
        applicationFrameRef.current?.contentWindow?.postMessage({
          type: APPLICATION_RUN_RESULT_MESSAGE_TYPE,
          requestId: message.requestId,
          record,
        }, "*");
      }).catch((error) => {
        applicationFrameRef.current?.contentWindow?.postMessage({
          type: APPLICATION_RUN_RESULT_MESSAGE_TYPE,
          requestId: message.requestId,
          error: String(error),
        }, "*");
      });
    };
    window.addEventListener("message", handleApplicationMessage);
    return () => window.removeEventListener("message", handleApplicationMessage);
  }, [defaultEngine, expandedAppId, readyEngineIds]);

  const ensureApplicationInputs = useCallback((app: PixieApplicationEntry) => {
    setAppInputs((prev) => {
      if (prev[app.id]) return prev;
      return {
        ...prev,
        [app.id]: applicationInputDefaults(app),
      };
    });
  }, []);

  const updateApplicationInput = useCallback((appId: string, fieldId: string, value: unknown) => {
    setAppInputs((prev) => ({
      ...prev,
      [appId]: {
        ...(prev[appId] ?? {}),
        [fieldId]: value,
      },
    }));
  }, []);

  const runApplication = useCallback(
    async (app: PixieApplicationEntry, actionId: string) => {
      ensureApplicationInputs(app);
      setBusy(`app-run:${app.id}:${actionId}`);
      setError(null);
      try {
        const record = await invoke<PixieApplicationRunRecord>("application_run", {
          id: app.id,
          actionId,
          inputs: applicationActionInputs(app, actionId, appInputs[app.id]),
          engine: effectiveRunEngine(app.id),
          model: appRunModels[app.id] ?? null,
        });
        setAppRunResults((prev) => ({ ...prev, [app.id]: record }));
      } catch (e) {
        setError(String(e));
      } finally {
        setBusy(null);
      }
    },
    [appInputs, appRunModels, effectiveRunEngine, ensureApplicationInputs],
  );

  const uninstallApplication = useCallback(
    async (id: string) => {
      if (!window.confirm(t("marketplace.applications.uninstallConfirm"))) return;
      setBusy(`app-uninstall:${id}`);
      setError(null);
      try {
        await invoke("application_uninstall", { id });
        setFullscreenAppId(null);
        await reload();
      } catch (e) {
        setError(String(e));
      } finally {
        setBusy(null);
      }
    },
    [reload, t],
  );

  const renderApplicationInput = (app: PixieApplicationEntry, field: PixieApplicationField) => {
    const value = appInputs[app.id]?.[field.id] ?? defaultFieldValue(field);
    const label = field.label ?? field.id;
    const baseClass = "w-full bg-[var(--bg-secondary)] border border-[var(--border-color)] rounded-lg px-3 py-2 text-sm text-[var(--text-primary)] placeholder-[var(--text-secondary)] outline-none focus:border-[var(--accent)]";

    if (field.type === "boolean") {
      return (
        <label key={field.id} className="flex items-center gap-2 text-xs text-[var(--text-primary)]">
          <input
            type="checkbox"
            checked={Boolean(value)}
            onChange={(e) => updateApplicationInput(app.id, field.id, e.target.checked)}
          />
          <span>{label}</span>
        </label>
      );
    }

    return (
      <label key={field.id} className="grid gap-1">
        <span className="text-xs text-[var(--text-secondary)]">
          {label}{field.required ? " *" : ""}
        </span>
        {field.type === "textarea" ? (
          <textarea
            value={String(value ?? "")}
            onChange={(e) => updateApplicationInput(app.id, field.id, e.target.value)}
            rows={4}
            className={baseClass}
          />
        ) : field.type === "select" ? (
          <select
            value={String(value ?? "")}
            onChange={(e) => updateApplicationInput(app.id, field.id, e.target.value)}
            className={baseClass}
          >
            <option value="">{t("common.optional")}</option>
            {(field.options ?? []).map((option) => (
              <option key={option} value={option}>{option}</option>
            ))}
          </select>
        ) : (
          <input
            type={field.type === "number" ? "number" : "text"}
            value={String(value ?? "")}
            onChange={(e) => updateApplicationInput(app.id, field.id, e.target.value)}
            className={baseClass}
          />
        )}
      </label>
    );
  };

  return (
    <div className="settings-enter flex flex-col flex-1 min-h-0 bg-[var(--bg-primary)] overflow-hidden">
        {/* Fullscreen application overlay — the run iframe moves here (the
            inline copy is not rendered), keeping the postMessage channel and
            applicationFrameRef wired to a single live iframe. */}
        {fullscreenAppId && applications.some((app) => app.id === fullscreenAppId) && (
          <div className="fixed inset-0 z-50 flex flex-col bg-[var(--bg-primary)]">
            <div className="flex shrink-0 items-center gap-2 border-b border-[var(--border-color)] px-4 py-2.5">
              <span className="min-w-0 flex-1 truncate text-sm font-medium text-[var(--text-primary)]">
                {applications.find((app) => app.id === fullscreenAppId)?.name}
              </span>
              <button
                onClick={() => setFullscreenAppId(null)}
                title={t("rightPanel.exitFullscreen")}
                aria-label={t("rightPanel.exitFullscreen")}
                className="rounded-md p-1.5 text-[var(--text-secondary)] transition-colors hover:bg-[var(--bg-tertiary)] hover:text-[var(--text-primary)]"
              >
                <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
                  <path d="M5.5 1.5v3a1 1 0 0 1-1 1h-3M8.5 12.5v-3a1 1 0 0 1 1-1h3M12.5 5.5h-3a1 1 0 0 1-1-1v-3M1.5 8.5h3a1 1 0 0 1 1 1v3" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              </button>
            </div>
            <div className="min-h-0 flex-1 bg-white">
              <iframe
                ref={applicationFrameRef}
                title={applications.find((app) => app.id === fullscreenAppId)?.name ?? "Application"}
                srcDoc={applicationContent[fullscreenAppId] ?? ""}
                sandbox="allow-scripts"
                className="h-full w-full border-0"
                onLoad={() => setAppFrameReadyTick((v) => v + 1)}
              />
            </div>
          </div>
        )}

        {/* Header — drag empty areas to move window */}
        <div
          onMouseDown={handleDragRegion}
          className="shrink-0 flex items-center justify-between px-4 py-3 border-b border-[var(--border-color)]"
        >
          <h2 className="text-sm font-semibold text-[var(--text-primary)]">
            {section === "skills" ? t("marketplace.title") : t("marketplace.applications.title")}
          </h2>
          <button
            onClick={onClose}
            className="p-1.5 rounded-lg hover:bg-[var(--bg-tertiary)] text-[var(--text-secondary)] transition-colors"
            title={t("common.close")}
            aria-label={t("common.close")}
          >
            <svg width="18" height="18" viewBox="0 0 18 18" fill="none">
              <path d="M4 4l10 10M14 4L4 14" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
            </svg>
          </button>
        </div>

        {/* Tabs */}
        {section === "skills" && (
        <div className="shrink-0 flex items-center gap-1 px-2 border-b border-[var(--border-color)] overflow-x-auto">
          <button
            onClick={() => setActiveRepo(INSTALLED_TAB)}
            className={`shrink-0 px-3 py-2 text-xs font-medium border-b-2 transition-colors ${
              activeRepo === INSTALLED_TAB
                ? "border-[var(--accent)] text-[var(--text-primary)]"
                : "border-transparent text-[var(--text-secondary)] hover:text-[var(--text-primary)]"
            }`}
          >
            {t("marketplace.installed")}
            {catalog.installed.length > 0 && (
              <span className="ml-1.5 inline-block min-w-4 px-1 text-center text-[10px] rounded-full bg-[var(--bg-tertiary)] text-[var(--text-secondary)] align-middle">
                {catalog.installed.length}
              </span>
            )}
          </button>
          {tabs.map((t) => {
            const added = addedRepos.has(t.repo);
            const isActive = activeRepo === t.repo;
            return (
              <button
                key={t.repo}
                onClick={() => setActiveRepo(t.repo)}
                className={`shrink-0 px-3 py-2 text-xs font-medium border-b-2 transition-colors ${
                  isActive
                    ? "border-[var(--accent)] text-[var(--text-primary)]"
                    : "border-transparent text-[var(--text-secondary)] hover:text-[var(--text-primary)]"
                }`}
              >
                {t.label}
                {added ? (
                  <span className="ml-1.5 inline-block w-1.5 h-1.5 rounded-full bg-[var(--accent)] align-middle" />
                ) : null}
              </button>
            );
          })}
          <button
            onClick={() => setActiveRepo(CUSTOM_TAB)}
            className={`shrink-0 px-3 py-2 text-xs font-medium border-b-2 transition-colors ${
              activeRepo === CUSTOM_TAB
                ? "border-[var(--accent)] text-[var(--text-primary)]"
                : "border-transparent text-[var(--text-secondary)] hover:text-[var(--text-primary)]"
            }`}
            title={t("marketplace.addCustom")}
            aria-label={t("marketplace.addCustom")}
          >
            +
          </button>
        </div>
        )}

        {error && (
          <div className="shrink-0 px-4 py-2 bg-red-900/30 border-b border-red-800/50 text-red-300 text-xs flex items-start justify-between gap-3">
            <span className="break-words">{error}</span>
            <button onClick={() => setError(null)} className="shrink-0 text-red-400 hover:text-red-200">
              {t("common.dismiss")}
            </button>
          </div>
        )}

        {/* Body */}
        <div className="flex-1 overflow-y-auto">
          {section === "applications" ? (
            <div className="flex flex-col h-full">
              <div className="shrink-0 p-4 border-b border-[var(--border-color)]">
                <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
                  <div className="min-w-0">
                    <h3 className="text-sm font-medium text-[var(--text-primary)]">
                      {t("marketplace.applications.studioTitle")}
                    </h3>
                    <p className="text-xs text-[var(--text-secondary)] mt-0.5">
                      {t("marketplace.applications.studioHint")}
                    </p>
                  </div>
                  <button
                    onClick={() => setCreateOpen(true)}
                    className="px-4 py-2 rounded-lg bg-[var(--accent)] hover:bg-[var(--accent-hover)] text-white text-sm font-medium transition-colors"
                  >
                    {t("marketplace.applications.startStudio")}
                  </button>
                </div>
                <h3 className="text-sm font-medium text-[var(--text-primary)] mb-2">
                  {t("marketplace.applications.installTitle")}
                </h3>
                <div className="grid grid-cols-1 lg:grid-cols-[1fr_auto_auto] gap-2">
                  <input
                    value={appGithubSource}
                    onChange={(e) => setAppGithubSource(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") void installGithubApplication();
                    }}
                    placeholder={t("marketplace.applications.githubPlaceholder")}
                    className="min-w-0 bg-[var(--bg-secondary)] border border-[var(--border-color)] rounded-lg px-3 py-2 text-sm text-[var(--text-primary)] placeholder-[var(--text-secondary)] outline-none focus:border-[var(--accent)]"
                  />
                  <input
                    value={appGithubBranch}
                    onChange={(e) => setAppGithubBranch(e.target.value)}
                    placeholder={t("marketplace.applications.branchPlaceholder")}
                    className="min-w-32 bg-[var(--bg-secondary)] border border-[var(--border-color)] rounded-lg px-3 py-2 text-sm text-[var(--text-primary)] placeholder-[var(--text-secondary)] outline-none focus:border-[var(--accent)]"
                  />
                  <button
                    onClick={() => installGithubApplication()}
                    disabled={!appGithubSource.trim() || busy !== null}
                    className="px-4 py-2 rounded-lg bg-[var(--accent)] hover:bg-[var(--accent-hover)] disabled:opacity-40 disabled:cursor-not-allowed text-white text-sm font-medium transition-colors"
                  >
                    {busy?.startsWith("app-github:") ? "…" : t("marketplace.applications.installGithub")}
                  </button>
                </div>
                <div className="flex flex-wrap gap-2 mt-3">
                  <button
                    onClick={() => installLocalApplication(false)}
                    disabled={busy !== null}
                    className="px-3 py-1.5 rounded-lg text-xs bg-[var(--bg-tertiary)] text-[var(--text-primary)] hover:bg-[var(--bg-secondary)] disabled:opacity-50 transition-colors"
                  >
                    {t("marketplace.applications.installLocal")}
                  </button>
                  <button
                    onClick={() => installLocalApplication(true)}
                    disabled={busy !== null}
                    className="px-3 py-1.5 rounded-lg text-xs bg-[var(--bg-tertiary)] text-[var(--text-primary)] hover:bg-[var(--bg-secondary)] disabled:opacity-50 transition-colors"
                  >
                    {t("marketplace.applications.linkLocal")}
                  </button>
      </div>
      {createOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/55 p-4" onMouseDown={() => setCreateOpen(false)}>
          <div className="w-full max-w-lg rounded-xl border border-[var(--border-color)] bg-[var(--bg-primary)] p-5 shadow-2xl" onMouseDown={(event) => event.stopPropagation()}>
            <h3 className="text-base font-semibold text-[var(--text-primary)]">{t("marketplace.applications.createTitle")}</h3>
            <p className="mt-1 text-xs leading-relaxed text-[var(--text-secondary)]">{t("marketplace.applications.createHint")}</p>
            <textarea
              autoFocus
              value={applicationBrief}
              onChange={(event) => setApplicationBrief(event.target.value)}
              placeholder={t("marketplace.applications.createPlaceholder")}
              rows={6}
              className="mt-4 w-full resize-none rounded-lg border border-[var(--border-color)] bg-[var(--bg-secondary)] px-3 py-2 text-sm text-[var(--text-primary)] outline-none placeholder:text-[var(--text-secondary)] focus:border-[var(--accent)]"
            />
            <div className="mt-4 flex justify-end gap-2">
              <button onClick={() => setCreateOpen(false)} className="rounded-lg px-3 py-2 text-sm text-[var(--text-secondary)] hover:bg-[var(--bg-tertiary)]">{t("common.cancel")}</button>
              <button
                disabled={!applicationBrief.trim()}
                onClick={() => {
                  const brief = applicationBrief.trim();
                  setCreateOpen(false);
                  setApplicationBrief("");
                  onStartApplicationStudio(brief);
                }}
                className="rounded-lg bg-[var(--accent)] px-4 py-2 text-sm font-medium text-white disabled:opacity-40"
              >{t("marketplace.applications.chooseLocation")}</button>
            </div>
          </div>
        </div>
      )}
    </div>

              <div className="flex-1 overflow-y-auto">
                {loading ? (
                  <div className="px-4 py-8 text-center text-xs text-[var(--text-secondary)]">
                    {t("common.loading")}
                  </div>
                ) : applications.length === 0 ? (
                  <div className="px-4 py-8 text-center text-xs text-[var(--text-secondary)]">
                    {t("marketplace.applications.empty")}
                  </div>
                ) : (
                  applications.map((app) => {
                    const expanded = expandedAppId === app.id;
                    const result = appRunResults[app.id];
                    const primaryAction = app.actions[0];
                    return (
                      <div key={app.id} className="px-4 py-3 border-b border-[var(--border-color)]">
                        <div className="flex items-start gap-3">
                          <div className="flex-1 min-w-0">
                            <div className="flex flex-wrap items-center gap-2">
                              <span className="text-sm font-medium text-[var(--text-primary)] truncate">
                                {app.name}
                              </span>
                              {app.version && (
                                <span className="text-[10px] text-[var(--text-secondary)] opacity-70">
                                  v{app.version}
                                </span>
                              )}
                              <span className="text-[10px] px-1.5 py-0.5 rounded bg-[var(--bg-tertiary)] text-[var(--text-secondary)]">
                                {app.source.type}
                              </span>
                            </div>
                            {app.description && (
                              <p className="text-xs text-[var(--text-secondary)] mt-1 line-clamp-2">
                                {app.description}
                              </p>
                            )}
                            <div className="flex flex-wrap gap-1.5 mt-2">
                              {app.permissions.slice(0, 5).map((permission) => (
                                <span
                                  key={permission}
                                  className="text-[10px] px-1.5 py-0.5 rounded bg-[var(--bg-secondary)] text-[var(--text-secondary)]"
                                >
                                  {permission}
                                </span>
                              ))}
                              {app.permissions.length > 5 && (
                                <span className="text-[10px] text-[var(--text-secondary)]">
                                  +{app.permissions.length - 5}
                                </span>
                              )}
                            </div>
                            <p className="text-[10px] text-[var(--text-secondary)] opacity-60 mt-1 truncate">
                              {app.outputs.length} {t("marketplace.applications.outputs")} · {app.actions.length} {t("marketplace.applications.actions")}
                            </p>
                          </div>
                          <div className="shrink-0 flex items-center gap-2">
                            <button
                              onClick={() => {
                                ensureApplicationInputs(app);
                                if (expanded) setFullscreenAppId(null);
                                setExpandedAppId(expanded ? null : app.id);
                              }}
                              disabled={busy !== null}
                              className="px-3 py-1.5 rounded-lg text-xs bg-[var(--accent)] hover:bg-[var(--accent-hover)] disabled:opacity-50 text-white transition-colors"
                            >
                              {expanded ? t("marketplace.applications.hide") : t("marketplace.applications.use")}
                            </button>
                            <button
                              onClick={() => openApplication(app.id)}
                              disabled={busy !== null}
                              className="px-3 py-1.5 rounded-lg text-xs bg-[var(--bg-tertiary)] text-[var(--text-primary)] hover:bg-[var(--bg-secondary)] disabled:opacity-50 transition-colors"
                            >
                              {busy === `app-open:${app.id}` ? "…" : t("marketplace.applications.open")}
                            </button>
                            <button
                              onClick={() => uninstallApplication(app.id)}
                              disabled={busy !== null}
                              className="px-3 py-1.5 rounded-lg text-xs bg-[var(--bg-tertiary)] text-[var(--text-primary)] hover:text-red-400 disabled:opacity-50 transition-colors"
                            >
                              {busy === `app-uninstall:${app.id}` ? "…" : t("marketplace.uninstall")}
                            </button>
                          </div>
                        </div>
                        {expanded && (
                          <div className="mt-3 grid gap-3">
                            {applicationContent[app.id] && (
                              <div className="relative h-[560px] overflow-hidden rounded-xl border border-[var(--border-color)] bg-white">
                                {fullscreenAppId !== app.id && (
                                  <iframe
                                    ref={applicationFrameRef}
                                    title={app.name}
                                    srcDoc={applicationContent[app.id]}
                                    sandbox="allow-scripts"
                                    className="h-full w-full border-0"
                                    onLoad={() => setAppFrameReadyTick((v) => v + 1)}
                                  />
                                )}
                                <button
                                  onClick={() => setFullscreenAppId(app.id)}
                                  title={t("rightPanel.enterFullscreen")}
                                  aria-label={t("rightPanel.enterFullscreen")}
                                  className="absolute right-2 top-2 z-10 rounded-md bg-black/40 p-1.5 text-white/90 transition-colors hover:bg-black/60"
                                >
                                  <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
                                    <path d="M5.5 1.5h-4v4M8.5 12.5h4v-4M12.5 5.5v-4h-4M1.5 8.5v4h4" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
                                  </svg>
                                </button>
                              </div>
                            )}
                            {app.inputs.length > 0 && (
                              <div className="grid gap-2">
                                {app.inputs.map((field) => renderApplicationInput(app, field))}
                              </div>
                            )}
                            <div className="flex flex-wrap items-center gap-2">
                              <EngineModelPicker
                                readyEngineIds={readyEngineIds}
                                engineModelConfigs={engineModelConfigs}
                                engine={effectiveRunEngine(app.id)}
                                onEngineChange={(engine) =>
                                  setAppRunEngines((prev) => ({ ...prev, [app.id]: engine }))
                                }
                                model={appRunModels[app.id]}
                                onModelChange={(model) =>
                                  setAppRunModels((prev) => ({ ...prev, [app.id]: model }))
                                }
                                disabled={busy !== null}
                              />
                            </div>
                            <div className="flex flex-wrap gap-2">
                              {app.actions.map((action) => (
                                <button
                                  key={action.id}
                                  onClick={() => runApplication(app, action.id)}
                                  disabled={busy !== null || !primaryAction}
                                  className="px-3 py-1.5 rounded-lg text-xs bg-[var(--accent)] hover:bg-[var(--accent-hover)] disabled:opacity-50 text-white transition-colors"
                                >
                                  {busy === `app-run:${app.id}:${action.id}` ? "…" : (action.label ?? action.id)}
                                </button>
                              ))}
                            </div>
                            {result && (
                              <div className="rounded-lg border border-[var(--border-color)] bg-[var(--bg-secondary)] p-3">
                                <div className="mb-2 flex items-center justify-between gap-2">
                                  <span className="text-xs font-medium text-[var(--text-primary)]">
                                    {t("marketplace.applications.lastResult")}
                                  </span>
                                  <span className="text-[10px] text-[var(--text-secondary)]">
                                    {applicationRunStatusLabel(result.status, t)} · {result.engine}
                                    {result.model ? ` · ${result.model}` : ""}
                                  </span>
                                </div>
                                <div className="grid gap-2">
                                  {result.error && (
                                    <div className={`text-xs break-words ${result.status === "completed_with_parse_warning" ? "text-yellow-300" : "text-red-300"}`}>
                                      {result.error ?? t("marketplace.applications.runFailed")}
                                    </div>
                                  )}
                                  {Object.entries(result.outputs).map(([key, value]) => (
                                    <div key={key}>
                                      <div className="text-[10px] uppercase text-[var(--text-secondary)]">{key}</div>
                                      <pre className="mt-1 whitespace-pre-wrap break-words text-xs text-[var(--text-primary)] font-sans">
                                        {formatOutputValue(value)}
                                      </pre>
                                    </div>
                                  ))}
                                </div>
                              </div>
                            )}
                          </div>
                        )}
                      </div>
                    );
                  })
                )}
              </div>
            </div>
          ) : activeRepo === INSTALLED_TAB ? (
            <div className="flex flex-col h-full">
              {catalog.installed.length === 0 ? (
                <div className="px-4 py-8 text-center text-xs text-[var(--text-secondary)]">
                  {t("marketplace.noSkills")}
                </div>
              ) : (
                catalog.installed.map((p) => (
                  <div
                    key={p.pluginId}
                    className="px-4 py-2.5 border-b border-[var(--border-color)] flex items-start gap-3"
                  >
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="text-sm font-medium text-[var(--text-primary)] truncate">
                          {p.name}
                        </span>
                        {p.version && (
                          <span className="text-[10px] text-[var(--text-secondary)] opacity-70">
                            v{p.version}
                          </span>
                        )}
                      </div>
                      {p.description && (
                        <p className="text-xs text-[var(--text-secondary)] mt-0.5 line-clamp-2">
                          {p.description}
                        </p>
                      )}
                      {p.marketplaceName && (
                        <p className="text-[10px] text-[var(--text-secondary)] opacity-60 mt-0.5">
                          {p.marketplaceName}
                        </p>
                      )}
                    </div>
                    <button
                      onClick={() => uninstall(p)}
                      disabled={busy !== null}
                      className="shrink-0 px-3 py-1.5 rounded-lg text-xs bg-[var(--bg-tertiary)] text-[var(--text-primary)] hover:text-red-400 disabled:opacity-50 transition-colors"
                    >
                      {busy === `uninstall:${p.name}` ? "…" : t("marketplace.uninstall")}
                    </button>
                  </div>
                ))
              )}
            </div>
          ) : activeRepo === CUSTOM_TAB ? (
            <div className="p-6">
              <h3 className="text-sm font-medium text-[var(--text-primary)] mb-2">
                {t("marketplace.addCustom")}
              </h3>
              <p className="text-xs text-[var(--text-secondary)] mb-4">
                {t("marketplace.customHint")}
              </p>
              <div className="flex gap-2">
                <input
                  value={customSource}
                  onChange={(e) => setCustomSource(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") handleAddCustom();
                  }}
                  placeholder={t("marketplace.customPlaceholder")}
                  className="flex-1 bg-[var(--bg-secondary)] border border-[var(--border-color)] rounded-lg px-3 py-2 text-sm text-[var(--text-primary)] placeholder-[var(--text-secondary)] outline-none focus:border-[var(--accent)]"
                />
                <button
                  onClick={handleAddCustom}
                  disabled={!customSource.trim() || busy !== null}
                  className="px-4 py-2 rounded-lg bg-[var(--accent)] hover:bg-[var(--accent-hover)] disabled:opacity-40 disabled:cursor-not-allowed text-white text-sm font-medium transition-colors"
                >
                  {t("marketplace.addMarketplace")}
                </button>
              </div>
            </div>
          ) : !isActiveAdded ? (
            <div className="flex flex-col items-center justify-center h-full px-6 text-center">
              <p className="text-sm text-[var(--text-secondary)] mb-4">
                {t("marketplace.addCustom")}
              </p>
              <button
                onClick={() => addMarketplace(activeRepo)}
                disabled={busy !== null}
                className="px-4 py-2 rounded-lg bg-[var(--accent)] hover:bg-[var(--accent-hover)] disabled:opacity-50 text-white text-sm font-medium transition-colors"
              >
                {busy === `add:${activeRepo}` ? t("marketplace.adding") : t("marketplace.addMarketplace")}
              </button>
            </div>
          ) : (
            <div className="flex flex-col h-full">
              {/* Toolbar */}
              <div className="shrink-0 flex items-center gap-2 px-4 py-2 border-b border-[var(--border-color)]">
                <input
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder={t("marketplace.search")}
                  className="flex-1 bg-[var(--bg-secondary)] border border-[var(--border-color)] rounded-lg px-3 py-1.5 text-sm text-[var(--text-primary)] placeholder-[var(--text-secondary)] outline-none focus:border-[var(--accent)]"
                />
                <button
                  onClick={() => activeMarketplace && removeMarketplace(activeMarketplace.name)}
                  disabled={busy !== null}
                  className="shrink-0 px-3 py-1.5 rounded-lg text-xs text-[var(--text-secondary)] hover:bg-[var(--bg-tertiary)] hover:text-red-400 disabled:opacity-40 transition-colors"
                  title={t("marketplace.removeMarketplace")}
                  aria-label={t("marketplace.removeMarketplace")}
                >
                  {busy === `remove:${activeMarketplace?.name}` ? t("marketplace.removing") : t("common.remove")}
                </button>
              </div>

              {/* List */}
              <div className="flex-1 overflow-y-auto">
                {loading ? (
                  <div className="px-4 py-8 text-center text-xs text-[var(--text-secondary)]">
                    {t("common.loading")}
                  </div>
                ) : filtered.length === 0 ? (
                  <div className="px-4 py-8 text-center text-xs text-[var(--text-secondary)]">
                    {query ? t("marketplace.noPluginsMatch") : t("marketplace.noPluginsInMarketplace")}
                  </div>
                ) : (
                  filtered.map((p) => {
                    const installed = installedIds.has(p.pluginId);
                    return (
                      <div
                        key={p.pluginId}
                        className="px-4 py-2.5 border-b border-[var(--border-color)] flex items-start gap-3"
                      >
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2">
                            <span className="text-sm font-medium text-[var(--text-primary)] truncate">
                              {p.name}
                            </span>
                            {p.version && (
                              <span className="text-[10px] text-[var(--text-secondary)] opacity-70">
                                v{p.version}
                              </span>
                            )}
                          </div>
                          {p.description && (
                            <p className="text-xs text-[var(--text-secondary)] mt-0.5 line-clamp-2">
                              {p.description}
                            </p>
                          )}
                          <p className="text-[10px] text-[var(--text-secondary)] opacity-60 mt-0.5">
                            {formatCount(p.installCount, t)}
                          </p>
                        </div>
                        {installed ? (
                          <button
                            onClick={() => uninstall(p)}
                            disabled={busy !== null}
                            className="shrink-0 px-3 py-1.5 rounded-lg text-xs bg-[var(--bg-tertiary)] text-[var(--text-primary)] hover:text-red-400 disabled:opacity-50 transition-colors"
                          >
                            {busy === `uninstall:${p.name}` ? "…" : t("marketplace.uninstall")}
                          </button>
                        ) : (
                          <button
                            onClick={() => install(p)}
                            disabled={busy !== null}
                            className="shrink-0 px-3 py-1.5 rounded-lg text-xs bg-[var(--accent)] hover:bg-[var(--accent-hover)] disabled:opacity-50 text-white transition-colors"
                          >
                            {busy === `install:${p.pluginId}` ? "…" : t("marketplace.install")}
                          </button>
                        )}
                      </div>
                    );
                  })
                )}
              </div>
            </div>
          )}
        </div>
    </div>
  );
}
