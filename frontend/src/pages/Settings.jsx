import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import {
  CheckCircle2, XCircle, Server, ShieldCheck, KeyRound, Loader2,
  Send, Archive, RotateCcw, DatabaseBackup, HardDriveDownload,
} from "lucide-react";
import api, { apiError } from "@/lib/api";
import { Layout, PageHeader } from "@/components/Layout";
import { useAuth } from "@/context/AuthContext";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger,
} from "@/components/ui/alert-dialog";

const field = "border-white/20 bg-transparent focus-visible:ring-1 focus-visible:ring-white";
const lbl = "text-xs font-bold uppercase tracking-[0.1em] text-muted-foreground mb-1 block";
const card = "rounded-sm border border-border bg-card p-6";

function fmtBytes(b) {
  if (!b) return "0 B";
  const u = ["B", "KB", "MB", "GB"];
  const i = Math.floor(Math.log(b) / Math.log(1024));
  return `${(b / Math.pow(1024, i)).toFixed(1)} ${u[i]}`;
}
function fmtDate(ts) {
  return new Date(ts * 1000).toLocaleString();
}

function CapRow({ label, ok, note }) {
  return (
    <div className="flex items-center justify-between border-b border-border/60 py-3" data-testid={`cap-${label.toLowerCase().replace(/\s/g, "-")}`}>
      <div>
        <div className="text-sm">{label}</div>
        {note && <div className="text-[11px] text-muted-foreground">{note}</div>}
      </div>
      {ok ? (
        <span className="flex items-center gap-1.5 text-xs text-emerald-400"><CheckCircle2 className="h-4 w-4" strokeWidth={1.5} /> available</span>
      ) : (
        <span className="flex items-center gap-1.5 text-xs text-red-400"><XCircle className="h-4 w-4" strokeWidth={1.5} /> missing</span>
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
  const [opsInfo, setOpsInfo] = useState(null);
  const [backups, setBackups] = useState([]);
  const [busy, setBusy] = useState("");

  const loadOps = useCallback(async () => {
    try {
      const [i, b] = await Promise.all([api.get("/ops/info"), api.get("/ops/backups")]);
      setOpsInfo(i.data);
      setBackups(b.data);
    } catch (e) {}
  }, []);

  useEffect(() => {
    api.get("/capabilities").then((r) => setCaps(r.data)).catch(() => {});
    loadOps();
  }, [loadOps]);

  const changePassword = async (e) => {
    e.preventDefault();
    if (nw !== confirm) return toast.error("New password and confirmation do not match");
    if (nw.length < 6) return toast.error("New password must be at least 6 characters");
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

  const act = async (key, fn, msg) => {
    setBusy(key);
    try {
      const { data } = await fn();
      toast.success(data?.message || msg);
      setTimeout(loadOps, 1500);
    } catch (err) {
      toast.error(apiError(err));
    } finally {
      setBusy("");
    }
  };

  return (
    <Layout>
      <PageHeader title="Settings" subtitle="Capabilities, security, notifications & server operations" />
      <div className="max-w-3xl space-y-6 p-8">

        {/* Host capabilities */}
        <div className={card}>
          <div className="mb-4 flex items-center gap-2">
            <Server className="h-4 w-4 text-emerald-400" strokeWidth={1.5} />
            <h2 className="font-bold tracking-tight">Host Capabilities</h2>
          </div>
          {caps ? (
            <div>
              <CapRow label="Git" ok={caps.git} note="clone & pull private repos" />
              <CapRow label="Docker" ok={caps.docker} note="build & run project containers" />
              <CapRow label="Docker Compose" ok={caps.docker_compose} note="orchestrate backend + frontend" />
              <CapRow label="Nginx" ok={caps.nginx} note="reverse proxy per subdomain" />
              <CapRow label="Certbot" ok={caps.certbot} note="Let's Encrypt SSL issuance" />
            </div>
          ) : <div className="text-sm text-muted-foreground">Loading…</div>}
        </div>

        {/* Admin account */}
        <div className={card}>
          <div className="mb-4 flex items-center gap-2">
            <ShieldCheck className="h-4 w-4 text-emerald-400" strokeWidth={1.5} />
            <h2 className="font-bold tracking-tight">Admin Account</h2>
          </div>
          <div className="flex items-center justify-between border-b border-border/60 py-3">
            <span className="text-sm text-muted-foreground">Username</span>
            <span className="text-sm" data-testid="settings-username">{user?.username}</span>
          </div>
          <div className="flex items-center justify-between border-b border-border/60 py-3">
            <span className="text-sm text-muted-foreground">Email</span>
            <span className="text-sm" data-testid="settings-email">{user?.email || "—"}</span>
          </div>
          <p className="mt-3 text-[11px] text-muted-foreground">
            Login is protected against brute force (5 failed attempts = 15 min lockout).
          </p>
        </div>

        {/* Change password */}
        <div className={card}>
          <div className="mb-4 flex items-center gap-2">
            <KeyRound className="h-4 w-4 text-amber-400" strokeWidth={1.5} />
            <h2 className="font-bold tracking-tight">Change Password</h2>
          </div>
          <form onSubmit={changePassword} className="space-y-4">
            <div>
              <Label className={lbl}>Current Password</Label>
              <Input data-testid="current-password-input" type="password" className={field} value={cur} onChange={(e) => setCur(e.target.value)} />
            </div>
            <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
              <div>
                <Label className={lbl}>New Password</Label>
                <Input data-testid="new-password-input" type="password" className={field} value={nw} onChange={(e) => setNw(e.target.value)} />
              </div>
              <div>
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

        {/* Telegram notifications */}
        <div className={card}>
          <div className="mb-4 flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Send className="h-4 w-4 text-emerald-400" strokeWidth={1.5} />
              <h2 className="font-bold tracking-tight">Telegram Notifications</h2>
            </div>
            <span className="flex items-center gap-1.5 text-xs" data-testid="telegram-status">
              <span className={`h-1.5 w-1.5 rounded-full ${opsInfo?.telegram_configured ? "bg-emerald-500" : "bg-zinc-600"}`} />
              {opsInfo?.telegram_configured ? "connected" : "not configured"}
            </span>
          </div>
          <p className="mb-4 text-[11px] text-muted-foreground">
            Alerts are sent on deploy, backup, update and rollback events. Configure the bot token/chat id in the server config (nexus.conf / backend .env).
          </p>
          <Button
            data-testid="test-telegram-btn"
            variant="outline"
            disabled={busy === "tg" || !opsInfo?.telegram_configured}
            onClick={() => act("tg", () => api.post("/ops/telegram/test"), "Test message sent")}
            className="border-white/20 bg-transparent"
          >
            {busy === "tg" ? <Loader2 className="h-4 w-4 animate-spin" /> : <><Send className="mr-1.5 h-4 w-4" strokeWidth={1.5} /> Send test message</>}
          </Button>
        </div>

        {/* Server operations */}
        <div className={card}>
          <div className="mb-4 flex items-center justify-between">
            <div className="flex items-center gap-2">
              <DatabaseBackup className="h-4 w-4 text-emerald-400" strokeWidth={1.5} />
              <h2 className="font-bold tracking-tight">Server Operations</h2>
            </div>
            <span className="text-[11px] text-muted-foreground" data-testid="ops-current-release">
              release: {opsInfo?.current_release || "—"}
            </span>
          </div>

          {!opsInfo?.scripts_available && (
            <div className="mb-4 rounded-sm border border-amber-500/25 bg-amber-500/10 px-3 py-2 text-[11px] text-amber-400">
              Operations run on the VPS install (scripts not detected in this environment).
            </div>
          )}

          <div className="mb-5 flex flex-wrap gap-2">
            <Button
              data-testid="ops-backup-btn"
              disabled={busy === "backup"}
              onClick={() => act("backup", () => api.post("/ops/backup"), "Backup started")}
              className="bg-white text-black hover:bg-white/85"
            >
              {busy === "backup" ? <Loader2 className="h-4 w-4 animate-spin" /> : <><Archive className="mr-1.5 h-4 w-4" strokeWidth={1.5} /> Backup now</>}
            </Button>

            <AlertDialog>
              <AlertDialogTrigger asChild>
                <Button data-testid="ops-rollback-btn" variant="outline" className="border-white/20 bg-transparent">
                  <RotateCcw className="mr-1.5 h-4 w-4" strokeWidth={1.5} /> Rollback to previous
                </Button>
              </AlertDialogTrigger>
              <AlertDialogContent className="border-border bg-card">
                <AlertDialogHeader>
                  <AlertDialogTitle>Roll back the panel?</AlertDialogTitle>
                  <AlertDialogDescription className="text-xs">
                    Switches to the previous release and restarts the panel. You may be briefly disconnected.
                  </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel className="border-white/20 bg-transparent">Cancel</AlertDialogCancel>
                  <AlertDialogAction data-testid="confirm-rollback-btn" onClick={() => act("rollback", () => api.post("/ops/rollback"), "Rollback started")} className="bg-white text-black hover:bg-white/85">
                    Roll back
                  </AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
          </div>

          <div className="text-xs font-bold uppercase tracking-[0.1em] text-muted-foreground mb-2">
            Backups ({backups.length})
          </div>
          {backups.length === 0 ? (
            <div className="rounded-sm border border-dashed border-border py-6 text-center text-xs text-muted-foreground" data-testid="no-backups">
              No backups yet.
            </div>
          ) : (
            <div className="divide-y divide-border/60 rounded-sm border border-border">
              {backups.map((b) => (
                <div key={b.name} className="flex items-center justify-between px-3 py-2.5" data-testid={`backup-row-${b.name}`}>
                  <div className="min-w-0">
                    <div className="truncate text-xs">{b.name}</div>
                    <div className="text-[10px] text-muted-foreground">{fmtDate(b.created)} · {fmtBytes(b.size)}</div>
                  </div>
                  <AlertDialog>
                    <AlertDialogTrigger asChild>
                      <Button data-testid={`restore-btn-${b.name}`} variant="outline" size="sm" className="border-white/20 bg-transparent">
                        <HardDriveDownload className="mr-1.5 h-3.5 w-3.5" strokeWidth={1.5} /> Restore
                      </Button>
                    </AlertDialogTrigger>
                    <AlertDialogContent className="border-border bg-card">
                      <AlertDialogHeader>
                        <AlertDialogTitle>Restore this backup?</AlertDialogTitle>
                        <AlertDialogDescription className="text-xs">
                          Restores MongoDB and config from <span className="text-foreground">{b.name}</span>, overwriting current data, then restarts the panel.
                        </AlertDialogDescription>
                      </AlertDialogHeader>
                      <AlertDialogFooter>
                        <AlertDialogCancel className="border-white/20 bg-transparent">Cancel</AlertDialogCancel>
                        <AlertDialogAction data-testid={`confirm-restore-${b.name}`} onClick={() => act("restore", () => api.post("/ops/restore", { file: b.name }), "Restore started")} className="bg-white text-black hover:bg-white/85">
                          Restore
                        </AlertDialogAction>
                      </AlertDialogFooter>
                    </AlertDialogContent>
                  </AlertDialog>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </Layout>
  );
}
