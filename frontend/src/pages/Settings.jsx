import { useEffect, useState } from "react";
import { toast } from "sonner";
import { CheckCircle2, XCircle, Server, ShieldCheck, KeyRound, Loader2 } from "lucide-react";
import api, { apiError } from "@/lib/api";
import { Layout, PageHeader } from "@/components/Layout";
import { useAuth } from "@/context/AuthContext";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

const field = "border-white/20 bg-transparent font-mono focus-visible:ring-1 focus-visible:ring-white";
const lbl = "font-mono text-xs uppercase tracking-wider text-muted-foreground";

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
  const [cur, setCur] = useState("");
  const [nw, setNw] = useState("");
  const [confirm, setConfirm] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    api.get("/capabilities").then((r) => setCaps(r.data)).catch(() => {});
  }, []);

  const changePassword = async (e) => {
    e.preventDefault();
    if (nw !== confirm) {
      toast.error("New password and confirmation do not match");
      return;
    }
    if (nw.length < 6) {
      toast.error("New password must be at least 6 characters");
      return;
    }
    setSaving(true);
    try {
      await api.post("/auth/change-password", { current_password: cur, new_password: nw });
      toast.success("Password updated");
      setCur(""); setNw(""); setConfirm("");
    } catch (err) {
      toast.error(apiError(err));
    } finally {
      setSaving(false);
    }
  };

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
            <span className="font-mono text-sm" data-testid="settings-username">{user?.username}</span>
          </div>
          <div className="flex items-center justify-between border-b border-border/60 py-3">
            <span className="font-mono text-sm text-muted-foreground">Email</span>
            <span className="font-mono text-sm" data-testid="settings-email">{user?.email || "—"}</span>
          </div>
          <p className="mt-3 font-mono text-[11px] text-muted-foreground">
            Login is protected against brute force (5 failed attempts = 15 min lockout).
          </p>
        </div>

        <div className="border border-border bg-card p-6">
          <div className="mb-4 flex items-center gap-2">
            <KeyRound className="h-4 w-4 text-status-building" />
            <h2 className="font-heading font-bold tracking-tight">Change Password</h2>
          </div>
          <form onSubmit={changePassword} className="space-y-4">
            <div className="space-y-2">
              <Label className={lbl}>Current Password</Label>
              <Input data-testid="current-password-input" type="password" className={field} value={cur} onChange={(e) => setCur(e.target.value)} />
            </div>
            <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
              <div className="space-y-2">
                <Label className={lbl}>New Password</Label>
                <Input data-testid="new-password-input" type="password" className={field} value={nw} onChange={(e) => setNw(e.target.value)} />
              </div>
              <div className="space-y-2">
                <Label className={lbl}>Confirm New Password</Label>
                <Input data-testid="confirm-password-input" type="password" className={field} value={confirm} onChange={(e) => setConfirm(e.target.value)} />
              </div>
            </div>
            <div className="flex justify-end">
              <Button data-testid="change-password-btn" type="submit" disabled={saving || !cur || !nw || !confirm} className="bg-white text-black hover:bg-white/85">
                {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : "Update Password"}
              </Button>
            </div>
          </form>
        </div>
      </div>
    </Layout>
  );
}
