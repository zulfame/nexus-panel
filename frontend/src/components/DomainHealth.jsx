import { Globe } from "lucide-react";

// Green = domain responds over the internet, Red = unreachable, Gray = no domain / checking.
export function DomainHealthDot({ health, className = "", testid }) {
  let color = "var(--ds-muted)";
  let label = "No domain";
  let pulse = false;

  if (health === undefined) {
    label = "Checking…";
    pulse = true;
  } else if (!health || health.reachable === null || !health.domain) {
    color = "var(--ds-muted)";
    label = "No domain";
  } else if (health.reachable) {
    color = "var(--ds-success)";
    label = `Reachable${health.status ? ` · ${health.status}` : ""}${health.latency_ms != null ? ` · ${health.latency_ms}ms` : ""}`;
  } else {
    color = "var(--ds-danger)";
    label = "Unreachable from the internet";
  }

  return (
    <span
      data-testid={testid}
      title={label}
      className={`relative inline-flex h-2.5 w-2.5 shrink-0 ${className}`}
    >
      {pulse && <span className="absolute inline-flex h-full w-full animate-ping rounded-full opacity-60" style={{ background: color }} />}
      <span className="relative inline-flex h-2.5 w-2.5 rounded-full" style={{ background: color }} />
    </span>
  );
}

// Larger pill variant with icon + text for detail pages / headers.
export function DomainHealthBadge({ health, testid }) {
  const reachable = health?.reachable;
  const cls = reachable === true
    ? "border-[var(--ds-success)]/40 bg-[var(--ds-success)]/10 text-[var(--ds-success)]"
    : reachable === false
      ? "border-[var(--ds-danger)]/40 bg-[var(--ds-danger)]/10 text-[var(--ds-danger)]"
      : "border-[var(--ds-border)] bg-[var(--ds-hover)] text-[var(--ds-muted)]";
  const text = reachable === true ? "Online" : reachable === false ? "Offline" : health === undefined ? "Checking" : "No domain";
  return (
    <span data-testid={testid} className={`inline-flex items-center gap-1.5 rounded-md border px-2 py-0.5 text-[11px] font-medium ${cls}`} title={health?.error || text}>
      <Globe className="h-3 w-3" strokeWidth={2} /> {text}
    </span>
  );
}
