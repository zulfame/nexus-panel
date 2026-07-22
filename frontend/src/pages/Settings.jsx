import { useCallback, useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import notify from "@/lib/notify";
import {
  CheckCircle2, XCircle, Server, ShieldCheck, KeyRound, Loader2,
  Send, Archive, RotateCcw, DatabaseBackup, HardDriveDownload, Palette, Users2, UserPlus, Trash2, LogOut,
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
import { DSPanel, DSButton, DSModal } from "@/components/ds";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger,
} from "@/components/ui/alert-dialog";

const field = "ds-field bg-transparent focus-visible:ring-1 focus-visible:ring-[var(--ds-primary)]";
const lbl = "text-xs font-bold uppercase tracking-[0.1em] text-muted-foreground mb-1 block";
const card = "rounded-sm border border-border bg-card p-6";

const THEME_PRESETS = [
  { name: "Ocean", color: "#3b82f6" },
  { name: "Emerald", color: "#10b981" },
  { name: "Sunset", color: "#f97316" },
  { name: "Violet", color: "#8b5cf6" },
  { name: "Rose", color: "#f43f5e" },
  { name: "Slate", color: "#64748b" },
  { name: "Amber", color: "#f59e0b" },
  { name: "Cyan", color: "#06b6d4" },
];

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
      mode === m ? "border-[var(--ds-primary)]/40 bg-[var(--ds-primary)]/10 text-[var(--ds-primary)]" : "border-[var(--ds-border)] text-muted-foreground hover:bg-[var(--ds-hover)]"
    }`;
  const onFile = (e) => {
    const f = e.target.files?.[0];
    if (!f) return;
    if (f.size > 2 * 1024 * 1024) return notify.error("Image too large (max 2MB)");
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
            className="block w-full text-xs text-muted-foreground file:mr-3 file:rounded-sm file:border-0 file:bg-[var(--ds-primary)]/15 file:px-3 file:py-1.5 file:text-[var(--ds-primary)]" />
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
  const { user, logoutAll, hasRole } = useAuth();
  const navigate = useNavigate();
  const [signingOutAll, setSigningOutAll] = useState(false);
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
  const [newUser, setNewUser] = useState({ username: "", email: "", password: "", role: "developer" });
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
      notify.success(data.configured ? "Telegram connected" : "Telegram settings saved");
    } catch (e) {
      notify.error(apiError(e));
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
      notify.success(`User '${newUser.username}' created`, `Role: ${newUser.role}`);
      setNewUser({ username: "", email: "", password: "", role: "developer" });
      setAddOpen(false);
      loadUsers();
    } catch (e) {
      notify.error("Could not create user", apiError(e));
    } finally {
      setAddingUser(false);
    }
  };

  const removeUser = async (username) => {
    try {
      await api.delete(`/auth/users/${username}`);
      notify.success(`User '${username}' removed`);
      loadUsers();
    } catch (e) {
      notify.error("Could not remove user", apiError(e));
    }
  };

  const changeRole = async (username, role) => {
    try {
      await api.put(`/auth/users/${username}/role`, { role });
      notify.success(`Role updated`, `${username} is now ${role}`);
      loadUsers();
    } catch (e) {
      notify.error("Could not change role", apiError(e));
    }
  };

  useEffect(() => {
    if (brand === null && branding) {
      setBrand({
        system_name: branding.system_name || "",
        tagline: branding.tagline || "",
        logo: branding.logo || "",
        favicon: branding.favicon || "",
        primary_color: branding.primary_color || "#3b82f6",
      });
    }
  }, [branding, brand]);

  const setPrimary = (color) => {
    setBrand((b) => ({ ...b, primary_color: color }));
    if (/^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/.test((color || "").trim())) {
      document.documentElement.style.setProperty("--ds-primary", color.trim());
    }
  };

  const saveBranding = async () => {
    setSavingBrand(true);
    try {
      await api.put("/settings/branding", brand);
      await refreshBranding();
      notify.success("Panel identity updated");
    } catch (e) {
      notify.error(apiError(e));
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
    if (nw !== confirm) return notify.error("New password and confirmation do not match");
    if (nw.length < 6) return notify.error("New password must be at least 6 characters");
    setSaving(true);
    try {
      await api.post("/auth/change-password", { current_password: cur, new_password: nw });
      notify.success("Password updated");
      setCur(""); setNw(""); setConfirm("");
    } catch (err) {
      notify.error(apiError(err));
    } finally {
      setSaving(false);
    }
  };

  const act = async (key, fn, msg) => {
    setBusy(key);
    try {
      const { data } = await fn();
      notify.success(data?.message || msg);
      setTimeout(loadOps, 1500);
    } catch (err) {
      notify.error(apiError(err));
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
            <TabsTrigger value="account" data-testid="settings-tab-account" className="data-[state=active]:bg-[var(--ds-hover)]">Account</TabsTrigger>
            <TabsTrigger value="users" data-testid="settings-tab-users" className="data-[state=active]:bg-[var(--ds-hover)]">Users</TabsTrigger>
            <TabsTrigger value="identity" data-testid="settings-tab-identity" className="data-[state=active]:bg-[var(--ds-hover)]">Identity</TabsTrigger>
            <TabsTrigger value="notifications" data-testid="settings-tab-notifications" className="data-[state=active]:bg-[var(--ds-hover)]">Notifications</TabsTrigger>
            <TabsTrigger value="system" data-testid="settings-tab-system" className="data-[state=active]:bg-[var(--ds-hover)]">System</TabsTrigger>
          </TabsList>

        <TabsContent value="users">
        {/* Users (multi-user, equal access) */}
        <DSPanel
          data-testid="users-card"
          title={<span className="flex items-center gap-2"><Users2 className="h-4 w-4 text-[var(--ds-primary)]" strokeWidth={1.5} /> Users</span>}
          headerRight={<DSButton size="sm" variant="primary" icon={UserPlus} onClick={() => setAddOpen(true)} data-testid="open-add-user">Add User</DSButton>}
          footer={<span className="text-[12px] text-[var(--ds-muted)]">All users have full access (no roles).</span>}
          footerAlign="between"
        >
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
                  <tr key={u.username} className="hover:bg-[var(--ds-hover)]">
                    <td className="px-4 py-3 text-sm">
                      {u.username}
                      {u.is_seed && <span className="ml-2 rounded-sm border border-[var(--ds-border)] px-1.5 py-0.5 text-[10px] text-muted-foreground">seed</span>}
                      {u.username === me && <span className="ml-2 rounded-sm border border-[var(--ds-primary)]/30 bg-[var(--ds-primary)]/10 px-1.5 py-0.5 text-[10px] text-[var(--ds-primary)]">you</span>}
                    </td>
                    <td className="px-4 py-3 text-xs text-muted-foreground">{u.email || "—"}</td>
                    <td className="px-4 py-3 text-xs text-muted-foreground">{u.created_at ? new Date(u.created_at).toLocaleDateString() : "—"}</td>
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
        </DSPanel>

        <DSModal
          open={addOpen} onOpenChange={setAddOpen} size="sm"
          title="Add User" icon={UserPlus} data-testid="add-user-dialog"
          footer={<>
            <DSButton variant="outline" onClick={() => setAddOpen(false)}>Cancel</DSButton>
            <DSButton variant="primary" onClick={addUser} loading={addingUser} disabled={addingUser || !newUser.username || !newUser.password} data-testid="add-user-btn">Add User</DSButton>
          </>}
        >
          <div className="space-y-3">
            <Input value={newUser.username} onChange={(e) => setNewUser({ ...newUser, username: e.target.value })} placeholder="username (min 3)" className={field} data-testid="new-user-username" />
            <Input value={newUser.email} onChange={(e) => setNewUser({ ...newUser, email: e.target.value })} placeholder="email (optional)" className={field} data-testid="new-user-email" />
            <Input type="password" value={newUser.password} onChange={(e) => setNewUser({ ...newUser, password: e.target.value })} placeholder="password (min 6)" className={field} data-testid="new-user-password" />
          </div>
        </DSModal>

        </TabsContent>

        <TabsContent value="identity">
        {/* Panel identity / branding */}
        <DSPanel
          data-testid="branding-card"
          title={<span className="flex items-center gap-2"><Palette className="h-4 w-4 text-[var(--ds-primary)]" strokeWidth={1.5} /> Panel Identity</span>}
          footerAlign="end"
          footer={brand && <DSButton data-testid="brand-save" variant="primary" onClick={saveBranding} loading={savingBrand}>Save Identity</DSButton>}
        >
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
              <div>
                <Label className={lbl}>Primary Color</Label>
                <p className="mb-2 text-[11px] text-muted-foreground">Drives buttons, active states & accents across the whole panel.</p>
                <div className="flex items-center gap-3">
                  <input
                    type="color"
                    data-testid="brand-primary-color-picker"
                    value={/^#[0-9a-fA-F]{6}$/.test(brand.primary_color) ? brand.primary_color : "#3b82f6"}
                    onChange={(e) => setPrimary(e.target.value)}
                    className="h-10 w-14 cursor-pointer rounded-md border border-[var(--ds-border)] bg-transparent p-1"
                  />
                  <Input
                    value={brand.primary_color}
                    onChange={(e) => setPrimary(e.target.value)}
                    placeholder="#3b82f6"
                    className={`${field} max-w-[160px] font-mono`}
                    data-testid="brand-primary-color-hex"
                  />
                </div>
                <div className="mt-3 flex items-center gap-2">
                  <span className="inline-flex h-9 items-center rounded-md px-4 text-sm font-medium text-white" style={{ background: brand.primary_color }} data-testid="brand-primary-preview">Primary button</span>
                  <span className="text-[11px] text-muted-foreground">Live preview</span>
                </div>
                <div className="mt-4">
                  <span className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">Theme presets</span>
                  <div className="mt-2 grid grid-cols-2 gap-2 sm:grid-cols-4">
                    {THEME_PRESETS.map((p) => {
                      const active = brand.primary_color?.toLowerCase() === p.color;
                      return (
                        <button
                          key={p.name}
                          type="button"
                          data-testid={`theme-preset-${p.name.toLowerCase()}`}
                          onClick={() => setPrimary(p.color)}
                          className={`flex items-center gap-2 rounded-lg border px-3 py-2 text-left text-xs transition-all hover:border-[var(--ds-primary)] ${active ? "border-[var(--ds-primary)] bg-[var(--ds-primary)]/10" : "border-[var(--ds-border)]"}`}
                        >
                          <span className="h-5 w-5 shrink-0 rounded-full" style={{ background: p.color }} />
                          <span className="truncate font-medium text-[var(--ds-text)]">{p.name}</span>
                        </button>
                      );
                    })}
                  </div>
                </div>
              </div>
              <ImageField label="Logo" value={brand.logo} onChange={(v) => setBrand({ ...brand, logo: v })} testid="brand-logo" />
              <ImageField label="Favicon" value={brand.favicon} onChange={(v) => setBrand({ ...brand, favicon: v })} testid="brand-favicon" />
            </div>
          ) : (
            <div className="text-sm text-muted-foreground">Loading…</div>
          )}
        </DSPanel>

        </TabsContent>

        <TabsContent value="account">
        <div className="grid grid-cols-1 items-stretch gap-6 lg:grid-cols-2">
        {/* Admin account */}
        <DSPanel
          title={<span className="flex items-center gap-2"><ShieldCheck className="h-4 w-4 text-[var(--ds-primary)]" strokeWidth={1.5} /> Admin Account</span>}
          footer={<span className="text-[12px] text-[var(--ds-muted)]">Protected against brute force · 5 fails = 15 min lockout</span>}
          footerAlign="between"
        >
          <div className="flex items-center justify-between border-b border-border/60 pb-3">
            <span className="text-sm text-muted-foreground">Username</span>
            <span className="text-sm" data-testid="settings-username">{user?.username}</span>
          </div>
          <div className="flex items-center justify-between py-3">
            <span className="text-sm text-muted-foreground">Email</span>
            <span className="text-sm" data-testid="settings-email">{user?.email || "—"}</span>
          </div>
        </DSPanel>

        {/* Change password */}
        <DSPanel
          title={<span className="flex items-center gap-2"><KeyRound className="h-4 w-4 text-amber-400" strokeWidth={1.5} /> Change Password</span>}
          footerAlign="end"
          footer={
            <DSButton data-testid="change-password-btn" type="submit" form="change-password-form" variant="primary" loading={saving} disabled={saving || !cur || !nw || !confirm}>
              Update Password
            </DSButton>
          }
        >
          <form id="change-password-form" onSubmit={changePassword} className="space-y-4">
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
          </form>
        </DSPanel>

        {/* Active sessions */}
        <DSPanel
          title={<span className="flex items-center gap-2"><ShieldCheck className="h-4 w-4 text-emerald-400" strokeWidth={1.5} /> Active Sessions</span>}
          footerAlign="end"
          footer={
            <DSButton
              data-testid="signout-all-btn"
              variant="danger"
              icon={LogOut}
              loading={signingOutAll}
              onClick={async () => {
                setSigningOutAll(true);
                await logoutAll();
                notify.success("Signed out of all devices");
                navigate("/login");
              }}
            >
              Sign out all devices
            </DSButton>
          }
        >
          <p className="text-sm text-[var(--ds-muted)]">
            Revoke every active session for your account across all browsers and devices. Anyone
            currently signed in (including this one) will need to sign in again. Use this if you
            suspect your credentials were exposed.
          </p>
        </DSPanel>

        </div>
        </TabsContent>

        <TabsContent value="notifications">
        {/* Telegram notifications */}
        <DSPanel
          title={<span className="flex items-center gap-2"><Send className="h-4 w-4 text-[var(--ds-primary)]" strokeWidth={1.5} /> Telegram Notifications</span>}
          headerRight={
            <span className="flex items-center gap-1.5 text-xs text-[var(--ds-muted)]" data-testid="telegram-status">
              <span className={`h-1.5 w-1.5 rounded-full ${tg?.configured ? "bg-emerald-500" : "bg-zinc-600"}`} />
              {tg?.configured ? "connected" : "not configured"}
            </span>
          }
          footerAlign="end"
          footer={tg && <>
            <DSButton
              data-testid="test-telegram-btn" variant="outline"
              disabled={busy === "tg" || !tg.configured} loading={busy === "tg"}
              onClick={() => act("tg", () => api.post("/ops/telegram/test"), "Test message sent")}
            >Test</DSButton>
            <DSButton data-testid="tg-save" variant="primary" onClick={saveTelegram} loading={savingTg}>Save</DSButton>
          </>}
        >
          <p className="mb-4 text-[13px] text-[var(--ds-muted)]">
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
            </div>
          ) : <div className="text-sm text-muted-foreground">Loading…</div>}
        </DSPanel>

        </TabsContent>

        <TabsContent value="system" className="space-y-6">
        {/* Host capabilities */}
        <DSPanel title={<span className="flex items-center gap-2"><Server className="h-4 w-4 text-[var(--ds-primary)]" strokeWidth={1.5} /> Host Capabilities</span>}>
          {caps ? (
            <div>
              <CapRow label="Git" ok={caps.git} note="clone & pull private repos" />
              <CapRow label="Docker" ok={caps.docker} note="build & run project containers" />
              <CapRow label="Docker Compose" ok={caps.docker_compose} note="orchestrate backend + frontend" />
              <CapRow label="Nginx" ok={caps.nginx} note="reverse proxy per subdomain" />
              <CapRow label="Certbot" ok={caps.certbot} note="Let's Encrypt SSL issuance" />
            </div>
          ) : <div className="text-sm text-muted-foreground">Loading…</div>}
        </DSPanel>

        {/* Server operations */}
        <DSPanel
          title={<span className="flex items-center gap-2"><DatabaseBackup className="h-4 w-4 text-[var(--ds-primary)]" strokeWidth={1.5} /> Server Operations</span>}
          headerRight={<span className="text-[11px] text-[var(--ds-muted)]" data-testid="ops-current-release">release: {opsInfo?.current_release || "—"}</span>}
        >
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
              className="bg-[var(--ds-primary)] text-white hover:bg-[var(--ds-primary-hover)]"
            >
              {busy === "backup" ? <Loader2 className="h-4 w-4 animate-spin" /> : <><Archive className="mr-1.5 h-4 w-4" strokeWidth={1.5} /> Backup now</>}
            </Button>

            <AlertDialog>
              <AlertDialogTrigger asChild>
                <Button data-testid="ops-rollback-btn" variant="outline" className="border-[var(--ds-border)] bg-transparent">
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
                  <AlertDialogCancel className="border-[var(--ds-border)] bg-transparent">Cancel</AlertDialogCancel>
                  <AlertDialogAction data-testid="confirm-rollback-btn" onClick={() => act("rollback", () => api.post("/ops/rollback"), "Rollback started")} className="bg-[var(--ds-primary)] text-white hover:bg-[var(--ds-primary-hover)]">
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
                      <Button data-testid={`restore-btn-${b.name}`} variant="outline" size="sm" className="border-[var(--ds-border)] bg-transparent">
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
                        <AlertDialogCancel className="border-[var(--ds-border)] bg-transparent">Cancel</AlertDialogCancel>
                        <AlertDialogAction data-testid={`confirm-restore-${b.name}`} onClick={() => act("restore", () => api.post("/ops/restore", { file: b.name }), "Restore started")} className="bg-[var(--ds-primary)] text-white hover:bg-[var(--ds-primary-hover)]">
                          Restore
                        </AlertDialogAction>
                      </AlertDialogFooter>
                    </AlertDialogContent>
                  </AlertDialog>
                </div>
              ))}
            </div>
          )}
        </DSPanel>
        </TabsContent>
        </Tabs>
      </div>
    </Layout>
  );
}
