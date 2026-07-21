import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { toast } from "sonner";
import {
  CheckCircle2, XCircle, Server, ShieldCheck, KeyRound, Loader2,
  Send, Archive, RotateCcw, DatabaseBackup, HardDriveDownload, Palette, Users2, UserPlus, Trash2,
} from "lucide-react";
import api, { apiError } from "@/lib/api";
import { Layout, PageHeader } from "@/components/Layout";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { useAuth } from "@/context/AuthContext";
import { useBranding } from "@/context/BrandingContext";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
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

function ImageField({ label, value, onChange, testid }) {
  const [mode, setMode] = useState("url");
  const tab = (m) =>
    `rounded-sm border px-2.5 py-1 text-[11px] font-medium transition-colors ${
      mode === m ? "border-emerald-500/40 bg-emerald-500/10 text-emerald-300" : "border-white/15 text-muted-foreground hover:bg-white/5"
    }`;
  const onFile = (e) => {
    const f = e.target.files?.[0];
    if (!f) return;
    if (f.size > 2 * 1024 * 1024) return toast.error("Image too large (max 2MB)");
    const reader = new FileReader();
    reader.onload = () => onChange(String(reader.result));
    reader.readAsDataURL(f);
  };
  return (
    <div>
      <Label className={lbl}>{label}</Label>
      <div className="mb-2 flex gap-1.5">
        <button type="button" className={tab("url")} onClick={() => setMode("url")} data-testid={`${testid}-mode-url`}>URL</button>
        <button type="button" className={tab("upload")} onClick={() => setMode("upload")} data-testid={`${testid}-mode-upload`}>Upload</button>
      </div>
      <div className="flex items-center gap-3">
        {mode === "url" ? (
          <Input
            value={value && value.startsWith("data:") ? "" : value || ""}
            onChange={(e) => onChange(e.target.value)}
            placeholder="https://example.com/logo.png"
            className={field}
            data-testid={`${testid}-url`}
          />
        ) : (
          <input type="file" accept="image/*" onChange={onFile} data-testid={`${testid}-file`}
            className="block w-full text-xs text-muted-foreground file:mr-3 file:rounded-sm file:border-0 file:bg-emerald-500/15 file:px-3 file:py-1.5 file:text-emerald-300" />
        )}
        {value ? (
          <img src={value} alt="preview" className="h-10 w-10 shrink-0 rounded-sm border border-border bg-black/40 object-contain" />
        ) : null}
      </div>
    </div>
  );
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
  const { branding, refresh: refreshBranding } = useBranding();
  const [brand, setBrand] = useState(null);
  const [savingBrand, setSavingBrand] = useState(false);

  const [users, setUsers] = useState([]);
  const [newUser, setNewUser] = useState({ username: "", email: "", password: "" });
  const [addingUser, setAddingUser] = useState(false);
  const [addOpen, setAddOpen] = useState(false);
  const me = user?.username;

  const [tg, setTg] = useState(null);
  const [savingTg, setSavingTg] = useState(false);
  const loadTelegram = useCallback(async () => {
    try {
      const { data } = await api.get("/settings/telegram");
      setTg({ ...data, bot_token: "" });
    } catch (e) { /* ignore */ }
  }, []);
  useEffect(() => { loadTelegram(); }, [loadTelegram]);

  const saveTelegram = async () => {
    setSavingTg(true);
    try {
      const { data } = await api.put("/settings/telegram", {
        bot_token: tg.bot_token || "",
        chat_id: tg.chat_id || "",
        thread_id: tg.thread_id || "",
      });
      setTg({ ...data, bot_token: "" });
      toast.success(data.configured ? "Telegram connected" : "Telegram settings saved");
    } catch (e) {
      toast.error(apiError(e));
    } finally {
      setSavingTg(false);
    }
  };

  const loadUsers = useCallback(async () => {
    try {
      const { data } = await api.get("/auth/users");
      setUsers(data);
    } catch (e) { /* ignore */ }
  }, []);
  useEffect(() => { loadUsers(); }, [loadUsers]);

  const addUser = async () => {
    setAddingUser(true);
    try {
      await api.post("/auth/users", newUser);
      toast.success(`User '${newUser.username}' created`);
      setNewUser({ username: "", email: "", password: "" });
      setAddOpen(false);
      loadUsers();
    } catch (e) {
      toast.error(apiError(e));
    } finally {
      setAddingUser(false);
    }
  };

  const removeUser = async (username) => {
    try {
      await api.delete(`/auth/users/${username}`);
      toast.success(`User '${username}' removed`);
      loadUsers();
    } catch (e) {
      toast.error(apiError(e));
    }
  };

  useEffect(() => {
    if (brand === null && branding) {
      setBrand({
        system_name: branding.system_name || "",
        tagline: branding.tagline || "",
        logo: branding.logo || "",
        favicon: branding.favicon || "",
      });
    }
  }, [branding, brand]);

  const saveBranding = async () => {
    setSavingBrand(true);
    try {
      await api.put("/settings/branding", brand);
      await refreshBranding();
      toast.success("Panel identity updated");
    } catch (e) {
      toast.error(apiError(e));
    } finally {
      setSavingBrand(false);
    }
  };

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
      <PageHeader
        title="Settings"
        subtitle="Capabilities, security, notifications & server operations"
        actions={
          <Link
            to="/design-system"
            data-testid="ds-nav-link"
            className="inline-flex items-center gap-1.5 rounded-sm border border-border bg-transparent px-3 py-1.5 text-xs text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
          >
            <Palette className="h-3.5 w-3.5" /> Design System
          </Link>
        }
      />
      <div className="p-4 sm:p-6 lg:p-8">
        <Tabs defaultValue="account">
          <TabsList className="mb-6 flex h-auto w-full flex-wrap justify-start gap-1 rounded-none bg-transparent p-0">
            <TabsTrigger value="account" data-testid="settings-tab-account" className="data-[state=active]:bg-white/10">Account</TabsTrigger>
            <TabsTrigger value="users" data-testid="settings-tab-users" className="data-[state=active]:bg-white/10">Users</TabsTrigger>
            <TabsTrigger value="identity" data-testid="settings-tab-identity" className="data-[state=active]:bg-white/10">Identity</TabsTrigger>
            <TabsTrigger value="notifications" data-testid="settings-tab-notifications" className="data-[state=active]:bg-white/10">Notifications</TabsTrigger>
            <TabsTrigger value="system" data-testid="settings-tab-system" className="data-[state=active]:bg-white/10">System</TabsTrigger>
          </TabsList>

        <TabsContent value="users">
        {/* Users (multi-user, equal access) */}
        <div className={card} data-testid="users-card">
          <div className="mb-4 flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Users2 className="h-4 w-4 text-emerald-400" strokeWidth={1.5} />
              <h2 className="font-bold tracking-tight">Users</h2>
            </div>
            <Button size="sm" onClick={() => setAddOpen(true)} data-testid="open-add-user" className="h-8 bg-emerald-500 text-black hover:bg-emerald-500/85">
              <UserPlus className="mr-1.5 h-3.5 w-3.5" /> Add User
            </Button>
          </div>
          <div className="overflow-x-auto rounded-sm border border-border">
            <table className="w-full min-w-[420px] text-left text-sm">
              <thead className="border-b border-border text-xs uppercase tracking-wider text-muted-foreground">
                <tr>
                  <th className="px-4 py-2.5 font-medium">Username</th>
                  <th className="px-4 py-2.5 font-medium">Email</th>
                  <th className="px-4 py-2.5 font-medium">Created</th>
                  <th className="px-4 py-2.5 text-right font-medium">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border/60" data-testid="users-list">
                {users.map((u) => (
                  <tr key={u.username} className="hover:bg-white/[0.02]">
                    <td className="px-4 py-3 font-mono text-sm">
                      {u.username}
                      {u.is_seed && <span className="ml-2 rounded-sm border border-white/15 px-1.5 py-0.5 text-[10px] text-muted-foreground">seed</span>}
                      {u.username === me && <span className="ml-2 rounded-sm border border-emerald-500/30 bg-emerald-500/10 px-1.5 py-0.5 text-[10px] text-emerald-300">you</span>}
                    </td>
                    <td className="px-4 py-3 text-xs text-muted-foreground">{u.email || "—"}</td>
                    <td className="px-4 py-3 font-mono text-xs text-muted-foreground">{u.created_at ? new Date(u.created_at).toLocaleDateString() : "—"}</td>
                    <td className="px-4 py-3 text-right">
                      {!u.is_seed && u.username !== me ? (
                        <Button size="icon" variant="ghost" onClick={() => removeUser(u.username)} data-testid={`user-delete-${u.username}`} className="h-7 w-7 text-red-400 hover:bg-red-500/10">
                          <Trash2 className="h-3.5 w-3.5" />
                        </Button>
                      ) : <span className="text-xs text-muted-foreground">—</span>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="mt-3 text-[11px] text-muted-foreground">All users have full access (no roles).</p>
        </div>

        <Dialog open={addOpen} onOpenChange={setAddOpen}>
          <DialogContent className="border-border bg-card" data-testid="add-user-dialog">
            <DialogHeader><DialogTitle>Add User</DialogTitle></DialogHeader>
            <div className="space-y-3">
              <Input value={newUser.username} onChange={(e) => setNewUser({ ...newUser, username: e.target.value })} placeholder="username (min 3)" className={field} data-testid="new-user-username" />
              <Input value={newUser.email} onChange={(e) => setNewUser({ ...newUser, email: e.target.value })} placeholder="email (optional)" className={field} data-testid="new-user-email" />
              <Input type="password" value={newUser.password} onChange={(e) => setNewUser({ ...newUser, password: e.target.value })} placeholder="password (min 6)" className={field} data-testid="new-user-password" />
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setAddOpen(false)} className="border-white/20 bg-transparent">Cancel</Button>
              <Button onClick={addUser} disabled={addingUser || !newUser.username || !newUser.password} data-testid="add-user-btn" className="bg-emerald-500 text-black hover:bg-emerald-500/85">
                {addingUser ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <UserPlus className="mr-2 h-4 w-4" />} Add User
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        </TabsContent>

        <TabsContent value="identity">
        {/* Panel identity / branding */}
        <div className={card} data-testid="branding-card">
          <div className="mb-4 flex items-center gap-2">
            <Palette className="h-4 w-4 text-emerald-400" strokeWidth={1.5} />
            <h2 className="font-bold tracking-tight">Panel Identity</h2>
          </div>
          {brand ? (
            <div className="space-y-4">
              <div>
                <Label className={lbl}>System Name</Label>
                <Input value={brand.system_name} onChange={(e) => setBrand({ ...brand, system_name: e.target.value })}
                  placeholder="NEXUS.PANEL" className={field} data-testid="brand-name" />
                <p className="mt-1 text-[11px] text-muted-foreground">Use a “.” for an accent (e.g. ACME.CLOUD).</p>
              </div>
              <div>
                <Label className={lbl}>Tagline</Label>
                <Input value={brand.tagline} onChange={(e) => setBrand({ ...brand, tagline: e.target.value })}
                  placeholder="deploy control" className={field} data-testid="brand-tagline" />
              </div>
              <ImageField label="Logo" value={brand.logo} onChange={(v) => setBrand({ ...brand, logo: v })} testid="brand-logo" />
              <ImageField label="Favicon" value={brand.favicon} onChange={(v) => setBrand({ ...brand, favicon: v })} testid="brand-favicon" />
              <Button onClick={saveBranding} disabled={savingBrand} className="w-full bg-emerald-500 text-black hover:bg-emerald-500/85" data-testid="brand-save">
                {savingBrand ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null} Save Identity
              </Button>
            </div>
          ) : (
            <div className="text-sm text-muted-foreground">Loading…</div>
          )}
        </div>

        </TabsContent>

        <TabsContent value="account">
        <div className="grid grid-cols-1 items-start gap-6 lg:grid-cols-2">
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

        </div>
        </TabsContent>

        <TabsContent value="notifications">
        {/* Telegram notifications */}
        <div className={card}>
          <div className="mb-4 flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Send className="h-4 w-4 text-emerald-400" strokeWidth={1.5} />
              <h2 className="font-bold tracking-tight">Telegram Notifications</h2>
            </div>
            <span className="flex items-center gap-1.5 text-xs" data-testid="telegram-status">
              <span className={`h-1.5 w-1.5 rounded-full ${tg?.configured ? "bg-emerald-500" : "bg-zinc-600"}`} />
              {tg?.configured ? "connected" : "not configured"}
            </span>
          </div>
          <p className="mb-4 text-[11px] text-muted-foreground">
            Alerts are sent on deploy, backup, update and rollback events. Configure your bot token &amp; chat id below.
          </p>
          {tg ? (
            <div className="space-y-3">
              <div>
                <Label className={lbl}>Bot Token</Label>
                <Input
                  type="password"
                  value={tg.bot_token || ""}
                  onChange={(e) => setTg({ ...tg, bot_token: e.target.value })}
                  placeholder={tg.token_set ? "•••••••• (leave blank to keep current)" : "123456:ABC-DEF..."}
                  className={field}
                  data-testid="tg-token"
                />
              </div>
              <div>
                <Label className={lbl}>Chat ID</Label>
                <Input value={tg.chat_id || ""} onChange={(e) => setTg({ ...tg, chat_id: e.target.value })} placeholder="-1001234567890" className={field} data-testid="tg-chat" />
              </div>
              <div>
                <Label className={lbl}>Thread ID (optional)</Label>
                <Input value={tg.thread_id || ""} onChange={(e) => setTg({ ...tg, thread_id: e.target.value })} placeholder="topic thread id" className={field} data-testid="tg-thread" />
              </div>
              <div className="flex gap-2">
                <Button onClick={saveTelegram} disabled={savingTg} className="flex-1 bg-emerald-500 text-black hover:bg-emerald-500/85" data-testid="tg-save">
                  {savingTg ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null} Save
                </Button>
                <Button
                  data-testid="test-telegram-btn"
                  variant="outline"
                  disabled={busy === "tg" || !tg.configured}
                  onClick={() => act("tg", () => api.post("/ops/telegram/test"), "Test message sent")}
                  className="border-white/20 bg-transparent"
                >
                  {busy === "tg" ? <Loader2 className="h-4 w-4 animate-spin" /> : <><Send className="mr-1.5 h-4 w-4" strokeWidth={1.5} /> Test</>}
                </Button>
              </div>
            </div>
          ) : <div className="text-sm text-muted-foreground">Loading…</div>}
        </div>

        </TabsContent>

        <TabsContent value="system" className="space-y-6">
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
            <div className="max-h-[320px] overflow-y-auto divide-y divide-border/60 rounded-sm border border-border" data-testid="backups-list">
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
        </TabsContent>
        </Tabs>
      </div>
    </Layout>
  );
}
