/* ============================================================
   NEXUS PANEL — DESIGN SYSTEM COMPONENTS
   Reusable primitives built on the --ds-* tokens.
   Import from "@/components/ds" in any future page.
   ============================================================ */
import { forwardRef } from "react";
import {
  Loader2, Check, AlertTriangle, Info, XCircle, CheckCircle2, X,
  Circle, ChevronDown, Rocket,
} from "lucide-react";

/* ---------- Button ---------- */
const BTN_VARIANTS = {
  primary: "text-white bg-[var(--ds-primary)] hover:bg-[var(--ds-primary-hover)] active:bg-[var(--ds-primary-active)] border border-transparent",
  secondary: "text-[var(--ds-text)] bg-[var(--ds-hover)] hover:bg-[#20252e] border border-[var(--ds-border)]",
  ghost: "text-[var(--ds-text-secondary)] bg-transparent hover:bg-[var(--ds-hover)] border border-transparent",
  outline: "text-[var(--ds-text)] bg-transparent hover:bg-[var(--ds-hover)] border border-[var(--ds-border)]",
  success: "text-white bg-[var(--ds-success)] hover:brightness-110 border border-transparent",
  danger: "text-white bg-[var(--ds-danger)] hover:bg-[var(--ds-danger-hover)] border border-transparent",
};
const BTN_SIZES = { sm: "h-8 px-3 text-[13px]", md: "h-9 px-4 text-sm", lg: "h-11 px-5 text-sm" };

export const DSButton = forwardRef(function DSButton(
  { variant = "primary", size = "md", loading, icon: Icon, className = "", children, ...props }, ref
) {
  return (
    <button
      ref={ref}
      className={`ds-transition ds-focus-ring inline-flex items-center justify-center gap-2 rounded-[var(--ds-radius-btn)] font-medium disabled:cursor-not-allowed disabled:opacity-40 ${BTN_SIZES[size]} ${BTN_VARIANTS[variant]} ${className}`}
      {...props}
    >
      {loading ? <Loader2 className="h-4 w-4 ds-spin" /> : Icon && <Icon className="h-4 w-4" />}
      {children}
    </button>
  );
});

export function DSIconButton({ icon: Icon, className = "", ...props }) {
  return (
    <button
      className={`ds-transition ds-focus-ring inline-flex h-9 w-9 items-center justify-center rounded-[var(--ds-radius-btn)] border border-[var(--ds-border)] bg-[var(--ds-card)] text-[var(--ds-text-secondary)] hover:bg-[var(--ds-hover)] hover:text-[var(--ds-text)] disabled:opacity-40 ${className}`}
      {...props}
    >
      <Icon className="h-4 w-4" />
    </button>
  );
}

/* ---------- Badge (status) ---------- */
const STATUS = {
  running: { dot: "#22c55e", text: "text-[#22c55e]", label: "Running" },
  deploying: { dot: "#3b82f6", text: "text-[#3b82f6]", label: "Deploying" },
  building: { dot: "#f59e0b", text: "text-[#f59e0b]", label: "Building" },
  stopped: { dot: "#71717a", text: "text-[#9ca3af]", label: "Stopped" },
  failed: { dot: "#ef4444", text: "text-[#ef4444]", label: "Failed" },
  pending: { dot: "#eab308", text: "text-[#eab308]", label: "Pending" },
};
export function DSBadge({ status = "running", children, pulse, className = "" }) {
  const s = STATUS[status] || STATUS.running;
  return (
    <span className={`inline-flex items-center gap-1.5 text-[13px] font-medium ${s.text} ${className}`}>
      <span className="relative flex h-2 w-2">
        {pulse && (status === "deploying" || status === "building") && (
          <span className="absolute inline-flex h-full w-full animate-ping rounded-full opacity-60" style={{ background: s.dot }} />
        )}
        <span className="relative inline-flex h-2 w-2 rounded-full" style={{ background: s.dot }} />
      </span>
      {children || s.label}
    </span>
  );
}

/* ---------- Cards ---------- */
export function DSCard({ className = "", children, hover, ...props }) {
  return (
    <div
      className={`ds-transition rounded-[var(--ds-radius-card)] border border-[var(--ds-border)] bg-[var(--ds-card)] ${hover ? "hover:border-[#33404f] hover:shadow-[var(--ds-shadow-hover)]" : ""} ${className}`}
      style={{ boxShadow: "var(--ds-shadow)" }}
      {...props}
    >
      {children}
    </div>
  );
}

