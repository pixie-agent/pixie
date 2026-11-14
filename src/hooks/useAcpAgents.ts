import { useCallback, useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { AGENT_ENGINES, allEngines, type AcpAgentConfig, type AgentEngineId } from "../types";

/** App-wide "the ACP registry changed" signal. useChat listens for it to
 *  re-run check_engines_available, so a freshly enabled agent flows into
 *  engineStatuses → probe → readyEngineIds → pickers without a restart. */
export const ACP_AGENTS_CHANGED_EVENT = "pixie:acp-agents-changed";

// Module-level singleton + subscriber set: every hook instance shares one
// registry snapshot, so an edit in Settings is visible to pickers immediately.
let cachedAgents: AcpAgentConfig[] | null = null;
const listeners = new Set<(agents: AcpAgentConfig[]) => void>();
let inFlight: Promise<AcpAgentConfig[]> | null = null;

async function fetchAgents(): Promise<AcpAgentConfig[]> {
  try {
    const agents = await invoke<AcpAgentConfig[]>("list_acp_agents");
    return Array.isArray(agents) ? agents : [];
  } catch {
    // Backend unavailable (dev reload race): keep the previous cache —
    // empty on first load, which renders native engines only.
    return cachedAgents ?? [];
  }
}

/** Shared refresh: re-reads the registry, updates the shared cache, notifies
 *  every hook instance, and broadcasts the change event. Concurrent callers
 *  share one in-flight request. */
export async function refreshAcpAgents(): Promise<AcpAgentConfig[]> {
  if (!inFlight) {
    inFlight = fetchAgents().finally(() => {
      inFlight = null;
    });
  }
  const agents = await inFlight;
  // Order-independent key-set comparison: a spurious event would make useChat
  // re-run check_engines_available, resetting every engine's auth_state and
  // re-triggering billable readiness probes.
  const prevKeys = new Set((cachedAgents ?? []).map((a) => a.key));
  const nextKeys = new Set(agents.map((a) => a.key));
  const changed =
    cachedAgents === null ||
    prevKeys.size !== nextKeys.size ||
    [...nextKeys].some((k) => !prevKeys.has(k));
  cachedAgents = agents;
  for (const l of listeners) l(agents);
  if (changed) {
    window.dispatchEvent(new CustomEvent(ACP_AGENTS_CHANGED_EVENT));
  }
  return agents;
}

/**
 * Loads the backend ACP agent registry (one generic "meta-engine" entry per
 * protocol-compatible agent) and exposes the merged engine list — native
 * engines plus every registry agent. Registry entries are data, so new
 * engines appear without any frontend change (Zed's agent_servers model).
 *
 * State is shared module-wide: a registry edit in Settings propagates to all
 * mounted consumers on the next tick, not just the instance that saved.
 */
export function useAcpAgents() {
  const [acpAgents, setAcpAgents] = useState<AcpAgentConfig[]>(cachedAgents ?? []);

  useEffect(() => {
    const listener = (agents: AcpAgentConfig[]) => setAcpAgents(agents);
    listeners.add(listener);
    // First consumer to mount triggers the initial load; later ones reuse it.
    if (cachedAgents === null) void refreshAcpAgents();
    return () => {
      listeners.delete(listener);
    };
  }, []);

  const refresh = useCallback(() => refreshAcpAgents(), []);

  /** Native + ACP engines, ready for engine pickers. */
  const engines: { id: AgentEngineId; label: string }[] = allEngines(acpAgents);

  return { acpAgents, engines, nativeEngines: AGENT_ENGINES, refresh };
}
