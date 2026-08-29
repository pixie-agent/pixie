import { useState, useEffect, useCallback, useRef } from "react";
import { invoke } from "@tauri-apps/api/core";
import type { AgentEngineId, EngineModelConfigs, ModelEntry } from "../types";
import { AGENT_ENGINES, ENGINE_MODEL_ENV_KEY } from "../types";
import { engineLabel } from "../lib/i18nFormat";
import { useTranslation } from "../hooks/useTranslation";

export interface EngineModelPickerProps {
  /** Engines that are installed + ready; the picker is limited to these. */
  readyEngineIds: AgentEngineId[];
  engineModelConfigs: EngineModelConfigs;
  engine: AgentEngineId;
  onEngineChange: (engine: AgentEngineId) => void;
  /** undefined = use the engine's default model (Auto). */
  model?: string;
  onModelChange: (model: string | undefined) => void;
  disabled?: boolean;
  className?: string;
}

/**
 * Inline engine + model picker for application run surfaces. Mirrors the
 * chat InputBar / NewAgentModal behavior: engine select limited to ready
 * engines, model dropdown (Auto / list / custom id) fetched via list_models
 * with a stale-response guard and per-engine cache. The dropdown opens
 * upward because both call sites sit near the bottom of their panel.
 */
export default function EngineModelPicker({
  readyEngineIds,
  engineModelConfigs,
  engine,
  onEngineChange,
  model,
  onModelChange,
  disabled = false,
  className,
}: EngineModelPickerProps) {
  const { t } = useTranslation();
  const [availableModels, setAvailableModels] = useState<ModelEntry[]>([]);
  const [modelsLoading, setModelsLoading] = useState(false);
  const [customModel, setCustomModel] = useState("");
  const [modelDropdownOpen, setModelDropdownOpen] = useState(false);
  const modelWrapperRef = useRef<HTMLDivElement>(null);
  const modelReqSeqRef = useRef(0);
  const modelsCacheRef = useRef<Record<string, ModelEntry[]>>({});

  const fetchModels = useCallback((engineId: AgentEngineId) => {
    const seq = ++modelReqSeqRef.current;
    setModelsLoading(true);
    setAvailableModels(modelsCacheRef.current[engineId] ?? []);
    invoke<ModelEntry[]>("list_models", { engine: engineId })
      .then((models) => {
        if (seq !== modelReqSeqRef.current) return; // stale response
        const seen = new Set<string>();
        const deduped: ModelEntry[] = [];
        for (const m of models) {
          const id = (m.id ?? "").trim();
          if (!id || seen.has(id)) continue;
          seen.add(id);
          deduped.push({ ...m, id });
        }
        modelsCacheRef.current[engineId] = deduped;
        setAvailableModels(deduped);
        setModelsLoading(false);
      })
      .catch(() => {
        if (seq !== modelReqSeqRef.current) return; // stale response
        setAvailableModels([]);
        setModelsLoading(false);
      });
  }, []);

  // Invalidate any in-flight request on unmount.
  useEffect(() => {
    return () => {
      modelReqSeqRef.current += 1;
    };
  }, []);

  // Load models for the active engine (async to satisfy lint rule).
  useEffect(() => {
    if (!engine) return;
    const t = window.setTimeout(() => fetchModels(engine), 0);
    return () => window.clearTimeout(t);
  }, [engine, fetchModels]);

  // Refresh when the dropdown opens.
  useEffect(() => {
    if (!modelDropdownOpen || !engine) return;
    const t = window.setTimeout(() => fetchModels(engine), 0);
    return () => window.clearTimeout(t);
  }, [modelDropdownOpen, engine, fetchModels]);

  // Close the model dropdown when clicking outside of it.
  useEffect(() => {
    if (!modelDropdownOpen) return;
    const onDown = (e: PointerEvent) => {
      const target = e.target as Node;
      if (modelWrapperRef.current && !modelWrapperRef.current.contains(target)) {
        setModelDropdownOpen(false);
      }
    };
    const id = requestAnimationFrame(() => {
      document.addEventListener("pointerdown", onDown);
    });
    return () => {
      cancelAnimationFrame(id);
      document.removeEventListener("pointerdown", onDown);
    };
  }, [modelDropdownOpen]);

  const handleEngineChange = (next: AgentEngineId) => {
    setModelsLoading(true);
    setAvailableModels(modelsCacheRef.current[next] ?? []);
    setModelDropdownOpen(false);
    setCustomModel("");
    onEngineChange(next);
    onModelChange(undefined); // engine switch invalidates the model choice
  };

  const handleSelectModel = (modelId: string | undefined) => {
    onModelChange(modelId);
    setModelDropdownOpen(false);
  };

  const defaultModelLabel = (() => {
    const cfg = engineModelConfigs[engine] as Record<string, string | undefined> | undefined;
    const configured = cfg?.[ENGINE_MODEL_ENV_KEY[engine]];
    const trimmed = typeof configured === "string" ? configured.trim() : "";
    const id = trimmed || availableModels[0]?.id;
    if (!id) return t("common.auto");
    return availableModels.find((m) => m.id === id)?.label ?? id;
  })();

  const availableEngines = AGENT_ENGINES.filter((e) => readyEngineIds.includes(e.id));

  return (
    <div className={`flex items-center gap-1.5 ${className ?? ""}`}>
      <select
        value={engine}
        onChange={(e) => handleEngineChange(e.target.value as AgentEngineId)}
        disabled={disabled}
        className="h-7 rounded-md border border-[var(--border-color)] bg-[var(--bg-primary)] px-1.5 text-[11px] text-[var(--text-primary)] outline-none focus:border-[var(--accent)] disabled:opacity-50"
        aria-label={t("newAgent.engine")}
      >
        {availableEngines.map((e) => (
          <option key={e.id} value={e.id}>
            {engineLabel(e.id, t)}
          </option>
        ))}
      </select>
      <div ref={modelWrapperRef} className="relative min-w-0">
        <button
          type="button"
          disabled={disabled}
          onClick={() => setModelDropdownOpen((v) => !v)}
          title={t("inputBar.selectModel")}
          className={`flex h-7 max-w-[140px] items-center gap-1 rounded-md px-1.5 text-[11px] transition-colors disabled:opacity-50 ${
            model
              ? "bg-[var(--accent)]/10 text-[var(--accent)]"
              : "text-[var(--text-secondary)] hover:bg-[var(--bg-tertiary)] hover:text-[var(--text-primary)]"
          }`}
        >
          <span className="truncate">
            {model
              ? (availableModels.find((m) => m.id === model)?.label ?? model)
              : defaultModelLabel}
          </span>
          {modelsLoading && (
            <span className="shrink-0 text-[10px] text-[var(--text-secondary)]">…</span>
          )}
        </button>
        {modelDropdownOpen && (
          <div className="absolute bottom-full left-0 mb-1 w-52 rounded-lg border border-[var(--border-color)] bg-[var(--bg-secondary)] py-1 shadow-lg z-50 max-h-64 overflow-y-auto">
            <button
              type="button"
              onClick={() => handleSelectModel(undefined)}
              className={`w-full px-3 py-1.5 text-left text-xs transition-colors hover:bg-[var(--bg-tertiary)] ${
                !model ? "font-medium text-[var(--accent)]" : "text-[var(--text-primary)]"
              }`}
            >
              {defaultModelLabel} {t("inputBar.autoSuffix")}
            </button>
            {!modelsLoading && availableModels.length === 0 && (
              <div className="px-3 py-1.5 text-xs text-[var(--text-secondary)]">
                {t("newAgent.noModelsFound")}
              </div>
            )}
            {availableModels.map((m) => (
              <button
                key={m.id}
                type="button"
                onClick={() => handleSelectModel(m.id)}
                className={`w-full px-3 py-1.5 text-left text-xs transition-colors hover:bg-[var(--bg-tertiary)] ${
                  model === m.id ? "font-medium text-[var(--accent)]" : "text-[var(--text-primary)]"
                }`}
              >
                {m.label}
                {m.id !== m.label && (
                  <span className="ml-1.5 text-[var(--text-secondary)] opacity-60">{m.id}</span>
                )}
              </button>
            ))}
            <div className="mt-1 border-t border-[var(--border-color)] px-2 pt-1">
              <div className="flex items-center gap-1">
                <input
                  type="text"
                  value={customModel}
                  onChange={(e) => setCustomModel(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && customModel.trim()) {
                      e.preventDefault();
                      handleSelectModel(customModel.trim());
                    }
                  }}
                  placeholder={t("inputBar.customModelPlaceholder")}
                  className="flex-1 rounded border border-[var(--border-color)] bg-[var(--bg-primary)] px-2 py-1 text-xs text-[var(--text-primary)] outline-none placeholder:text-[var(--text-secondary)]/50 focus:border-[var(--accent)]"
                />
                {customModel.trim() && (
                  <button
                    type="button"
                    onClick={() => handleSelectModel(customModel.trim())}
                    className="shrink-0 text-[10px] text-[var(--accent)] hover:underline"
                  >
                    {t("common.apply")}
                  </button>
                )}
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
