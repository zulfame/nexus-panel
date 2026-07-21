import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Plus, GitBranch, Globe, Boxes, ExternalLink, AlertTriangle } from "lucide-react";
import api from "@/lib/api";
import { Layout } from "@/components/Layout";
import { SslBadge } from "@/components/SslBadge";
import { useDsTheme } from "@/lib/dsTheme";
import "@/styles/design-system.css";
import { DSButton, DSCard, DSBadge, DSEmptyState, DSSkeleton } from "@/components/ds";

const STATUS_MAP = { running: "running", building: "building", cloning: "deploying", created: "pending", error: "failed", stopped: "stopped" };

export default function Projects() {
  const [projects, setProjects] = useState([]);
  const [ssl, setSsl] = useState({});
  const [loading, setLoading] = useState(true);
  const navigate = useNavigate();
  const { dsClass } = useDsTheme();

  const load = async () => {
    try {
      const [{ data }, s] = await Promise.all([
        api.get("/projects"),
        api.get("/system/ssl-status").catch(() => ({ data: {} })),
      ]);
      setProjects(data);
      setSsl(s.data || {});
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
    const t = setInterval(load, 5000);
    return () => clearInterval(t);
  }, []);

  return (
    <Layout>
      <div className={`${dsClass} min-h-screen`}>
        <header className="sticky top-14 z-20 flex flex-wrap items-center justify-between gap-3 border-b border-[var(--ds-border)] bg-[var(--ds-page)]/85 px-4 py-5 backdrop-blur-xl sm:px-8 lg:top-0">
          <div>
            <h1 className="text-[24px] font-bold tracking-tight text-[var(--ds-text)]">Projects</h1>
            <p className="mt-0.5 text-[13px] text-[var(--ds-muted)]">All deployments managed on this server</p>
          </div>
          <DSButton data-testid="new-project-btn" variant="primary" icon={Plus} onClick={() => navigate("/projects/new")}>
            New Project
          </DSButton>
        </header>

        <div className="p-4 sm:p-6 lg:p-8">
          {loading ? (
            <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3">
              {[0, 1, 2].map((i) => (
                <DSCard key={i} className="space-y-3 p-5">
                  <DSSkeleton className="h-5 w-1/2" />
                  <DSSkeleton className="h-3 w-1/3" />
                  <DSSkeleton className="h-3 w-full" />
                  <DSSkeleton className="h-3 w-2/3" />
                </DSCard>
              ))}
            </div>
          ) : projects.length === 0 ? (
            <DSCard className="border-dashed">
              <DSEmptyState
                icon={Boxes}
                title="No projects yet"
                description="Pull a project from GitHub and deploy it on this server."
                action={<DSButton data-testid="empty-new-project-btn" variant="primary" icon={Plus} onClick={() => navigate("/projects/new")}>Add Project</DSButton>}
              />
            </DSCard>
          ) : (
            <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3">
              {projects.map((p) => (
                <DSCard
                  key={p.id}
                  hover
                  data-testid={`project-card-${p.slug}`}
                  onClick={() => navigate(`/projects/${p.id}`)}
                  className="cursor-pointer p-5"
                >
                  <div className="mb-4 flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <h3 className="truncate text-lg font-semibold tracking-tight text-[var(--ds-text)]">{p.name}</h3>
                      <div className="mt-1 flex items-center gap-1.5 font-mono text-xs text-[var(--ds-muted)]">
                        <GitBranch className="h-3 w-3" /> {p.branch}
                      </div>
                    </div>
                    <div className="flex shrink-0 flex-col items-end gap-1.5">
                      <DSBadge status={STATUS_MAP[p.status] || "pending"} pulse />
                      <SslBadge ssl={ssl[p.id]} />
                      {p.env_missing_required?.length > 0 && (
                        <span data-testid={`env-missing-badge-${p.slug}`}
                          title="Required variables not set — open Config then Scan Required Vars"
                          className="flex items-center gap-1 rounded-md border border-[var(--ds-warning)]/30 bg-[var(--ds-warning)]/10 px-1.5 py-0.5 text-[10px] text-[var(--ds-warning)]">
                          <AlertTriangle className="h-3 w-3" /> {p.env_missing_required.length} env missing
                        </span>
                      )}
                    </div>
                  </div>
                  <div className="space-y-2 text-[13px]">
                    <div className="flex items-center justify-between gap-2 text-[var(--ds-muted)]">
                      <div className="flex min-w-0 items-center gap-2">
                        <Globe className="h-3.5 w-3.5 shrink-0" />
                        <span className="truncate">{p.domain || "no domain"}</span>
                      </div>
                      {p.domain && (
                        <a data-testid={`open-url-${p.slug}`}
                          href={`${ssl[p.id] && (ssl[p.id].state === "active" || ssl[p.id].state === "expiring") ? "https" : "http"}://${p.domain}`}
                          target="_blank" rel="noopener noreferrer" onClick={(e) => e.stopPropagation()}
                          className="flex shrink-0 items-center gap-1 text-[var(--ds-primary)] hover:underline">
                          <ExternalLink className="h-3.5 w-3.5" /> open
                        </a>
                      )}
                    </div>
                    <div className="flex items-center gap-2 font-mono text-[var(--ds-muted)]">
                      <span className="text-[var(--ds-success)]">FE</span>:{p.frontend_port}
                      <span className="ml-2 text-[var(--ds-warning)]">BE</span>:{p.backend_port}
                    </div>
                  </div>
                </DSCard>
              ))}
            </div>
          )}
        </div>
      </div>
    </Layout>
  );
}
