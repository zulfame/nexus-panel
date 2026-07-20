import { cn } from "@/lib/utils";

const STATE_MAP = {
  running: { label: "up", dot: "#10B981", cls: "text-emerald-400 border-emerald-500/25 bg-emerald-500/10", ping: true },
  restarting: { label: "restarting", dot: "#F59E0B", cls: "text-amber-400 border-amber-500/25 bg-amber-500/10", ping: true },
  exited: { label: "exited", dot: "#EF4444", cls: "text-red-400 border-red-500/25 bg-red-500/10" },
  dead: { label: "dead", dot: "#EF4444", cls: "text-red-400 border-red-500/25 bg-red-500/10" },
  paused: { label: "paused", dot: "#71717A", cls: "text-zinc-400 border-zinc-500/25 bg-zinc-500/10" },
  created: { label: "created", dot: "#3B82F6", cls: "text-blue-400 border-blue-500/25 bg-blue-500/10" },
};

function stateInfo(state) {
  return STATE_MAP[state] || { label: state || "unknown", dot: "#71717A", cls: "text-zinc-400 border-zinc-500/25 bg-zinc-500/10" };
}

// Full per-container chips (used on the project detail page)
export function ContainerHealth({ containers = [], testid = "container-health" }) {
  if (!containers.length) {
    return (
      <span data-testid={`${testid}-empty`} className="font-mono text-xs text-muted-foreground">
        no container info (deploy on the VPS to see live health)
      </span>
    );
  }
  return (
    <div data-testid={testid} className="flex flex-wrap items-center gap-2">
      {containers.map((c) => {
        const s = stateInfo(c.state);
        return (
          <span
            key={c.name || c.service}
            data-testid={`${testid}-${c.service}`}
            title={c.status}
            className={cn(
              "inline-flex items-center gap-1.5 rounded-sm border px-2 py-1 font-mono text-[11px]",
              s.cls
            )}
          >
            <span className="relative flex h-1.5 w-1.5">
              {s.ping && (
                <span className="absolute inline-flex h-full w-full animate-ping rounded-full opacity-75" style={{ backgroundColor: s.dot }} />
              )}
              <span className="relative inline-flex h-1.5 w-1.5 rounded-full" style={{ backgroundColor: s.dot }} />
            </span>
            <span className="font-medium">{c.service}</span>
            <span className="text-muted-foreground">·</span>
            <span className="uppercase tracking-wide">{s.label}</span>
            {c.health && c.health !== "" && <span className="text-muted-foreground">({c.health})</span>}
          </span>
        );
      })}
    </div>
  );
}

// Compact dot row (used on the dashboard table)
export function ContainerDots({ containers = [], testid = "container-dots" }) {
  if (!containers.length) {
    return <span data-testid={`${testid}-empty`} className="font-mono text-xs text-muted-foreground/50">—</span>;
  }
  return (
    <div data-testid={testid} className="flex items-center gap-1.5">
      {containers.map((c) => {
        const s = stateInfo(c.state);
        return (
          <span
            key={c.name || c.service}
            data-testid={`${testid}-${c.service}`}
            title={`${c.service}: ${c.status || c.state}`}
            className="h-2 w-2 rounded-full"
            style={{ backgroundColor: s.dot }}
          />
        );
      })}
    </div>
  );
}
