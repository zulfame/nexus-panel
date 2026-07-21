import { useMemo } from "react";
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Cell,
} from "recharts";
import { TrendingUp, CheckCircle2, XCircle, Clock } from "lucide-react";

const OK = "#34d399";
const FAIL = "#f87171";

const tooltipStyle = { background: "#0a0a0a", border: "1px solid #262626", borderRadius: 4, fontSize: 12 };

function TimelineTooltip({ active, payload }) {
  if (!active || !payload?.length) return null;
  const d = payload[0].payload;
  return (
    <div style={tooltipStyle} className="px-3 py-2 font-mono">
      <div className="text-zinc-300">{d.when}</div>
      <div className={d.status === "success" ? "text-emerald-400" : "text-red-400"}>
        {d.action} · {d.status} · {d.duration}s
      </div>
      {d.commit && <div className="text-amber-400">{d.commit}</div>}
      {d.note && <div className="max-w-[220px] truncate text-zinc-400">“{d.note}”</div>}
    </div>
  );
}

export function DeployTimeline({ history }) {
  const { rows, stats } = useMemo(() => {
    const chrono = [...(history || [])].reverse(); // oldest -> newest
    const rows = chrono.map((h, i) => ({
      idx: i + 1,
      duration: h.duration_s ?? 0,
      status: h.status,
      action: h.action,
      commit: (h.commit || {}).short,
      note: h.note,
      when: new Date(h.started_at).toLocaleString([], { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" }),
    }));
    const total = rows.length;
    const ok = rows.filter((r) => r.status === "success").length;
    const failed = total - ok;
    const avg = total ? Math.round(rows.reduce((a, r) => a + r.duration, 0) / total) : 0;
    const rate = total ? Math.round((ok / total) * 100) : 0;
    return { rows, stats: { total, ok, failed, avg, rate } };
  }, [history]);

  if (!rows.length) {
    return (
      <div className="rounded-sm border border-dashed border-border py-10 text-center text-sm text-muted-foreground" data-testid="timeline-empty">
        No deploys yet — the trend chart appears once you deploy this project.
      </div>
    );
  }

  const Stat = ({ icon: Icon, label, value, color, testid }) => (
    <div className="flex items-center gap-2.5 rounded-sm border border-border bg-background/50 px-3 py-2" data-testid={testid}>
      <Icon className={`h-4 w-4 ${color}`} />
      <div className="leading-tight">
        <div className="font-mono text-sm font-bold">{value}</div>
        <div className="text-[10px] uppercase tracking-wider text-muted-foreground">{label}</div>
      </div>
    </div>
  );

  return (
    <div className="space-y-4" data-testid="deploy-timeline">
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        <Stat icon={CheckCircle2} label="Success rate" value={`${stats.rate}%`} color="text-emerald-400" testid="timeline-rate" />
        <Stat icon={TrendingUp} label="Total deploys" value={stats.total} color="text-sky-400" testid="timeline-total" />
        <Stat icon={XCircle} label="Failed" value={stats.failed} color="text-red-400" testid="timeline-failed" />
        <Stat icon={Clock} label="Avg build" value={`${stats.avg}s`} color="text-amber-400" testid="timeline-avg" />
      </div>

      <ResponsiveContainer width="100%" height={200}>
        <BarChart data={rows} margin={{ top: 8, right: 12, left: -18, bottom: 0 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="#1f1f1f" vertical={false} />
          <XAxis dataKey="idx" tick={{ fill: "#71717a", fontSize: 11 }} />
          <YAxis tick={{ fill: "#71717a", fontSize: 11 }} unit="s" width={48} allowDecimals={false} />
          <Tooltip content={<TimelineTooltip />} cursor={{ fill: "rgba(255,255,255,0.04)" }} />
          <Bar dataKey="duration" radius={[2, 2, 0, 0]} isAnimationActive={false} minPointSize={3}>
            {rows.map((r, i) => (
              <Cell key={i} fill={r.status === "success" ? OK : FAIL} />
            ))}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
      <div className="flex items-center gap-4 text-[11px] text-muted-foreground">
        <span className="flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-sm" style={{ background: OK }} /> Success</span>
        <span className="flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-sm" style={{ background: FAIL }} /> Failed</span>
        <span>· bar height = build duration · oldest → newest</span>
      </div>
    </div>
  );
}
