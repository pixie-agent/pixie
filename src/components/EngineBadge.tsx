import type { AgentEngineId } from "../types";
import { AGENT_ENGINES } from "../types";

function engineAbbr(id: AgentEngineId): string {
  if (id === "claude") return "Cl";
  if (id === "cursor") return "Cu";
  return "Cb";
}

function engineColorClasses(id: AgentEngineId): string {
  if (id === "claude") return "bg-violet-500/15 text-violet-300 ring-violet-400/30";
  if (id === "cursor") return "bg-emerald-500/15 text-emerald-300 ring-emerald-400/30";
  return "bg-amber-500/15 text-amber-300 ring-amber-400/30";
}

export default function EngineBadge({
  engine,
  showLabel = false,
  className = "",
}: {
  engine: AgentEngineId;
  showLabel?: boolean;
  className?: string;
}) {
  const label = AGENT_ENGINES.find((e) => e.id === engine)?.label ?? engine;
  const abbr = engineAbbr(engine);
  const colors = engineColorClasses(engine);
  return (
    <span
      className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded-md text-[10px] leading-none ring-1 ${colors} ${className}`}
      title={label}
      aria-label={label}
    >
      <span className="font-mono font-semibold tracking-tight">{abbr}</span>
      {showLabel && <span className="truncate max-w-[120px]">{label}</span>}
    </span>
  );
}

