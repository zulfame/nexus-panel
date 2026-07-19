import { cn } from "@/lib/utils";

const MAP = {
  running: { label: "RUNNING", color: "#00E676", dot: true },
  building: { label: "BUILDING", color: "#FFC400", dot: true, pulse: true },
  cloning: { label: "CLONING", color: "#FFC400", dot: true, pulse: true },
  stopped: { label: "STOPPED", color: "#71717A", dot: true },
  error: { label: "ERROR", color: "#FF3B30", dot: true },
  created: { label: "NOT DEPLOYED", color: "#71717A", dot: false },
};

export function StatusBadge({ status, className }) {
  const s = MAP[status] || MAP.created;
  return (
    <span
      data-testid={`status-badge-${status}`}
      className={cn(
        "inline-flex items-center gap-1.5 border px-2 py-0.5 text-[11px] font-mono font-medium tracking-wider",
        className
      )}
      style={{ color: s.color, borderColor: s.color + "55" }}
    >
      {s.dot && (
        <span
          className={cn("h-1.5 w-1.5 rounded-full", s.pulse && "animate-pulse-line")}
          style={{ backgroundColor: s.color }}
        />
      )}
      {s.label}
    </span>
  );
}
