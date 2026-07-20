import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Cpu, MemoryStick, HardDrive, Boxes, Activity, Play, Square, AlertTriangle, ExternalLink } from "lucide-react";
import api from "@/lib/api";
import { Layout, PageHeader } from "@/components/Layout";
import { StatusBadge } from "@/components/StatusBadge";
import { SslBadge } from "@/components/SslBadge";
import { ContainerDots } from "@/components/ContainerHealth";

function fmtBytes(b) {
  if (!b) return "0 B";
  const u = ["B", "KB", "MB", "GB", "TB"];
  const i = Math.floor(Math.log(b) / Math.log(1024));
  return `${(b / Math.pow(1024, i)).toFixed(1)} ${u[i]}`;
}

function Meter({ icon: Icon, label, percent, detail, color }) {
  return (
    <div className="border border-border bg-card p-5" data-testid={`meter-${label.toLowerCase()}`}>
      <div className="mb-4 flex items-center justify-between">
        <div className="flex items-center gap-2 text-muted-foreground">
          <Icon className="h-4 w-4" />
          <span className="font-mono text-xs uppercase tracking-wider">{label}</span>
        </div>
        <span className="font-heading text-2xl font-bold tabular-nums">{percent}%</span>
      </div>
      <div className="h-1.5 w-full bg-white/10">
        <div className="h-full transition-all" style={{ width: `${Math.min(percent, 100)}%`, backgroundColor: color }} />
      </div>
      <div className="mt-3 font-mono text-xs text-muted-foreground">{detail}</div>
    </div>
  );
}

export default function Dashboard() {
  const [stats, setStats] = useState(null);
  const [projects, setProjects] = useState([]);
  const [health, setHealth] = useState({});
  const [ssl, setSsl] = useState({});
  const navigate = useNavigate();

  const load = async () => {
    try {
      const [s, p, h, sl] = await Promise.all([
        api.get("/system/stats"),
        api.get("/projects"),
        api.get("/system/containers-health").catch(() => ({ data: {} })),
        api.get("/system/ssl-status").catch(() => ({ data: {} })),
      ]);
      setStats(s.data);
      setProjects(p.data);
      setHealth(h.data || {});
      setSsl(sl.data || {});
    } catch (e) {}
  };

  useEffect(() => {
    load();
    const t = setInterval(load, 5000);
    return () => clearInterval(t);
  }, []);

  const counts = stats?.projects || { total: 0, running: 0, stopped: 0, error: 0 };

  return (
    <Layout>
      <PageHeader title="Dashboard" subtitle="Server resources & deployment overview" />
      <div className="p-8">
        <div className="mb-6 grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3">
          <Meter icon={Cpu} label="CPU" percent={stats?.cpu?.percent ?? 0} color="#10B981"
            detail={`${stats?.cpu?.cores ?? 0} cores · load ${stats?.cpu?.load?.[0] ?? 0}`} />
          <Meter icon={MemoryStick} label="Memory" percent={stats?.memory?.percent ?? 0} color="#F59E0B"
            detail={`${fmtBytes(stats?.memory?.used)} / ${fmtBytes(stats?.memory?.total)}`} />
          <Meter icon={HardDrive} label="Disk" percent={stats?.disk?.percent ?? 0} color="#3B82F6"
            detail={`${fmtBytes(stats?.disk?.used)} / ${fmtBytes(stats?.disk?.total)}`} />
        </div>

        <div className="mb-8 grid grid-cols-2 gap-4 md:grid-cols-4">
          {[
            { label: "Projects", value: counts.total, icon: Boxes, color: "#FFFFFF" },
            { label: "Running", value: counts.running, icon: Play, color: "#10B981" },
            { label: "Stopped", value: counts.stopped, icon: Square, color: "#71717A" },
            { label: "Errors", value: counts.error, icon: AlertTriangle, color: "#EF4444" },
          ].map((c) => (
            <div key={c.label} className="border border-border bg-card p-5" data-testid={`stat-${c.label.toLowerCase()}`}>
              <c.icon className="mb-3 h-4 w-4" style={{ color: c.color }} />
              <div className="font-heading text-3xl font-bold tabular-nums">{c.value}</div>
              <div className="mt-1 font-mono text-xs uppercase tracking-wider text-muted-foreground">{c.label}</div>
            </div>
          ))}
        </div>

        <div className="border border-border bg-card">
          <div className="flex items-center gap-2 border-b border-border px-5 py-4">
            <Activity className="h-4 w-4 text-status-running" />
            <h2 className="font-heading font-bold tracking-tight">Projects</h2>
          </div>
          {projects.length === 0 ? (
            <div className="p-8 text-center font-mono text-sm text-muted-foreground">
              No projects yet.{" "}
              <button className="text-status-running underline" onClick={() => navigate("/projects/new")}>
                Add your first project
              </button>
            </div>
          ) : (
            <table className="w-full">
              <thead>
                <tr className="border-b border-border text-left font-mono text-[11px] uppercase tracking-wider text-muted-foreground">
                  <th className="px-5 py-3 font-medium">Name</th>
                  <th className="px-5 py-3 font-medium">Domain</th>
                  <th className="px-5 py-3 font-medium">Ports</th>
                  <th className="px-5 py-3 font-medium">Containers</th>
                  <th className="px-5 py-3 font-medium">SSL</th>
                  <th className="px-5 py-3 font-medium">Status</th>
                </tr>
              </thead>
              <tbody>
                {projects.map((p) => (
                  <tr
                    key={p.id}
                    data-testid={`dashboard-project-row-${p.slug}`}
                    onClick={() => navigate(`/projects/${p.id}`)}
                    className="cursor-pointer border-b border-border/60 transition-colors hover:bg-white/5"
                  >
                    <td className="px-5 py-3.5 font-medium">{p.name}</td>
                    <td className="px-5 py-3.5 font-mono text-sm text-muted-foreground">
                      {p.domain ? (
                        <a
                          data-testid={`dashboard-open-url-${p.slug}`}
                          href={`${ssl[p.id] && (ssl[p.id].state === "active" || ssl[p.id].state === "expiring") ? "https" : "http"}://${p.domain}`}
                          target="_blank"
                          rel="noopener noreferrer"
                          onClick={(e) => e.stopPropagation()}
                          className="inline-flex items-center gap-1 hover:text-foreground hover:underline"
                        >
                          {p.domain} <ExternalLink className="h-3 w-3" />
                        </a>
                      ) : "—"}
                    </td>
                    <td className="px-5 py-3.5 font-mono text-sm text-muted-foreground">{p.frontend_port} / {p.backend_port}</td>
                    <td className="px-5 py-3.5"><ContainerDots containers={health[p.id] || []} testid={`dashboard-containers-${p.slug}`} /></td>
                    <td className="px-5 py-3.5"><SslBadge ssl={ssl[p.id]} /></td>
                    <td className="px-5 py-3.5"><StatusBadge status={p.status} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </Layout>
  );
}