export function DSStatCard({ label, value, delta, deltaUp = true, icon: Icon }) {
  return (
    <DSCard className="p-5">
      <div className="flex items-start justify-between">
        <span className="text-[13px] text-[var(--ds-muted)]">{label}</span>
        {Icon && <Icon className="h-4 w-4 text-[var(--ds-muted)]" />}
      </div>
      <div className="mt-3 flex items-end justify-between">
        <span className="text-[32px] font-bold leading-none tracking-tight">{value}</span>
        {delta && (
          <span className={`text-[13px] font-medium ${deltaUp ? "text-[var(--ds-success)]" : "text-[var(--ds-danger)]"}`}>
            {deltaUp ? "▲" : "▼"} {delta}
          </span>
        )}
      </div>
    </DSCard>
  );
}

export function DSDangerCard({ title = "Danger Zone", children }) {
  return (
    <div className="rounded-[var(--ds-radius-card)] border border-[var(--ds-danger)]/30 bg-[var(--ds-danger)]/[0.06] p-5">
      <h4 className="text-sm font-semibold text-[var(--ds-danger)]">{title}</h4>
      <p className="mt-1 text-[13px] text-[var(--ds-text-secondary)]">{children}</p>
    </div>
  );
}

/* ---------- Form components ---------- */
const inputBase =
  "ds-field ds-transition ds-focus-ring w-full rounded-[var(--ds-radius-input)] border border-[var(--ds-border)] bg-[var(--ds-page)] px-3 text-sm text-[var(--ds-text)] placeholder:text-[var(--ds-muted)] focus:border-[var(--ds-primary)]";

export const DSInput = forwardRef(function DSInput({ className = "", ...props }, ref) {
  return <input ref={ref} className={`${inputBase} h-10 ${className}`} {...props} />;
});

export const DSTextarea = forwardRef(function DSTextarea({ className = "", ...props }, ref) {
  return <textarea ref={ref} className={`${inputBase} min-h-[88px] py-2 ${className}`} {...props} />;
});

export function DSSelect({ className = "", children, ...props }) {
  return (
    <div className="relative">
      <select className={`${inputBase} h-10 appearance-none pr-9 ${className}`} {...props}>
        {children}
      </select>
      <ChevronDown className="pointer-events-none absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[var(--ds-muted)]" />
    </div>
  );
}

export function DSCheckbox({ label, checked, onChange, id }) {
  return (
    <label htmlFor={id} className="ds-transition flex cursor-pointer items-center gap-2.5 text-sm text-[var(--ds-text-secondary)]">
      <span
        onClick={() => onChange?.(!checked)}
        className={`ds-transition flex h-[18px] w-[18px] items-center justify-center rounded-[4px] border ${checked ? "border-[var(--ds-primary)] bg-[var(--ds-primary)]" : "border-[var(--ds-border)] bg-transparent"}`}
      >
        {checked && <Check className="h-3 w-3 text-white" strokeWidth={3} />}
      </span>
      {label}
    </label>
  );
}

export function DSRadio({ label, checked, onChange }) {
  return (
    <label className="ds-transition flex cursor-pointer items-center gap-2.5 text-sm text-[var(--ds-text-secondary)]" onClick={() => onChange?.(true)}>
      <span className={`ds-transition flex h-[18px] w-[18px] items-center justify-center rounded-full border ${checked ? "border-[var(--ds-primary)]" : "border-[var(--ds-border)]"}`}>
        {checked && <span className="h-2 w-2 rounded-full bg-[var(--ds-primary)]" />}
      </span>
      {label}
    </label>
  );
}

export function DSToggle({ checked, onChange, label }) {
  return (
    <label className="flex cursor-pointer items-center gap-3 text-sm text-[var(--ds-text-secondary)]">
      <button
        type="button"
        onClick={() => onChange?.(!checked)}
        className={`ds-transition relative h-6 w-11 rounded-full ${checked ? "bg-[var(--ds-success)]" : "bg-[var(--ds-border)]"}`}
      >
        <span className={`ds-transition absolute top-0.5 h-5 w-5 rounded-full bg-white ${checked ? "left-[22px]" : "left-0.5"}`} />
      </button>
      {label}
    </label>
  );
}

