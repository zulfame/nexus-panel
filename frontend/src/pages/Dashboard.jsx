import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { toast } from "sonner";
import {
  Cpu, MemoryStick, HardDrive, Boxes, Activity, Play, Square, AlertTriangle,
  ExternalLink, ScanSearch, ArrowUpCircle, RefreshCw, Plus,
} from "lucide-react";
import api, { apiError } from "@/lib/api";
import { Layout } from "@/components/Layout";
import { SslBadge } from "@/components/SslBadge";
import { EnvBadge } from "@/components/EnvBadge";
import { DomainHealthDot } from "@/components/DomainHealth";
import { ContainerDots } from "@/components/ContainerHealth";
import "@/styles/design-system.css";
import { DSButton, DSCard, DSBadge, DSEmptyState } from "@/components/ds";

function fmtBytes(b) {
  if (!b) return "0 B";
  const u = ["B", "KB", "MB", "GB", "TB"];
  const i = Math.floor(Math.log(b) / Math.log(1024));
  return `${(b / Math.pow(1024, i)).toFixed(1)} ${u[i]}`;
}

const STATUS_MAP = { running: "running", building: "building", cloning: "deploying", created: "pending", error: "failed", stopped: "stopped" };

function Meter({ icon: Icon, label, percent, detail, color }) {
  return (
    <DSCard className="p-5" data-testid={`meter-${label.toLowerCase()}`}>
      <div className="mb-4 flex items-center justify-between">
        <div className="flex items-center gap-2 text-[var(--ds-muted)]">
          <Icon className="h-4 w-4" />
          <span className="text-[13px] font-medium">{label}</span>
        </div>
        <span className="text-2xl font-bold tabular-nums text-[var(--ds-text)]">{percent}%</span>
      </div>
      <div className="h-2 w-full overflow-hidden rounded-full bg-[var(--ds-border)]">
        <div className="ds-transition h-full rounded-full" style={{ width: `${Math.min(percent, 100)}%`, backgroundColor: color }} />
      </div>
      <div className="mt-3 text-[13px] text-[var(--ds-muted)]">{detail}</div>
    </DSCard>
  );
}

