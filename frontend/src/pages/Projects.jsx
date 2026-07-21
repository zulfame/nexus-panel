import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { toast } from "sonner";
import {
  Plus, GitBranch, Globe, Boxes, ExternalLink, AlertTriangle, Search, LayoutGrid, List,
  MoreVertical, Rocket, Play, Square, RotateCw, Trash2, ChevronLeft, ChevronRight, Activity, CircleDot, Loader2, PauseCircle, XCircle, ChevronRight as ArrowRight,
} from "lucide-react";
import api, { apiError } from "@/lib/api";
import { Layout } from "@/components/Layout";
import { SslBadge } from "@/components/SslBadge";
import "@/styles/design-system.css";
import { DSButton, DSCard, DSBadge, DSEmptyState, DSSkeleton, DSInput, DSSelect } from "@/components/ds";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

const STATUS_MAP = { running: "running", building: "building", cloning: "deploying", created: "pending", error: "failed", stopped: "stopped" };
const PER_PAGE = 8;

const STAT_DEFS = [
  { key: "total", label: "Total Projects", sub: "All time", icon: Boxes, tone: "text-[var(--ds-primary)]" },
  { key: "running", label: "Running", sub: "Active deployments", icon: Activity, tone: "text-[var(--ds-success)]" },
  { key: "deploying", label: "Deploying", sub: "In progress", icon: Loader2, tone: "text-sky-400" },
  { key: "stopped", label: "Stopped", sub: "Not running", icon: PauseCircle, tone: "text-[var(--ds-muted)]" },
  { key: "failed", label: "Failed", sub: "Need attention", icon: XCircle, tone: "text-[var(--ds-danger)]" },
];

function timeAgo(dateStr) {
  if (!dateStr) return "—";
  const d = new Date(dateStr);
  if (isNaN(d)) return "—";
  const s = Math.floor((Date.now() - d.getTime()) / 1000);
  if (s < 60) return "just now";
  const m = Math.floor(s / 60); if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60); if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}

function Meter({ label, value, max, color }) {
  const pct = Math.min(100, max ? (value / max) * 100 : 0);
  return (
    <div className="min-w-0 flex-1">
      <div className="mb-1 flex items-baseline gap-1.5 text-[11px]">
        <span className="text-[var(--ds-muted)]">{label}</span>
        <span className="font-mono text-[var(--ds-text)]">{value}</span>
      </div>
      <div className="h-1 w-full overflow-hidden rounded-full bg-[var(--ds-border)]">
        <div className="h-full rounded-full" style={{ width: `${pct}%`, background: color }} />
      </div>
    </div>
  );
}

