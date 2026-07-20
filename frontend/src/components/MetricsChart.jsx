import { useCallback, useEffect, useState } from "react";
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend,
} from "recharts";
import { Activity, Loader2 } from "lucide-react";
import api from "@/lib/api";
import { Button } from "@/components/ui/button";

const COLORS = ["#34d399", "#38bdf8", "#f59e0b", "#a78bfa", "#f87171", "#2dd4bf"];
const RANGES = [
  { label: "15m", value: 15 },
  { label: "1h", value: 60 },
  { label: "6h", value: 360 },
  { label: "24h", value: 1440 },
];

const shortName = (n) => n.replace(/-\d+$/, "").split("-").slice(-1)[0] || n;

export function MetricsChart({ projectId }) {
  const [minutes, setMinutes] = useState(60);
  const [points, setPoints] = useState([]);
  const [names, setNames] = useState([]);
  const [loading, setLoading] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const { data } = await api.get(`/projects/${projectId}/metrics?minutes=${minutes}`);
      const pts = data.points || [];
      const allNames = [...new Set(pts.flatMap((p) => (p.stats || []).map((s) => s.name)))];
      const rows = pts.map((p) => {
        const row = { time: new Date(p.ts).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }) };
        (p.stats || []).forEach((s) => {
          row[`${s.name}__cpu`] = s.cpu;
          row[`${s.name}__mem`] = s.mem_mb;
        });
        return row;
      });
      setNames(allNames);
      setPoints(rows);
    } catch (e) {
      setPoints([]);
    } finally {
      setLoading(false);
    }
  }, [projectId, minutes]);

  useEffect(() => {
    load();
    const t = setInterval(load, 30000);
    return () => clearInterval(t);
  }, [load]);

  const tooltipStyle = { background: "#0a0a0a", border: "1px solid #262626", borderRadius: 4, fontSize: 12 };

  const Chart = ({ suffix, unit }) => (
    <ResponsiveContainer width="100%" height={220}>
      <LineChart data={points} margin={{ top: 8, right: 12, left: -12, bottom: 0 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="#1f1f1f" />
        <XAxis dataKey="time" tick={{ fill: "#71717a", fontSize: 11 }} minTickGap={40} />
        <YAxis tick={{ fill: "#71717a", fontSize: 11 }} unit={unit} width={48} />
        <Tooltip contentStyle={tooltipStyle} labelStyle={{ color: "#a1a1aa" }} />
        <Legend wrapperStyle={{ fontSize: 11 }} />
        {names.map((n, i) => (
          <Line
            key={n}
            type="monotone"
            dataKey={`${n}__${suffix}`}
            name={shortName(n)}
            stroke={COLORS[i % COLORS.length]}
            strokeWidth={2}
            dot={false}
            isAnimationActive={false}
          />
        ))}
      </LineChart>
    </ResponsiveContainer>
  );

  return (
    <div className="space-y-6" data-testid="metrics-chart">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <Activity className="h-4 w-4 text-emerald-400" /> Container metrics (sampled ~60s)
          {loading && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
        </div>
        <div className="flex gap-1">
          {RANGES.map((r) => (
            <Button
              key={r.value}
              size="sm"
              variant="outline"
              onClick={() => setMinutes(r.value)}
              data-testid={`metrics-range-${r.value}`}
              className={`h-7 border-white/15 bg-transparent px-2.5 text-xs ${minutes === r.value ? "border-emerald-500/40 bg-emerald-500/10 text-emerald-300" : ""}`}
            >
              {r.label}
            </Button>
          ))}
        </div>
      </div>

      {points.length === 0 ? (
        <div className="rounded-sm border border-dashed border-border py-12 text-center text-sm text-muted-foreground" data-testid="metrics-empty">
          No metrics yet. CPU/RAM are sampled every ~60s while the project is running.
        </div>
      ) : (
        <div className="space-y-6">
          <div>
            <div className="mb-1 text-xs font-bold uppercase tracking-[0.1em] text-muted-foreground">CPU %</div>
            <Chart suffix="cpu" unit="%" />
          </div>
          <div>
            <div className="mb-1 text-xs font-bold uppercase tracking-[0.1em] text-muted-foreground">Memory (MB)</div>
            <Chart suffix="mem" unit="" />
          </div>
        </div>
      )}
    </div>
  );
}