export default function Dashboard() {
  const [stats, setStats] = useState(null);
  const [projects, setProjects] = useState([]);
  const [health, setHealth] = useState({});
  const [ssl, setSsl] = useState({});
  const [domainHealth, setDomainHealth] = useState({});
  const [scanning, setScanning] = useState(false);
  const [checkingUpdates, setCheckingUpdates] = useState(false);
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

  useEffect(() => {
    const loadDomains = () =>
      api.get("/system/domains-health").then(({ data }) => setDomainHealth(data || {})).catch(() => {});
    loadDomains();
    const t = setInterval(loadDomains, 60000);
    return () => clearInterval(t);
  }, []);

  const counts = stats?.projects || { total: 0, running: 0, stopped: 0, error: 0 };

  const scanAll = async () => {
    setScanning(true);
    try {
      const { data } = await api.post("/projects/scan-all");
      const failed = (data.results || []).filter((r) => !r.scanned).length;
      if (data.total_missing > 0) {
        toast.warning(`Scan complete: ${data.total_missing} required env missing${failed ? ` · ${failed} failed to scan` : ""}`);
      } else if (failed > 0) {
        toast.warning(`${failed} project(s) failed to scan (check repo/branch/token)`);
      } else {
        toast.success(`Scan complete: all ${data.scanned} project(s) ready`);
      }
      await load();
    } catch (e) {
      toast.error(apiError(e));
    } finally {
      setScanning(false);
    }
  };

  const checkAllUpdates = async () => {
    setCheckingUpdates(true);
    try {
      const { data } = await api.post("/projects/check-all-updates");
      if (data.total_behind > 0) toast.info(`${data.total_behind} update(s) available across projects`);
      else toast.success("All projects are up to date");
      await load();
    } catch (e) {
      toast.error(apiError(e));
    } finally {
      setCheckingUpdates(false);
    }
  };

  const statCards = [
    { label: "Projects", value: counts.total, icon: Boxes, color: "var(--ds-primary)" },
    { label: "Running", value: counts.running, icon: Play, color: "var(--ds-success)" },
    { label: "Stopped", value: counts.stopped, icon: Square, color: "var(--ds-muted)" },
    { label: "Errors", value: counts.error, icon: AlertTriangle, color: "var(--ds-danger)" },
  ];

  return (
    <Layout>
      <div className="min-h-screen">
        <header className="sticky top-14 z-20 flex flex-wrap items-center justify-between gap-3 border-b border-[var(--ds-border)] bg-[var(--ds-page)]/85 px-4 py-5 backdrop-blur-xl sm:px-8 lg:top-14">
          <div>
            <h1 className="text-[24px] font-bold tracking-tight text-[var(--ds-text)]">Overview</h1>
            <p className="mt-0.5 text-[13px] text-[var(--ds-muted)]">Server resources & deployment overview</p>
          </div>
        </header>

        <div className="p-4 sm:p-6 lg:p-8">
          <div className="mb-6 grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3">
            <Meter icon={Cpu} label="CPU" percent={stats?.cpu?.percent ?? 0} color="var(--ds-success)"
              detail={`${stats?.cpu?.cores ?? 0} cores · load ${stats?.cpu?.load?.[0] ?? 0}`} />
            <Meter icon={MemoryStick} label="Memory" percent={stats?.memory?.percent ?? 0} color="var(--ds-warning)"
              detail={`${fmtBytes(stats?.memory?.used)} / ${fmtBytes(stats?.memory?.total)}`} />
            <Meter icon={HardDrive} label="Disk" percent={stats?.disk?.percent ?? 0} color="var(--ds-primary)"
              detail={`${fmtBytes(stats?.disk?.used)} / ${fmtBytes(stats?.disk?.total)}`} />
          </div>

          <div className="mb-8 grid grid-cols-2 gap-4 md:grid-cols-4">
            {statCards.map((c) => (
              <DSCard key={c.label} hover className="p-5" data-testid={`stat-${c.label.toLowerCase()}`}>
                <c.icon className="mb-3 h-4 w-4" style={{ color: c.color }} />
                <div className="text-3xl font-bold tabular-nums text-[var(--ds-text)]">{c.value}</div>
                <div className="mt-1 text-[13px] text-[var(--ds-muted)]">{c.label}</div>
              </DSCard>
            ))}
          </div>

          <DSCard>
            <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[var(--ds-border)] px-5 py-4">
              <div className="flex items-center gap-2">
                <Activity className="h-4 w-4 text-[var(--ds-success)]" />
                <h2 className="text-base font-semibold tracking-tight text-[var(--ds-text)]">Projects</h2>
              </div>
              <div className="flex items-center gap-2">
                <DSButton data-testid="check-updates-all-btn" variant="outline" size="sm" loading={checkingUpdates}
                  icon={checkingUpdates ? undefined : RefreshCw} onClick={checkAllUpdates} disabled={checkingUpdates || projects.length === 0}>
                  Check Updates
                </DSButton>
                <DSButton data-testid="scan-all-btn" variant="outline" size="sm" loading={scanning}
                  icon={scanning ? undefined : ScanSearch} onClick={scanAll} disabled={scanning || projects.length === 0}>
                  Scan All Projects
                </DSButton>
              </div>
            </div>

            {projects.length === 0 ? (
              <DSEmptyState
                icon={Boxes}
                title="No projects yet"
                description="Pull a project from GitHub and deploy it on this server."
                action={<DSButton data-testid="dashboard-empty-new-project-btn" variant="primary" icon={Plus} onClick={() => navigate("/projects/new")}>Add Project</DSButton>}
              />
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full min-w-[760px] text-left text-sm">
                  <thead className="border-b border-[var(--ds-border)] text-[12px] uppercase tracking-wider text-[var(--ds-muted)]">
                    <tr>
                      <th className="px-5 py-3 font-medium">Name</th>
                      <th className="px-5 py-3 font-medium">Domain</th>
                      <th className="px-5 py-3 font-medium">Ports</th>
                      <th className="px-5 py-3 font-medium">Containers</th>
                      <th className="px-5 py-3 font-medium">Env</th>
                      <th className="px-5 py-3 font-medium">Updates</th>
                      <th className="px-5 py-3 font-medium">SSL</th>
                      <th className="px-5 py-3 font-medium">Status</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-[var(--ds-border)]/60">
                    {projects.map((p) => (
                      <tr key={p.id} data-testid={`dashboard-project-row-${p.slug}`} onClick={() => navigate(`/projects/${p.id}`)}
                        className="ds-transition cursor-pointer hover:bg-[var(--ds-hover)]">
                        <td className="px-5 py-3.5 text-sm font-medium text-[var(--ds-text)]">
                          <div className="flex items-center gap-2">
                            <span>{p.name}</span>
                            <EnvBadge environment={p.environment} testid={`dashboard-env-badge-${p.slug}`} />
                          </div>
                        </td>
                        <td className="px-5 py-3.5 text-sm text-[var(--ds-muted)]">
                          {p.domain ? (
                            <span className="inline-flex items-center gap-2">
                              <DomainHealthDot health={domainHealth[p.id]} testid={`dashboard-domain-health-${p.slug}`} />
                              <a data-testid={`dashboard-open-url-${p.slug}`}
                                href={`${ssl[p.id] && (ssl[p.id].state === "active" || ssl[p.id].state === "expiring") ? "https" : "http"}://${p.domain}`}
                                target="_blank" rel="noopener noreferrer" onClick={(e) => e.stopPropagation()}
                                className="inline-flex items-center gap-1 hover:text-[var(--ds-text)] hover:underline">
                                {p.domain} <ExternalLink className="h-3 w-3" />
                              </a>
                            </span>
                          ) : "—"}
                        </td>
                        <td className="px-5 py-3.5 font-mono text-sm text-[var(--ds-muted)]">{p.frontend_port} / {p.backend_port}</td>
                        <td className="px-5 py-3.5"><ContainerDots containers={health[p.id] || []} testid={`dashboard-containers-${p.slug}`} /></td>
                        <td className="px-5 py-3.5">
                          {p.env_missing_required?.length > 0 ? (
                            <span data-testid={`dashboard-env-missing-${p.slug}`} className="inline-flex items-center gap-1 rounded-md border border-[var(--ds-warning)]/30 bg-[var(--ds-warning)]/10 px-1.5 py-0.5 text-[11px] text-[var(--ds-warning)]">
                              <AlertTriangle className="h-3 w-3" /> {p.env_missing_required.length} missing
                            </span>
                          ) : (
                            <span className="text-[12px] text-[var(--ds-muted)]">{p.env_scanned_at ? "ok" : "—"}</span>
                          )}
                        </td>
                        <td className="px-5 py-3.5">
                          {p.updates_behind > 0 ? (
                            <span data-testid={`dashboard-updates-${p.slug}`} className="inline-flex items-center gap-1 rounded-md border border-[var(--ds-warning)]/30 bg-[var(--ds-warning)]/10 px-1.5 py-0.5 text-[11px] text-[var(--ds-warning)]">
                              <ArrowUpCircle className="h-3 w-3" /> {p.updates_behind} new
                            </span>
                          ) : (
                            <span className="text-[12px] text-[var(--ds-muted)]">{p.updates_checked_at ? "latest" : "—"}</span>
                          )}
                        </td>
                        <td className="px-5 py-3.5"><SslBadge ssl={ssl[p.id]} /></td>
                        <td className="px-5 py-3.5"><DSBadge status={STATUS_MAP[p.status] || "pending"} pulse /></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </DSCard>
        </div>
      </div>
    </Layout>
  );
}
