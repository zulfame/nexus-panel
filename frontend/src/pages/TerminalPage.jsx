import { createRef, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import {
  Plus, X, Server, Play, ClipboardPaste, Pencil, Trash2, Monitor, Loader2, Columns2, Clock, Film, Minus,
} from "lucide-react";
import api, { apiError } from "@/lib/api";
import { Layout, PageHeader } from "@/components/Layout";
import { TerminalView, TERMINAL_THEMES } from "@/components/TerminalView";
import { RecordingPlayer } from "@/components/RecordingPlayer";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";

let TAB_SEQ = 1;

export default function TerminalPage() {
  const [tabs, setTabs] = useState([{ id: "t0", type: "local", label: "local" }]);
  const [activeTab, setActiveTab] = useState("t0");
  const [split, setSplit] = useState(false);
  const [splitTab, setSplitTab] = useState(null);
  const [statuses, setStatuses] = useState({});
  const [termTheme, setTermTheme] = useState(() => localStorage.getItem("nexus-term-theme") || "default");
  const [termFont, setTermFont] = useState(() => Number(localStorage.getItem("nexus-term-font")) || 13);
  useEffect(() => { localStorage.setItem("nexus-term-theme", termTheme); }, [termTheme]);
  useEffect(() => { localStorage.setItem("nexus-term-font", String(termFont)); }, [termFont]);
  const refs = useRef({ t0: createRef() });

  const [servers, setServers] = useState([]);
  const [commands, setCommands] = useState([]);
  const [recordings, setRecordings] = useState([]);
  const [player, setPlayer] = useState(null); // {title, events} | null
  const [loadingRec, setLoadingRec] = useState(false);

  const [serverDialog, setServerDialog] = useState(null); // null | {} (new) | server (edit)
  const [cmdDialog, setCmdDialog] = useState(null);

  const loadServers = async () => {
    try { setServers((await api.get("/terminal/servers")).data); } catch (e) {}
  };
  const loadCommands = async () => {
    try { setCommands((await api.get("/terminal/commands")).data); } catch (e) {}
  };
  const loadRecordings = async () => {
    try { setRecordings((await api.get("/terminal/recordings")).data.items || []); } catch (e) {}
  };
  useEffect(() => { loadServers(); loadCommands(); loadRecordings(); }, []);

  const openRecording = async (rec) => {
    setLoadingRec(true);
    try {
      const { data } = await api.get(`/terminal/recordings/${rec.id}`);
      setPlayer({ title: data.title, events: data.events || [] });
    } catch (e) {
      toast.error(apiError(e));
    } finally {
      setLoadingRec(false);
    }
  };
  const deleteRecording = async (id) => {
    try { await api.delete(`/terminal/recordings/${id}`); loadRecordings(); toast.success("Recording deleted"); }
    catch (e) { toast.error(apiError(e)); }
  };

  const addLocalTab = () => {
    const id = `t${TAB_SEQ++}`;
    refs.current[id] = createRef();
    setTabs((t) => [...t, { id, type: "local", label: `local ${TAB_SEQ}` }]);
    setActiveTab(id);
  };

  const openServerTab = (srv) => {
    const id = `t${TAB_SEQ++}`;
    refs.current[id] = createRef();
    setTabs((t) => [...t, { id, type: "ssh", serverId: srv.id, label: srv.name }]);
    setActiveTab(id);
  };

  const closeTab = (id) => {
    setTabs((t) => {
      const next = t.filter((x) => x.id !== id);
      if (next.length === 0) {
        const nid = `t${TAB_SEQ++}`;
        refs.current[nid] = createRef();
        setActiveTab(nid);
        return [{ id: nid, type: "local", label: "local" }];
      }
      if (id === activeTab) setActiveTab(next[next.length - 1].id);
      return next;
    });
    if (id === splitTab) setSplitTab(null);
    // Disable split if fewer than 2 tabs remain.
    setTabs((cur) => { if (cur.length < 2) { setSplit(false); setSplitTab(null); } return cur; });
  };

  // In split mode: clicking a tab puts it on the left pane; clicking the right-pane tab swaps sides.
  const selectTab = (id) => {
    if (!split) { setActiveTab(id); return; }
    if (id === activeTab) return;
    if (id === splitTab) { setSplitTab(activeTab); setActiveTab(id); return; }
    setActiveTab(id);
  };

  const toggleSplit = () => {
    if (split) { setSplit(false); setSplitTab(null); return; }
    // Need a second tab for the right pane; create one if there's only a single tab.
    let second = tabs.find((t) => t.id !== activeTab);
    if (!second) {
      const nid = `t${TAB_SEQ++}`;
      refs.current[nid] = createRef();
      const nt = { id: nid, type: "local", label: `local ${TAB_SEQ}` };
      setTabs((t) => [...t, nt]);
      second = nt;
    }
    setSplitTab(second.id);
    setSplit(true);
  };

  const runCommand = (cmd) => {
    const r = refs.current[activeTab]?.current;
    if (!r) return toast.error("No active terminal");
    r.runCommand(cmd);
    r.focus();
  };
  const pasteCommand = (cmd) => {
    const r = refs.current[activeTab]?.current;
    if (!r) return toast.error("No active terminal");
    r.sendText(cmd);
    r.focus();
  };

  return (
    <Layout>
      <PageHeader title="Terminal" subtitle="Web shell to your VPS and remote servers — no SSH client needed" />

      <div className="p-4 sm:p-6 lg:p-8">
        <div className="flex h-[calc(100vh-8rem)] flex-col overflow-hidden rounded-sm border border-border bg-card lg:h-[calc(100vh-11rem)] lg:flex-row">
        {/* terminal area */}
        <div className="flex min-w-0 flex-1 flex-col bg-[#050505]">
          {/* tab bar */}
          <div className="flex items-center gap-1 border-b border-border bg-[#0a0a0a] px-2 py-1.5">
            <div className="flex flex-1 items-center gap-1 overflow-x-auto">
              {tabs.map((t) => {
                const isActive = activeTab === t.id;
                const isSplit = split && splitTab === t.id;
                return (
                <button
                  key={t.id}
                  data-testid={`term-tab-${t.id}`}
                  onClick={() => selectTab(t.id)}
                  className={`group flex shrink-0 items-center gap-2 rounded-sm border px-3 py-1.5 text-xs transition-colors ${
                    isActive
                      ? "border-[var(--ds-primary)]/50 bg-[var(--ds-primary)]/15 text-[var(--ds-primary)]"
                      : isSplit
                      ? "border-white/15 bg-white/[0.08] text-zinc-300"
                      : "border-transparent text-zinc-400 hover:bg-white/10"
                  }`}
                >
                  {t.type === "ssh" ? <Server className="h-3 w-3" /> : <Monitor className="h-3 w-3" />}
                  <span className="max-w-[120px] truncate">{t.label}</span>
                  <span
                    className={`h-1.5 w-1.5 rounded-full ${
                      statuses[t.id] === "connected" ? "bg-emerald-400" : statuses[t.id] === "error" ? "bg-red-400" : "bg-zinc-500"
                    }`}
                  />
                  <X
                    data-testid={`term-tab-close-${t.id}`}
                    className="h-3 w-3 opacity-40 hover:opacity-100"
                    onClick={(e) => { e.stopPropagation(); closeTab(t.id); }}
                  />
                </button>
                );
              })}
            </div>
            <button
              data-testid="term-split-toggle"
              onClick={toggleSplit}
              className={`mr-1 flex h-7 shrink-0 items-center rounded-md border px-2.5 text-xs font-medium transition-colors ${split ? "border-[var(--ds-primary)]/50 bg-[var(--ds-primary)]/15 text-[var(--ds-primary)]" : "border-white/15 bg-transparent text-zinc-300 hover:bg-white/10 hover:text-white"}`}
            >
              <Columns2 className="mr-1 h-3.5 w-3.5" /> {split ? "Unsplit" : "Split"}
            </button>
            <button data-testid="term-new-tab" onClick={addLocalTab} className="flex h-7 shrink-0 items-center rounded-md border border-white/15 bg-transparent px-2.5 text-xs font-medium text-zinc-300 transition-colors hover:bg-white/10 hover:text-white">
              <Plus className="mr-1 h-3.5 w-3.5" /> New
            </button>
            <div className="mx-1 h-4 w-px bg-white/15" />
            {/* font size */}
            <div className="flex items-center overflow-hidden rounded-md border border-white/15">
              <button data-testid="term-font-dec" onClick={() => setTermFont((f) => Math.max(10, f - 1))} className="flex h-7 w-7 items-center justify-center text-zinc-300 hover:bg-white/10 hover:text-white"><Minus className="h-3.5 w-3.5" /></button>
              <span data-testid="term-font-size" className="w-7 text-center font-mono text-[11px] text-zinc-400">{termFont}</span>
              <button data-testid="term-font-inc" onClick={() => setTermFont((f) => Math.min(22, f + 1))} className="flex h-7 w-7 items-center justify-center text-zinc-300 hover:bg-white/10 hover:text-white"><Plus className="h-3.5 w-3.5" /></button>
            </div>
            {/* color theme */}
            <select
              data-testid="term-theme-select"
              value={termTheme}
              onChange={(e) => setTermTheme(e.target.value)}
              className="h-7 shrink-0 rounded-md border border-white/15 bg-transparent px-2 text-[11px] text-zinc-300 focus:outline-none [&>option]:bg-zinc-900 [&>option]:text-zinc-200"
            >
              {Object.entries(TERMINAL_THEMES).map(([k, v]) => (
                <option key={k} value={k}>{v.label}</option>
              ))}
            </select>
          </div>

          {/* terminals (all mounted, visible ones laid out side-by-side when split) */}
          <div className="flex min-h-0 flex-1 gap-2 overflow-hidden p-2">
            {tabs.map((t) => {
              const visible = t.id === activeTab || (split && t.id === splitTab);
              const paneActive = t.id === activeTab;
              return (
                <div
                  key={t.id}
                  data-testid={`term-pane-${t.id}`}
                  className={`min-w-0 flex-col overflow-hidden rounded-sm ${visible ? "flex flex-1" : "hidden"} ${
                    split && visible ? (paneActive ? "ring-1 ring-[var(--ds-primary)]/50" : "ring-1 ring-[var(--ds-border)]") : ""
                  }`}
                >
                  {split && (
                    <div className={`flex shrink-0 items-center gap-2 border-b px-3 py-1.5 text-[11px] ${
                      paneActive ? "border-[var(--ds-primary)]/20 bg-[var(--ds-primary)]/10 text-[var(--ds-primary)]" : "border-white/15 bg-white/5 text-zinc-400"
                    }`}>
                      {t.type === "ssh" ? <Server className="h-3 w-3" /> : <Monitor className="h-3 w-3" />}
                      <span className="truncate">{t.label}</span>
                    </div>
                  )}
                  <div className="min-h-0 flex-1 bg-[#050505]">
                    <TerminalView
                      ref={refs.current[t.id]}
                      session={t.type === "ssh" ? { type: "ssh", serverId: t.serverId } : { type: "local" }}
                      active={visible}
                      themeKey={termTheme}
                      fontSize={termFont}
                      onStatus={(s) => setStatuses((prev) => ({ ...prev, [t.id]: s }))}
                    />
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        {/* side panel */}
        <div className="flex h-64 shrink-0 flex-col border-t border-border bg-background lg:h-auto lg:w-80 lg:border-l lg:border-t-0">
          <Tabs defaultValue="servers" className="flex min-h-0 flex-1 flex-col overflow-hidden" onValueChange={(v) => { if (v === "recordings") loadRecordings(); }}>
            <TabsList className="m-3 grid shrink-0 grid-cols-3">
              <TabsTrigger value="servers" data-testid="side-tab-servers">Servers</TabsTrigger>
              <TabsTrigger value="commands" data-testid="side-tab-commands">Commands</TabsTrigger>
              <TabsTrigger value="recordings" data-testid="side-tab-recordings">Records</TabsTrigger>
            </TabsList>

            <div className="relative min-h-0 flex-1">
              {/* servers */}
              <TabsContent value="servers" className="absolute inset-0 mt-0 flex flex-col px-3 pb-3 data-[state=inactive]:hidden">
                <Button data-testid="add-server-btn" variant="outline" onClick={() => setServerDialog({})} className="mb-3 w-full shrink-0 border-[var(--ds-border)] bg-transparent">
                  <Plus className="mr-1.5 h-4 w-4" /> Add Server
                </Button>
                <div className="min-h-0 flex-1 overflow-y-auto pr-1">
                  {servers.length === 0 && (
                    <p className="px-1 py-4 text-center text-xs text-muted-foreground/60">No servers yet.</p>
                  )}
                {servers.map((s) => (
                  <div key={s.id} data-testid={`server-item-${s.id}`} className="mb-2 rounded-md border border-border bg-card p-3 transition-colors hover:border-[var(--ds-primary)]/40">
                    <div className="flex items-center justify-between">
                      <div className="min-w-0">
                        <div className="truncate text-sm font-medium">{s.name}</div>
                        <div className="truncate font-mono text-[11px] text-muted-foreground">
                          {s.username}@{s.host}:{s.port} · {s.auth_type}
                        </div>
                      </div>
                    </div>
                    <div className="mt-2 flex gap-1.5">
                      <Button data-testid={`server-connect-${s.id}`} size="sm" onClick={() => openServerTab(s)} className="h-7 flex-1 bg-[var(--ds-primary)] text-white hover:bg-[var(--ds-primary-hover)]">
                        <Play className="mr-1 h-3 w-3" /> Connect
                      </Button>
                      <Button data-testid={`server-edit-${s.id}`} size="sm" variant="outline" onClick={() => setServerDialog(s)} className="h-7 border-[var(--ds-border)] bg-transparent px-2"><Pencil className="h-3 w-3" /></Button>
                      <Button data-testid={`server-delete-${s.id}`} size="sm" variant="outline" onClick={async () => { await api.delete(`/terminal/servers/${s.id}`); loadServers(); toast.success("Server removed"); }} className="h-7 border-[var(--ds-border)] bg-transparent px-2 text-red-400"><Trash2 className="h-3 w-3" /></Button>
                    </div>
                  </div>
                ))}
              </div>
            </TabsContent>

            {/* commands */}
            <TabsContent value="commands" className="absolute inset-0 mt-0 flex flex-col px-3 pb-3 data-[state=inactive]:hidden">
              <Button data-testid="add-command-btn" variant="outline" onClick={() => setCmdDialog({})} className="mb-3 w-full shrink-0 border-[var(--ds-border)] bg-transparent">
                <Plus className="mr-1.5 h-4 w-4" /> Add Command
              </Button>
              <div className="min-h-0 flex-1 overflow-y-auto pr-1">
                {commands.length === 0 && (
                  <p className="px-1 py-4 text-center text-xs text-muted-foreground/60">No saved commands.</p>
                )}
                {commands.map((c) => (
                  <div key={c.id} data-testid={`command-item-${c.id}`} className="mb-2 rounded-md border border-border bg-card p-3 transition-colors hover:border-[var(--ds-primary)]/40">
                    <div className="text-sm font-medium">{c.name}</div>
                    <code className="mt-1 block truncate font-mono text-[11px] text-[var(--ds-primary)]">{c.command}</code>
                    <div className="mt-2 flex gap-1.5">
                      <Button data-testid={`command-run-${c.id}`} size="sm" onClick={() => runCommand(c.command)} className="h-7 flex-1 bg-[var(--ds-primary)] text-white hover:bg-[var(--ds-primary-hover)]">
                        <Play className="mr-1 h-3 w-3" /> Run
                      </Button>
                      <Button data-testid={`command-paste-${c.id}`} size="sm" variant="outline" onClick={() => pasteCommand(c.command)} className="h-7 border-[var(--ds-border)] bg-transparent px-2"><ClipboardPaste className="h-3 w-3" /></Button>
                      <Button data-testid={`command-edit-${c.id}`} size="sm" variant="outline" onClick={() => setCmdDialog(c)} className="h-7 border-[var(--ds-border)] bg-transparent px-2"><Pencil className="h-3 w-3" /></Button>
                      <Button data-testid={`command-delete-${c.id}`} size="sm" variant="outline" onClick={async () => { await api.delete(`/terminal/commands/${c.id}`); loadCommands(); toast.success("Command removed"); }} className="h-7 border-[var(--ds-border)] bg-transparent px-2 text-red-400"><Trash2 className="h-3 w-3" /></Button>
                    </div>
                  </div>
                ))}
              </div>
            </TabsContent>

            {/* recordings */}
            <TabsContent value="recordings" className="absolute inset-0 mt-0 flex flex-col px-3 pb-3 data-[state=inactive]:hidden">
              <div className="mb-3 flex shrink-0 items-center justify-between">
                <span className="text-[11px] text-muted-foreground">Sessions auto-recorded (newest 50)</span>
                <Button data-testid="rec-refresh" size="sm" variant="outline" onClick={loadRecordings} className="h-7 border-[var(--ds-border)] bg-transparent px-2 text-xs">Refresh</Button>
              </div>
              <div className="min-h-0 flex-1 overflow-y-auto pr-1">
                {recordings.length === 0 && (
                  <p className="px-1 py-4 text-center text-xs text-muted-foreground/60">No recordings yet. Open a terminal, run commands, then close it.</p>
                )}
                {recordings.map((r) => (
                  <div key={r.id} data-testid={`recording-item-${r.id}`} className="mb-2 rounded-md border border-border bg-card p-3 transition-colors hover:border-[var(--ds-primary)]/40">
                    <div className="flex items-start gap-2">
                      {r.kind === "ssh" ? <Server className="mt-0.5 h-3.5 w-3.5 shrink-0 text-[var(--ds-primary)]" /> : <Monitor className="mt-0.5 h-3.5 w-3.5 shrink-0 text-[var(--ds-primary)]" />}
                      <div className="min-w-0 flex-1">
                        <div className="truncate text-sm font-medium">{r.title}</div>
                        <div className="mt-0.5 flex items-center gap-2 text-[11px] text-muted-foreground">
                          <Clock className="h-3 w-3" /> {new Date(r.started_at).toLocaleString()}
                        </div>
                        <div className="mt-0.5 text-[11px] text-muted-foreground">
                          {r.duration_s}s · {(r.bytes / 1024).toFixed(1)} KB{r.truncated ? " · truncated" : ""}
                        </div>
                      </div>
                    </div>
                    <div className="mt-2 flex gap-1.5">
                      <Button data-testid={`recording-play-${r.id}`} size="sm" onClick={() => openRecording(r)} className="h-7 flex-1 bg-[var(--ds-primary)] text-white hover:bg-[var(--ds-primary-hover)]">
                        <Play className="mr-1 h-3 w-3" /> Replay
                      </Button>
                      <Button data-testid={`recording-delete-${r.id}`} size="sm" variant="outline" onClick={() => deleteRecording(r.id)} className="h-7 border-[var(--ds-border)] bg-transparent px-2 text-red-400"><Trash2 className="h-3 w-3" /></Button>
                    </div>
                  </div>
                ))}
              </div>
            </TabsContent>
            </div>
          </Tabs>
        </div>
      </div>
      </div>

      {serverDialog && (
        <ServerDialog server={serverDialog} onClose={() => setServerDialog(null)} onSaved={() => { setServerDialog(null); loadServers(); }} />
      )}
      {cmdDialog && (
        <CommandDialog command={cmdDialog} onClose={() => setCmdDialog(null)} onSaved={() => { setCmdDialog(null); loadCommands(); }} />
      )}
      <Dialog open={!!player} onOpenChange={(o) => !o && setPlayer(null)}>
        <DialogContent data-testid="recording-player-dialog" className="max-w-4xl">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-sm">
              <Film className="h-4 w-4 text-[var(--ds-primary)]" /> {player?.title || "Session replay"}
            </DialogTitle>
          </DialogHeader>
          {player && <RecordingPlayer events={player.events} />}
        </DialogContent>
      </Dialog>
      {loadingRec && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/40" data-testid="rec-loading">
          <Loader2 className="h-6 w-6 animate-spin text-white" />
        </div>
      )}
    </Layout>
  );
}

function ServerDialog({ server, onClose, onSaved }) {
  const editing = !!server.id;
  const [form, setForm] = useState({
    name: server.name || "",
    host: server.host || "",
    port: server.port || 22,
    username: server.username || "root",
    auth_type: server.auth_type || "password",
    password: "",
    private_key: "",
  });
  const [saving, setSaving] = useState(false);
  const set = (k, v) => setForm((f) => ({ ...f, [k]: v }));

  const save = async () => {
    if (!form.name || !form.host) return toast.error("Name and host are required");
    setSaving(true);
    try {
      const payload = { ...form, port: Number(form.port) };
      if (!payload.password) delete payload.password;
      if (!payload.private_key) delete payload.private_key;
      if (editing) await api.put(`/terminal/servers/${server.id}`, payload);
      else await api.post("/terminal/servers", payload);
      toast.success(editing ? "Server updated" : "Server added");
      onSaved();
    } catch (e) {
      toast.error(apiError(e));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open onOpenChange={onClose}>
      <DialogContent data-testid="server-dialog" className="max-w-md">
        <DialogHeader><DialogTitle>{editing ? "Edit Server" : "Add Server"}</DialogTitle></DialogHeader>
        <div className="space-y-3">
          <div><Label>Name</Label><Input data-testid="server-name" value={form.name} onChange={(e) => set("name", e.target.value)} placeholder="Production VPS" /></div>
          <div className="grid grid-cols-3 gap-2">
            <div className="col-span-2"><Label>Host</Label><Input data-testid="server-host" value={form.host} onChange={(e) => set("host", e.target.value)} placeholder="1.2.3.4" /></div>
            <div><Label>Port</Label><Input data-testid="server-port" type="number" value={form.port} onChange={(e) => set("port", e.target.value)} /></div>
          </div>
          <div className="grid grid-cols-2 gap-2">
            <div><Label>Username</Label><Input data-testid="server-username" value={form.username} onChange={(e) => set("username", e.target.value)} /></div>
            <div>
              <Label>Auth</Label>
              <Select value={form.auth_type} onValueChange={(v) => set("auth_type", v)}>
                <SelectTrigger data-testid="server-auth-type"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="password">Password</SelectItem>
                  <SelectItem value="key">SSH Key</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
          {form.auth_type === "password" ? (
            <div><Label>Password {editing && <span className="text-muted-foreground">(leave blank to keep)</span>}</Label><Input data-testid="server-password" type="password" value={form.password} onChange={(e) => set("password", e.target.value)} /></div>
          ) : (
            <div><Label>Private Key {editing && <span className="text-muted-foreground">(leave blank to keep)</span>}</Label><Textarea data-testid="server-private-key" rows={4} value={form.private_key} onChange={(e) => set("private_key", e.target.value)} placeholder="-----BEGIN OPENSSH PRIVATE KEY-----" className="font-mono text-xs" /></div>
          )}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose} className="border-[var(--ds-border)] bg-transparent">Cancel</Button>
          <Button data-testid="server-save-btn" onClick={save} disabled={saving}>{saving ? <Loader2 className="h-4 w-4 animate-spin" /> : "Save"}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function CommandDialog({ command, onClose, onSaved }) {
  const editing = !!command.id;
  const [form, setForm] = useState({ name: command.name || "", command: command.command || "" });
  const [saving, setSaving] = useState(false);

  const save = async () => {
    if (!form.name || !form.command) return toast.error("Name and command are required");
    setSaving(true);
    try {
      if (editing) await api.put(`/terminal/commands/${command.id}`, form);
      else await api.post("/terminal/commands", form);
      toast.success(editing ? "Command updated" : "Command added");
      onSaved();
    } catch (e) {
      toast.error(apiError(e));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open onOpenChange={onClose}>
      <DialogContent data-testid="command-dialog" className="max-w-md">
        <DialogHeader><DialogTitle>{editing ? "Edit Command" : "Add Command"}</DialogTitle></DialogHeader>
        <div className="space-y-3">
          <div><Label>Name</Label><Input data-testid="command-name" value={form.name} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} placeholder="Restart nginx" /></div>
          <div><Label>Command</Label><Textarea data-testid="command-text" rows={3} value={form.command} onChange={(e) => setForm((f) => ({ ...f, command: e.target.value }))} placeholder="systemctl restart nginx" className="font-mono text-xs" /></div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose} className="border-[var(--ds-border)] bg-transparent">Cancel</Button>
          <Button data-testid="command-save-btn" onClick={save} disabled={saving}>{saving ? <Loader2 className="h-4 w-4 animate-spin" /> : "Save"}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
