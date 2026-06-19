import { useMemo, useState, useEffect, useCallback } from "react";
import { invoke } from "@tauri-apps/api/core";
import type { AgentEngineId, EngineModelConfigs, EngineStatus, ModelEntry, WorkspaceState } from "../types";
import { AGENT_ENGINES, ENGINE_MODEL_ENV_KEY } from "../types";
import EngineBadge from "./EngineBadge";

function workspaceLabel(workspaces: WorkspaceState[], id: string): string {
  return workspaces.find((w) => w.id === id)?.name ?? id.split("/").pop() ?? id;
}

export default function NewAgentModal({
  workspaces,
  defaultWorkspaceId,
  defaultWorkspacePath,
  defaultEngine,
  engineStatuses,
  engineModelConfigs,
  onDefaultEngineChange,
  onCreate,
  onClose,
}: {
  workspaces: WorkspaceState[];
  defaultWorkspaceId: string | null;
  /** Used only for "(default)" labeling. */
  defaultWorkspacePath: string;
  defaultEngine: AgentEngineId;
  engineStatuses: EngineStatus[];
  engineModelConfigs: EngineModelConfigs;
  onDefaultEngineChange: (engine: AgentEngineId) => void;
  onCreate: (opts: { workspaceId: string; engine: AgentEngineId; model?: string }) => void;
  onClose: () => void;
}) {
  const availableEngines = useMemo(() => {
    const available = new Set(engineStatuses.filter((s) => s.available).map((s) => s.id));
    return AGENT_ENGINES.filter((e) => available.has(e.id));
  }, [engineStatuses]);

  const firstAvailableEngine = availableEngines[0]?.id ?? defaultEngine;
  const firstWorkspace = workspaces[0]?.id ?? "";

  const [selectedWorkspaceId, setSelectedWorkspaceId] = useState<string>(
    () => defaultWorkspaceId ?? firstWorkspace
  );
  const [selectedEngine, setSelectedEngine] = useState<AgentEngineId>(() => {
    const isDefaultAvailable = engineStatuses.some((s) => s.id === defaultEngine && s.available);
    return isDefaultAvailable ? defaultEngine : firstAvailableEngine;
  });
  const [selectedModel, setSelectedModel] = useState<string | undefined>(undefined);
  const [setAsDefaultEngine, setSetAsDefaultEngine] = useState(false);
  const [availableModels, setAvailableModels] = useState<ModelEntry[]>([]);
  const [customModel, setCustomModel] = useState("");

  const fetchModels = useCallback((engine: AgentEngineId) => {
    invoke<ModelEntry[]>("list_models", { engine })
      .then((models) => {
        const seen = new Set<string>();
        const deduped: ModelEntry[] = [];
        for (const m of models) {
          const id = (m.id ?? "").trim();
          if (!id || seen.has(id)) continue;
          seen.add(id);
          deduped.push({ ...m, id });
        }
        setAvailableModels(deduped);
      })
      .catch(() => setAvailableModels([]));
  }, []);

  // Load models on mount and when engine changes.
  useEffect(() => {
    fetchModels(selectedEngine);
  }, [selectedEngine, fetchModels]);

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [onClose]);

  const wsLabel = selectedWorkspaceId ? workspaceLabel(workspaces, selectedWorkspaceId) : "";
  const modelSummary =
    selectedModel === "__custom__"
      ? (customModel.trim() || "Custom")
      : (selectedModel || "");

  const defaultModelFromConfig = (() => {
    const cfg = engineModelConfigs[selectedEngine] as Record<string, string | undefined>;
    return cfg?.[ENGINE_MODEL_ENV_KEY[selectedEngine]];
  })();

  const canCreate = !!selectedWorkspaceId && !!selectedEngine;

  return (
    <div
      className="fixed inset-0 z-50 bg-black/60 flex items-center justify-center p-4"
      onMouseDown={onClose}
    >
      <div
        className="w-full max-w-lg bg-[var(--bg-secondary)] border border-[var(--border-color)] rounded-2xl shadow-xl overflow-hidden"
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div className="px-4 py-3 border-b border-[var(--border-color)] flex items-center justify-between">
          <div className="min-w-0">
            <div className="text-sm font-semibold text-[var(--text-primary)]">New Agent</div>
            <div className="text-[10px] text-[var(--text-secondary)] truncate" title={selectedWorkspaceId}>
              <EngineBadge engine={selectedEngine} />
              <span className="mx-1">·</span>
              {wsLabel}
              {defaultWorkspacePath && selectedWorkspaceId === defaultWorkspacePath ? " (default)" : ""}
              {modelSummary ? (
                <>
                  <span className="mx-1">·</span>
                  <span className="text-[var(--accent)]/80">{modelSummary}</span>
                </>
              ) : null}
            </div>
          </div>
          <button
            type="button"
            className="p-1 rounded-lg hover:bg-[var(--bg-tertiary)] text-[var(--text-secondary)] hover:text-[var(--text-primary)] transition-colors"
            onClick={onClose}
            title="Close"
          >
            <svg width="14" height="14" viewBox="0 0 12 12" fill="none">
              <path d="M3 3l6 6M9 3l-6 6" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
            </svg>
          </button>
        </div>

        <div className="px-4 py-3 space-y-3">
          <div className="space-y-1">
            <div className="text-[10px] uppercase tracking-wide text-[var(--text-secondary)] font-medium">Workspace</div>
            <select
              value={selectedWorkspaceId}
              onChange={(e) => setSelectedWorkspaceId(e.target.value)}
              className="w-full text-xs rounded-lg px-3 py-2 bg-[var(--bg-primary)] border border-[var(--border-color)] text-[var(--text-primary)]"
              title={selectedWorkspaceId}
            >
              {workspaces.map((ws) => (
                <option key={ws.id} value={ws.id}>
                  {ws.name}{defaultWorkspacePath && ws.id === defaultWorkspacePath ? " (default)" : ""}
                </option>
              ))}
            </select>
            {selectedWorkspaceId && (
              <div className="text-[10px] text-[var(--text-secondary)] truncate" title={selectedWorkspaceId}>
                {selectedWorkspaceId}
              </div>
            )}
          </div>

          <div className="space-y-1">
            <div className="text-[10px] uppercase tracking-wide text-[var(--text-secondary)] font-medium">Engine</div>
            <select
              value={selectedEngine}
              onChange={(e) => {
                const next = e.target.value as AgentEngineId;
                setSelectedEngine(next);
                setSelectedModel(undefined);
                setCustomModel("");
              }}
              className="w-full text-xs rounded-lg px-3 py-2 bg-[var(--bg-primary)] border border-[var(--border-color)] text-[var(--text-primary)]"
            >
              {AGENT_ENGINES.map((e) => {
                const s = engineStatuses.find((x) => x.id === e.id);
                const suffix = s?.available ? "" : " (unavailable)";
                return (
                  <option key={e.id} value={e.id} disabled={!s?.available}>
                    {e.label}{suffix}
                  </option>
                );
              })}
            </select>

            <label className="flex items-center gap-2 text-xs text-[var(--text-secondary)] select-none">
              <input
                type="checkbox"
                checked={setAsDefaultEngine}
                onChange={(e) => setSetAsDefaultEngine(e.target.checked)}
              />
              Set as default engine
            </label>
          </div>

          <div className="space-y-1">
            <div className="text-[10px] uppercase tracking-wide text-[var(--text-secondary)] font-medium">Model (optional)</div>
            <select
              value={selectedModel ?? ""}
              onChange={(e) => {
                const v = e.target.value;
                setSelectedModel(v ? v : undefined);
                setCustomModel("");
              }}
              className="w-full text-xs rounded-lg px-3 py-2 bg-[var(--bg-primary)] border border-[var(--border-color)] text-[var(--text-primary)]"
            >
              <option value="">
                Default{defaultModelFromConfig ? ` (${defaultModelFromConfig})` : ""}
              </option>
              {availableModels.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.label}
                </option>
              ))}
              <option value="__custom__">Custom…</option>
            </select>

            {(selectedModel === "__custom__" || customModel) && (
              <input
                value={customModel}
                onChange={(e) => setCustomModel(e.target.value)}
                placeholder="Custom model id (e.g. gpt-5.5-medium)"
                className="w-full text-xs rounded-lg px-3 py-2 bg-[var(--bg-primary)] border border-[var(--border-color)] text-[var(--text-primary)] placeholder:text-[var(--text-secondary)]/60 outline-none focus:border-[var(--accent)]"
              />
            )}
            <div className="text-[10px] text-[var(--text-secondary)]">
              You can also change the model later from the composer.
            </div>
          </div>
        </div>

        <div className="px-4 py-3 border-t border-[var(--border-color)] flex items-center justify-between gap-2">
          <button
            type="button"
            onClick={onClose}
            className="px-3 py-2 rounded-lg bg-[var(--bg-tertiary)] text-[var(--text-primary)] text-xs hover:opacity-90 transition-opacity"
          >
            Cancel
          </button>
          <button
            type="button"
            disabled={!canCreate}
            onClick={() => {
              const model =
                selectedModel === "__custom__"
                  ? customModel.trim() || undefined
                  : selectedModel || undefined;
              if (setAsDefaultEngine) onDefaultEngineChange(selectedEngine);
              onCreate({ workspaceId: selectedWorkspaceId, engine: selectedEngine, model });
              onClose();
            }}
            className="px-3 py-2 rounded-lg bg-[var(--accent)] hover:bg-[var(--accent-hover)] disabled:opacity-30 disabled:cursor-not-allowed text-white text-xs font-medium transition-colors"
          >
            Create
          </button>
        </div>
      </div>
    </div>
  );
}

