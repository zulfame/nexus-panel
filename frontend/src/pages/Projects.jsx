import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Plus, GitBranch, Globe, Boxes } from "lucide-react";
import api from "@/lib/api";
import { Layout, PageHeader } from "@/components/Layout";
import { StatusBadge } from "@/components/StatusBadge";
import { Button } from "@/components/ui/button";

export default function Projects() {
  const [projects, setProjects] = useState([]);
  const [loading, setLoading] = useState(true);
  const navigate = useNavigate();

  const load = async () => {
    try {
      const { data } = await api.get("/projects");
      setProjects(data);
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
      <div className="p-8">
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
                  <StatusBadge status={p.status} />
                </div>
                <div className="space-y-2 font-mono text-xs">
                  <div className="flex items-center gap-2 text-muted-foreground">
                    <Globe className="h-3.5 w-3.5" />
                    <span className="truncate">{p.domain || "no domain"}</span>
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