export default function Projects() {
  const [projects, setProjects] = useState([]);
  const [ssl, setSsl] = useState({});
  const [stats, setStats] = useState({});
  const [loading, setLoading] = useState(true);
  const [query, setQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [sort, setSort] = useState("newest");
  const [view, setView] = useState("grid");
  const [page, setPage] = useState(1);
  const [busyId, setBusyId] = useState(null);
  const navigate = useNavigate();

  const load = async () => {
    try {
      const [{ data }, s, st] = await Promise.all([
        api.get("/projects"),
        api.get("/system/ssl-status").catch(() => ({ data: {} })),
        api.get("/system/containers-stats").catch(() => ({ data: {} })),
      ]);
      setProjects(data);
      setSsl(s.data || {});
      setStats(st.data || {});
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
    const t = setInterval(load, 5000);
    return () => clearInterval(t);
  }, []);

  const counts = useMemo(() => {
    const c = { total: projects.length, running: 0, deploying: 0, stopped: 0, failed: 0 };
    projects.forEach((p) => {
      const m = STATUS_MAP[p.status];
      if (m === "running") c.running++;
      else if (m === "deploying" || m === "building") c.deploying++;
      else if (m === "stopped") c.stopped++;
      else if (m === "failed") c.failed++;
    });
    return c;
  }, [projects]);

  const filtered = useMemo(() => {
    let list = projects.filter((p) => {
      const q = query.trim().toLowerCase();
      const matchQ = !q || p.name.toLowerCase().includes(q) || (p.domain || "").toLowerCase().includes(q) || (p.slug || "").toLowerCase().includes(q);
      const matchS = statusFilter === "all" || STATUS_MAP[p.status] === statusFilter;
      return matchQ && matchS;
    });
    list = [...list].sort((a, b) => {
      if (sort === "name") return a.name.localeCompare(b.name);
      const da = new Date(a.created_at || 0).getTime(), db = new Date(b.created_at || 0).getTime();
      return sort === "oldest" ? da - db : db - da;
    });
    return list;
  }, [projects, query, statusFilter, sort]);

  const totalPages = Math.max(1, Math.ceil(filtered.length / PER_PAGE));
  const pageItems = filtered.slice((page - 1) * PER_PAGE, page * PER_PAGE);
  useEffect(() => { if (page > totalPages) setPage(1); }, [totalPages, page]);

  const quickAction = async (p, action) => {
    setBusyId(p.id);
    try {
      await api.post(`/projects/${p.id}/${action}`);
      toast.success(`${action} triggered for ${p.name}`);
      load();
    } catch (e) { toast.error(apiError(e)); }
    finally { setBusyId(null); }
  };
  const removeProject = async (p) => {
    setBusyId(p.id);
    try { await api.delete(`/projects/${p.id}`); toast.success(`${p.name} deleted`); load(); }
    catch (e) { toast.error(apiError(e)); }
    finally { setBusyId(null); }
  };

  const openHref = (p) => `${ssl[p.id] && (ssl[p.id].state === "active" || ssl[p.id].state === "expiring") ? "https" : "http"}://${p.domain}`;

  return (
    <Layout>
      <div className="min-h-screen">
        <header className="sticky top-14 z-20 flex flex-wrap items-center justify-between gap-3 border-b border-[var(--ds-border)] bg-[var(--ds-page)]/85 px-4 py-5 backdrop-blur-xl sm:px-8 lg:top-0">
          <div>
            <h1 className="text-[24px] font-bold tracking-tight text-[var(--ds-text)]">Projects</h1>
            <p className="mt-0.5 text-[13px] text-[var(--ds-muted)]">All deployments managed on this server</p>
          </div>
          <DSButton data-testid="new-project-btn" variant="primary" icon={Plus} onClick={() => navigate("/projects/new")}>New Project</DSButton>
        </header>

        <div className="p-4 sm:p-6 lg:p-8">
          {/* stat cards */}
          <div className="mb-6 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5" data-testid="project-stats">
            {STAT_DEFS.map((s) => (
              <div key={s.key} className="rounded-xl border border-[var(--ds-border)] bg-[var(--ds-card)] p-4" data-testid={`stat-${s.key}`}>
                <div className="flex items-center gap-1.5 text-[var(--ds-muted)]">
                  <CircleDot className="hidden" />
                  <s.icon className={`h-3.5 w-3.5 ${s.tone}`} />
                  <span className="text-[11px] uppercase tracking-wider">{s.label}</span>
                </div>
                <div className={`mt-2 text-[28px] font-bold leading-none ${s.tone}`}>{counts[s.key]}</div>
                <div className="mt-1.5 text-[11px] text-[var(--ds-muted)]">{s.sub}</div>
              </div>
            ))}
          </div>

          {/* toolbar */}
          <div className="mb-6 flex flex-wrap items-center gap-3">
            <div className="relative min-w-[200px] flex-1">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[var(--ds-muted)]" />
              <DSInput data-testid="project-search" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search projects…" className="pl-9" />
            </div>
            <div className="w-[150px]">
              <DSSelect data-testid="filter-status" value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}>
                <option value="all">All Status</option>
                <option value="running">Running</option>
                <option value="deploying">Deploying</option>
                <option value="building">Building</option>
                <option value="stopped">Stopped</option>
                <option value="pending">Pending</option>
                <option value="failed">Failed</option>
              </DSSelect>
            </div>
            <div className="w-[160px]">
              <DSSelect data-testid="sort-select" value={sort} onChange={(e) => setSort(e.target.value)}>
                <option value="newest">Sort: Newest</option>
                <option value="oldest">Sort: Oldest</option>
                <option value="name">Sort: Name</option>
              </DSSelect>
            </div>
            <div className="flex overflow-hidden rounded-[var(--ds-radius-btn)] border border-[var(--ds-border)]">
              <button data-testid="view-grid" onClick={() => setView("grid")} className={`flex h-9 w-9 items-center justify-center ${view === "grid" ? "bg-[var(--ds-primary)] text-white" : "text-[var(--ds-muted)] hover:bg-[var(--ds-hover)]"}`}><LayoutGrid className="h-4 w-4" /></button>
              <button data-testid="view-list" onClick={() => setView("list")} className={`flex h-9 w-9 items-center justify-center ${view === "list" ? "bg-[var(--ds-primary)] text-white" : "text-[var(--ds-muted)] hover:bg-[var(--ds-hover)]"}`}><List className="h-4 w-4" /></button>
            </div>
          </div>

          {loading ? (
            <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
              {[0, 1, 2, 3].map((i) => (
                <DSCard key={i} className="space-y-3 p-5"><DSSkeleton className="h-5 w-1/2" /><DSSkeleton className="h-3 w-1/3" /><DSSkeleton className="h-3 w-full" /><DSSkeleton className="h-3 w-2/3" /></DSCard>
              ))}
            </div>
          ) : projects.length === 0 ? (
            <DSCard className="border-dashed">
              <DSEmptyState icon={Boxes} title="No projects yet" description="Pull a project from GitHub and deploy it on this server."
                action={<DSButton data-testid="empty-new-project-btn" variant="primary" icon={Plus} onClick={() => navigate("/projects/new")}>Add Project</DSButton>} />
            </DSCard>
          ) : (
            <>
              <div className={view === "grid" ? "grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4" : "flex flex-col gap-3"}>
                {pageItems.map((p) => {
                  const m = STATUS_MAP[p.status] || "pending";
                  const st = stats[p.id];
                  const deploying = m === "deploying" || m === "building";
                  return (
                    <DSCard key={p.id} hover data-testid={`project-card-${p.slug}`} onClick={() => navigate(`/projects/${p.id}`)} className="flex cursor-pointer flex-col p-5">
                      <div className="mb-3 flex items-start justify-between gap-2">
                        <h3 className="min-w-0 flex-1 truncate text-[15px] font-semibold tracking-tight text-[var(--ds-text)]">{p.name}</h3>
                        <div className="flex shrink-0 items-center gap-1.5">
                          <DSBadge status={m} pulse />
                          <DropdownMenu>
                            <DropdownMenuTrigger asChild onClick={(e) => e.stopPropagation()}>
                              <button data-testid={`project-menu-${p.slug}`} className="flex h-6 w-6 items-center justify-center rounded-md text-[var(--ds-muted)] hover:bg-[var(--ds-hover)] hover:text-[var(--ds-text)]"><MoreVertical className="h-4 w-4" /></button>
                            </DropdownMenuTrigger>
                            <DropdownMenuContent align="end" className="border-[var(--ds-border)] bg-[var(--ds-card)]" onClick={(e) => e.stopPropagation()}>
                              <DropdownMenuItem data-testid={`menu-open-${p.slug}`} onClick={() => navigate(`/projects/${p.id}`)}><ExternalLink className="mr-2 h-3.5 w-3.5" /> Open details</DropdownMenuItem>
                              <DropdownMenuItem data-testid={`menu-deploy-${p.slug}`} onClick={() => quickAction(p, "deploy")}><Rocket className="mr-2 h-3.5 w-3.5" /> Deploy</DropdownMenuItem>
                              {m === "running"
                                ? <DropdownMenuItem data-testid={`menu-stop-${p.slug}`} onClick={() => quickAction(p, "stop")}><Square className="mr-2 h-3.5 w-3.5" /> Stop</DropdownMenuItem>
                                : <DropdownMenuItem data-testid={`menu-start-${p.slug}`} onClick={() => quickAction(p, "start")}><Play className="mr-2 h-3.5 w-3.5" /> Start</DropdownMenuItem>}
                              <DropdownMenuItem data-testid={`menu-restart-${p.slug}`} onClick={() => quickAction(p, "restart")}><RotateCw className="mr-2 h-3.5 w-3.5" /> Restart</DropdownMenuItem>
                              <DropdownMenuSeparator className="bg-[var(--ds-border)]" />
                              <DropdownMenuItem data-testid={`menu-delete-${p.slug}`} onClick={() => removeProject(p)} className="text-[var(--ds-danger)] focus:text-[var(--ds-danger)]"><Trash2 className="mr-2 h-3.5 w-3.5" /> Delete</DropdownMenuItem>
                            </DropdownMenuContent>
                          </DropdownMenu>
                        </div>
                      </div>

                      <div className="flex items-center justify-between gap-2">
                        <div className="flex min-w-0 items-center gap-1.5 font-mono text-[13px] text-[var(--ds-muted)]"><GitBranch className="h-3.5 w-3.5 shrink-0" /><span className="truncate">{p.branch}</span></div>
                        <SslBadge ssl={ssl[p.id]} />
                      </div>

                      <div className="mt-2 flex items-center justify-between gap-2 text-[13px] text-[var(--ds-muted)]">
                        <div className="flex min-w-0 items-center gap-1.5"><Globe className="h-3.5 w-3.5 shrink-0" /><span className="truncate">{p.domain || "no domain"}</span></div>
                        {p.domain && <a data-testid={`open-url-${p.slug}`} href={openHref(p)} target="_blank" rel="noopener noreferrer" onClick={(e) => e.stopPropagation()} className="flex shrink-0 items-center gap-1 text-[var(--ds-primary)] hover:underline"><ExternalLink className="h-3.5 w-3.5" /> open</a>}
                      </div>

                      <div className="mt-2 flex items-center gap-3 font-mono text-[13px]">
                        <span><span className="text-[var(--ds-success)]">FE</span> <span className="text-[var(--ds-muted)]">:</span> {p.frontend_port || "—"}</span>
                        <span><span className="text-[var(--ds-warning)]">BE</span> <span className="text-[var(--ds-muted)]">:</span> {p.backend_port || "—"}</span>
                      </div>

                      {p.env_missing_required?.length > 0 && (
                        <span data-testid={`env-missing-badge-${p.slug}`} className="mt-3 flex w-fit items-center gap-1 rounded-md border border-[var(--ds-warning)]/30 bg-[var(--ds-warning)]/10 px-1.5 py-0.5 text-[10px] text-[var(--ds-warning)]"><AlertTriangle className="h-3 w-3" /> {p.env_missing_required.length} env missing</span>
                      )}

                      {/* contextual footer */}
                      <div className="mt-auto pt-4">
                        {m === "failed" ? (
                          <button data-testid={`failed-alert-${p.slug}`} onClick={(e) => { e.stopPropagation(); navigate(`/projects/${p.id}`); }} className="flex w-full items-center justify-between gap-2 rounded-lg border border-[var(--ds-danger)]/40 bg-[var(--ds-danger)]/10 px-3 py-2 text-left">
                            <div className="flex items-center gap-2"><AlertTriangle className="h-4 w-4 text-[var(--ds-danger)]" /><div><div className="text-[13px] font-medium text-[var(--ds-danger)]">Deployment failed</div><div className="text-[11px] text-[var(--ds-muted)]">Check logs for details</div></div></div>
                            <ArrowRight className="h-4 w-4 text-[var(--ds-danger)]" />
                          </button>
                        ) : deploying ? (
                          (() => {
                            const steps = ["Cloning", "Building", "Starting"];
                            const idx = p.status === "cloning" ? 0 : p.status === "building" ? 1 : 2;
                            const pct = ((idx + 1) / steps.length) * 100;
                            return (
                              <div data-testid={`deploying-bar-${p.slug}`}>
                                <div className="mb-1.5 flex items-center justify-between text-[12px]">
                                  <span className="flex items-center gap-1.5 text-[var(--ds-primary)]"><Loader2 className="h-3.5 w-3.5 animate-spin" /> {steps[idx]}…</span>
                                  <span className="text-[var(--ds-muted)]">Step {idx + 1} of {steps.length}</span>
                                </div>
                                <div className="h-1.5 w-full overflow-hidden rounded-full bg-[var(--ds-border)]">
                                  <div className="h-full rounded-full bg-[var(--ds-primary)] transition-all duration-500" style={{ width: `${pct}%` }} />
                                </div>
                                <div className="mt-1.5 flex gap-1">
                                  {steps.map((s, i) => (
                                    <span key={s} className={`flex-1 text-center text-[10px] ${i <= idx ? "text-[var(--ds-primary)]" : "text-[var(--ds-muted)]/60"}`}>{s}</span>
                                  ))}
                                </div>
                              </div>
                            );
                          })()
                        ) : m === "stopped" ? (
                          <DSButton data-testid={`start-btn-${p.slug}`} variant="outline" icon={busyId === p.id ? undefined : Play} loading={busyId === p.id} className="w-full" onClick={(e) => { e.stopPropagation(); quickAction(p, "start"); }}>Start Project</DSButton>
                        ) : st ? (
                          <div className="flex items-center gap-4">
                            <Meter label="CPU" value={`${st.cpu}%`} max={100} color="var(--ds-success)" />
                            <Meter label="RAM" value={`${st.mem_mb}MB`} max={1024} color="#8b5cf6" />
                          </div>
                        ) : (
                          <div className="text-[12px] text-[var(--ds-muted)]">Updated {timeAgo(p.updated_at)}</div>
                        )}
                      </div>
                    </DSCard>
                  );
                })}
              </div>

              <div className="mt-6 flex flex-wrap items-center justify-between gap-3">
                <span className="text-[13px] text-[var(--ds-muted)]" data-testid="projects-count">
                  Showing {filtered.length === 0 ? 0 : (page - 1) * PER_PAGE + 1} to {Math.min(page * PER_PAGE, filtered.length)} of {filtered.length} projects
                </span>
                {totalPages > 1 && (
                  <div className="flex items-center gap-1.5">
                    <button data-testid="page-prev" disabled={page === 1} onClick={() => setPage((x) => Math.max(1, x - 1))} className="flex h-9 w-9 items-center justify-center rounded-md border border-[var(--ds-border)] text-[var(--ds-muted)] hover:bg-[var(--ds-hover)] disabled:opacity-40"><ChevronLeft className="h-4 w-4" /></button>
                    {Array.from({ length: totalPages }, (_, i) => i + 1).map((n) => (
                      <button key={n} data-testid={`page-${n}`} onClick={() => setPage(n)} className={`h-9 w-9 rounded-md text-[13px] font-medium ${n === page ? "bg-[var(--ds-primary)] text-white" : "border border-[var(--ds-border)] text-[var(--ds-text-secondary)] hover:bg-[var(--ds-hover)]"}`}>{n}</button>
                    ))}
                    <button data-testid="page-next" disabled={page === totalPages} onClick={() => setPage((x) => Math.min(totalPages, x + 1))} className="flex h-9 w-9 items-center justify-center rounded-md border border-[var(--ds-border)] text-[var(--ds-muted)] hover:bg-[var(--ds-hover)] disabled:opacity-40"><ChevronRight className="h-4 w-4" /></button>
                  </div>
                )}
              </div>
            </>
          )}
        </div>
      </div>
    </Layout>
  );
}
