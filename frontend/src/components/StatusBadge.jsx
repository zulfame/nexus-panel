import { cn } from "@/lib/utils";

const MAP = {
  running: { label: "RUNNING", cls: "bg-emerald-500/10 text-emerald-400 border-emerald-500/25", dot: "#10B981", ping: true },
  building: { label: "BUILDING", cls: "bg-amber-500/10 text-amber-400 border-amber-500/25", dot: "#F59E0B", ping: true },
  cloning: { label: "CLONING", cls: "bg-amber-500/10 text-amber-400 border-amber-500/25", dot: "#F59E0B", ping: true },
  stopped: { label: "STOPPED", cls: "bg-zinc-500/10 text-zinc-400 border-zinc-500/25", dot: "#71717A" },
  error: { label: "ERROR", cls: "bg-red-500/10 text-red-400 border-red-500/25", dot: "#EF4444" },
  created: { label: "NOT DEPLOYED", cls: "bg-blue-500/10 text-blue-400 border-blue-500/25", dot: "#3B82F6" },
};

export function StatusBadge({ status, className }) {
  const s = MAP[status] || MAP.created;
  return (
    <span
      data-testid={`status-badge-${status}`}
      className={cn(
        "inline-flex items-center gap-1.5 rounded-sm border px-2 py-0.5 text-[10px] font-medium uppercase tracking-wider",
        s.cls,
        className
      )}
    >
      <span className="relative flex h-1.5 w-1.5">
        {s.ping && (
          <span
            className="absolute inline-flex h-full w-full animate-ping rounded-full opacity-75"
            style={{ backgroundColor: s.dot }}
          />
        )}
        <span className="relative inline-flex h-1.5 w-1.5 rounded-full" style={{ backgroundColor: s.dot }} />
      </span>
      {s.label}
    </span>
  );
}
