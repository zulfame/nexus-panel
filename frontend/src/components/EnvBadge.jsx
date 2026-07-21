import { Layers } from "lucide-react";

// Distinct colors per environment so they are easy to tell apart at a glance.
const STYLES = [
  { re: /^(prod|production|live)$/i, cls: "border-rose-500/40 bg-rose-500/15 text-rose-400" },
  { re: /^(stag|staging|stage|uat)$/i, cls: "border-amber-500/40 bg-amber-500/15 text-amber-400" },
  { re: /^(demo|sandbox|preview)$/i, cls: "border-sky-500/40 bg-sky-500/15 text-sky-400" },
  { re: /^(dev|development)$/i, cls: "border-violet-500/40 bg-violet-500/15 text-violet-400" },
  { re: /^(test|testing|qa)$/i, cls: "border-cyan-500/40 bg-cyan-500/15 text-cyan-400" },
];

export function EnvBadge({ environment, className = "", testid }) {
  if (!environment) return null;
  const match = STYLES.find((s) => s.re.test(environment.trim()));
  const cls = match ? match.cls : "border-[var(--ds-border)] bg-[var(--ds-hover)] text-[var(--ds-muted)]";
  return (
    <span
      data-testid={testid}
      title={`Environment: ${environment}`}
      className={`inline-flex w-fit items-center gap-1 rounded-md border px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide ${cls} ${className}`}
    >
      <Layers className="h-3 w-3" strokeWidth={2} />
      {environment}
    </span>
  );
}
