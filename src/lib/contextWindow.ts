import type { AgentEngineId } from "../types";

/**
 * Static context window (tokens) for an engine/model pair. The engines don't
 * report their window over stream-json, so this is a best-effort map: Claude
 * family models default to 200k, with the "[1m]" suffix marking 1M-context
 * variants. Returns null when the window is unknown (indicator hidden).
 */
export function contextWindowFor(
  engine: AgentEngineId | undefined,
  model?: string,
): number | null {
  if (engine === "cursor" || engine === "codex") return null;
  if (engine === "claude" || engine === "codebuddy" || engine === "builtin") {
    if (model && model.includes("[1m]")) return 1_000_000;
    return 200_000;
  }
  return null;
}
