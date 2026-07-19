import { useEffect, useState } from "react";
import { CheckCircle2, XCircle, Server, ShieldCheck } from "lucide-react";
import api from "@/lib/api";
import { Layout, PageHeader } from "@/components/Layout";
import { useAuth } from "@/context/AuthContext";

function CapRow({ label, ok, note }) {
  return (
    <div className="flex items-center justify-between border-b border-border/60 py-3" data-testid={`cap-${label.toLowerCase().replace(/\s/g, "-")}`}>
      <div>
        <div className="font-mono text-sm">{label}</div>
        {note && <div className="font-mono text-[11px] text-muted-foreground">{note}</div>}
      </div>
      {ok ? (
        <span className="flex items-center gap-1.5 font-mono text-xs text-status-running"><CheckCircle2 className="h-4 w-4" /> available</span>
      ) : (
        <span className="flex items-center gap-1.5 font-mono text-xs text-status-error"><XCircle className="h-4 w-4" /> missing</span>
      )}
    </div>
  );
}

export default function Settings() {
  const { user } = useAuth();
  const [caps, setCaps] = useState(null);

  useEffect(() => {
    api.get("/capabilities").then((r) => setCaps(r.data)).catch(() => {});
  }, []);

  return (
    <Layout>
      <PageHeader title="Settings" subtitle="Server capabilities & panel configuration" />
      <div className="max-w-3xl space-y-6 p-8">
        <div className="border border-border bg-card p-6">
          <div className="mb-4 flex items-center gap-2">
            <Server className="h-4 w-4 text-status-running" />
            <h2 className="font-heading font-bold tracking-tight">Host Capabilities</h2>
          </div>
          <p className="mb-4 font-mono text-xs text-muted-foreground">
            The panel automatically detects tools on the host. Deployment features require these on your VPS.
          </p>
          {caps ? (
            <div>
              <CapRow label="Git" ok={caps.git} note="clone & pull private repos" />
              <CapRow label="Docker" ok={caps.docker} note="build & run project containers" />
              <CapRow label="Docker Compose" ok={caps.docker_compose} note="orchestrate backend + frontend" />
              <CapRow label="Nginx" ok={caps.nginx} note="reverse proxy per subdomain" />
              <CapRow label="Certbot" ok={caps.certbot} note="Let's Encrypt SSL issuance" />
            </div>
          ) : (
            <div className="font-mono text-sm text-muted-foreground">Loading…</div>
          )}
        </div>

        <div className="border border-border bg-card p-6">
          <div className="mb-4 flex items-center gap-2">
            <ShieldCheck className="h-4 w-4 text-status-running" />
            <h2 className="font-heading font-bold tracking-tight">Admin Account</h2>
          </div>
          <div className="flex items-center justify-between border-b border-border/60 py-3">
            <span className="font-mono text-sm text-muted-foreground">Username</span>
            <span className="font-mono text-sm">{user?.username}</span>
          </div>
          <p className="mt-4 font-mono text-[11px] text-muted-foreground">
            Credentials are set via ADMIN_USERNAME / ADMIN_PASSWORD in backend/.env. Update the env and restart to rotate.
          </p>
        </div>
      </div>
    </Layout>
  );
}