/* ---------- Table ---------- */
export function DSTable({ columns, rows, renderCell, empty = "No data", pagination }) {
  return (
    <div className="overflow-hidden rounded-[var(--ds-radius-card)] border border-[var(--ds-border)]">
      <div className="overflow-x-auto">
        <table className="w-full min-w-[560px] text-left text-sm">
          <thead className="border-b border-[var(--ds-border)] text-[12px] uppercase tracking-wider text-[var(--ds-muted)]">
            <tr>{columns.map((c) => <th key={c.key} className="px-5 py-3 font-medium">{c.label}</th>)}</tr>
          </thead>
          <tbody className="divide-y divide-[var(--ds-border)]/60">
            {rows.length === 0 ? (
              <tr><td colSpan={columns.length} className="px-5 py-10 text-center text-[var(--ds-muted)]">{empty}</td></tr>
            ) : rows.map((row, i) => (
              <tr key={i} className="ds-transition hover:bg-[var(--ds-hover)]">
                {columns.map((c) => <td key={c.key} className="px-5 py-3.5 text-[var(--ds-text-secondary)]">{renderCell ? renderCell(c.key, row) : row[c.key]}</td>)}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {pagination && (
        <div className="flex items-center justify-between border-t border-[var(--ds-border)] px-5 py-3 text-[13px] text-[var(--ds-muted)]">
          <span>{pagination.label}</span>
          <div className="flex items-center gap-1">{pagination.controls}</div>
        </div>
      )}
    </div>
  );
}

/* ---------- Alerts ---------- */
const ALERTS = {
  success: { icon: CheckCircle2, color: "var(--ds-success)" },
  info: { icon: Info, color: "var(--ds-info)" },
  warning: { icon: AlertTriangle, color: "var(--ds-warning)" },
  error: { icon: XCircle, color: "var(--ds-danger)" },
};
export function DSAlert({ variant = "info", title, children, onClose }) {
  const a = ALERTS[variant];
  const Icon = a.icon;
  return (
    <div
      className="ds-transition flex items-start gap-3 rounded-[var(--ds-radius-btn)] border p-3"
      style={{ borderColor: `${a.color}44`, background: `${a.color}12` }}
    >
      <Icon className="mt-0.5 h-4 w-4 shrink-0" style={{ color: a.color }} />
      <div className="min-w-0 flex-1">
        <div className="text-sm font-semibold" style={{ color: a.color }}>{title}</div>
        {children && <div className="mt-0.5 text-[13px] text-[var(--ds-text-secondary)]">{children}</div>}
      </div>
      {onClose && <button onClick={onClose} className="text-[var(--ds-muted)] hover:text-[var(--ds-text)]"><X className="h-4 w-4" /></button>}
    </div>
  );
}

/* ---------- Progress ---------- */
export function DSProgressBar({ value = 0 }) {
  return (
    <div className="h-2 w-full overflow-hidden rounded-full bg-[var(--ds-border)]">
      <div className="ds-transition h-full rounded-full bg-[var(--ds-primary)]" style={{ width: `${value}%` }} />
    </div>
  );
}
export function DSSkeleton({ className = "" }) {
  return <div className={`ds-skeleton rounded-[6px] ${className}`} />;
}
export function DSSpinner({ className = "" }) {
  return <Loader2 className={`ds-spin text-[var(--ds-primary)] ${className}`} />;
}

/* ---------- Empty state ---------- */
export function DSEmptyState({ icon: Icon = Rocket, title, description, action }) {
  return (
    <div className="flex flex-col items-center justify-center px-6 py-10 text-center">
      <div className="mb-4 flex h-16 w-16 items-center justify-center rounded-2xl border border-[var(--ds-border)] bg-[var(--ds-hover)]">
        <Icon className="h-7 w-7 text-[var(--ds-muted)]" strokeWidth={1.5} />
      </div>
      <h4 className="text-base font-semibold text-[var(--ds-text)]">{title}</h4>
      {description && <p className="mt-1 max-w-xs text-[13px] text-[var(--ds-text-secondary)]">{description}</p>}
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}
