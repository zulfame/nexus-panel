import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Plus, GitBranch, Globe, Boxes, ExternalLink, AlertTriangle } from "lucide-react";
import api from "@/lib/api";
import { Layout, PageHeader } from "@/components/Layout";
import { StatusBadge } from "@/components/StatusBadge";
import { SslBadge } from "@/components/SslBadge";
import { Button } from "@/components/ui/button";

export default function Projects() {
  const [projects, setProjects] = useState([]);
  const [ssl, setSsl] = useState({});
  const [loading, setLoading] = useState(true);
  const navigate = useNavigate();

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
      <PageHeader
        title="Projects"
        subtitle="All deployments managed on this server"
        actions={
          <Button
            data-testid="new-project-btn"
            onClick={() => navigate("/projects/new")}
            className="bg-white text-black hover:bg-white/85"
          >
            <Plus className="mr-1.5 h-4 w-4" /> New Project
          </Button>
        }
      />
      <div className="p-4 sm:p-6 lg:p-8">
        {loading ? (
          <div className="font-mono text-sm text-muted-foreground">Loading…</div>
        ) : projects.length === 0 ? (
          <div className="flex flex-col items-center justify-center border border-dashed border-border py-20 text-center">
            <Boxes className="mb-4 h-10 w-10 text-muted-foreground" />
            <p className="mb-1 font-heading text-lg font-bold">No projects yet</p>
            <p className="mb-5 font-mono text-sm text-muted-foreground">
              Pull a project from GitHub and deploy it on this server.
            </p>
            <Button data-testid="empty-new-project-btn" onClick={() => navigate("/projects/new")} className="bg-white text-black hover:bg-white/85">
              <Plus className="mr-1.5 h-4 w-4" /> Add Project
            </Button>
          </div>
        ) : (
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3">
            {projects.map((p) => (
              <div
                key={p.id}
                data-testid={`project-card-${p.slug}`}
                onClick={() => navigate(`/projects/${p.id}`)}
                className="group cursor-pointer border border-border bg-card p-5 transition-colors hover:border-white/30"
              >
                <div className="mb-4 flex items-start justify-between">
                  <div>
                    <h3 className="font-heading text-lg font-bold tracking-tight">{p.name}</h3>
                    <div className="mt-1 flex items-center gap-1.5 font-mono text-xs text-muted-foreground">
                      <GitBranch className="h-3 w-3" /> {p.branch}
                    </div>
                  </div>
                  <div className="flex flex-col items-end gap-1.5">
                    <StatusBadge status={p.status} />
                    <SslBadge ssl={ssl[p.id]} />
                    {p.env_missing_required?.length > 0 && (
                      <span
                        data-testid={`env-missing-badge-${p.slug}`}
                        title="Required variables not set — open Config then Scan Required Vars"
                        className="flex items-center gap-1 rounded-sm border border-amber-500/30 bg-amber-500/10 px-1.5 py-0.5 font-mono text-[10px] text-amber-400"
                      >
                        <AlertTriangle className="h-3 w-3" /> {p.env_missing_required.length} env missing
                      </span>
                    )}
                  </div>
                </div>
                <div className="space-y-2 font-mono text-xs">
                  <div className="flex items-center justify-between gap-2 text-muted-foreground">
                    <div className="flex items-center gap-2 truncate">
                      <Globe className="h-3.5 w-3.5 shrink-0" />
                      <span className="truncate">{p.domain || "no domain"}</span>
                    </div>
                    {p.domain && (
                      <a
                        data-testid={`open-url-${p.slug}`}
                        href={`${ssl[p.id] && (ssl[p.id].state === "active" || ssl[p.id].state === "expiring") ? "https" : "http"}://${p.domain}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        onClick={(e) => e.stopPropagation()}
                        className="flex shrink-0 items-center gap-1 text-status-running hover:underline"
                      >
                        <ExternalLink className="h-3.5 w-3.5" /> open
                      </a>
                    )}
                  </div>
                  <div className="flex items-center gap-2 text-muted-foreground">
                    <span className="text-status-running">FE</span> :{p.frontend_port}
                    <span className="ml-2 text-status-building">BE</span> :{p.backend_port}
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </Layout>
  );
}
