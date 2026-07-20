import { Lock, LockOpen, ShieldAlert, ShieldCheck, Clock } from "lucide-react";
import { cn } from "@/lib/utils";

const MAP = {
  active: { label: "HTTPS", cls: "bg-emerald-500/10 text-emerald-400 border-emerald-500/25", Icon: ShieldCheck },
  expiring: { label: "SSL EXPIRING", cls: "bg-amber-500/10 text-amber-400 border-amber-500/25", Icon: Clock },
  expired: { label: "SSL EXPIRED", cls: "bg-red-500/10 text-red-400 border-red-500/25", Icon: ShieldAlert },
  pending: { label: "SSL PENDING", cls: "bg-blue-500/10 text-blue-400 border-blue-500/25", Icon: Lock },
  http: { label: "HTTP", cls: "bg-zinc-500/10 text-zinc-400 border-zinc-500/25", Icon: LockOpen },
};

export function SslBadge({ ssl, className }) {
  if (!ssl) return null;
  const s = MAP[ssl.state] || MAP.http;
  const days = ssl.days_left;
  let label = s.label;
  if ((ssl.state === "active" || ssl.state === "expiring") && typeof days === "number") {
    label = `${s.label} · ${days}d`;
  }
  return (
    <span
      data-testid={`ssl-badge-${ssl.state}`}
      title={ssl.expires_at ? `Expires: ${ssl.expires_at}` : ssl.mode}
      className={cn(
        "inline-flex items-center gap-1.5 rounded-sm border px-2 py-0.5 text-[10px] font-medium uppercase tracking-wider",
        s.cls,
        className
      )}
    >
      <s.Icon className="h-3 w-3" />
      {label}
    </span>
  );
}
