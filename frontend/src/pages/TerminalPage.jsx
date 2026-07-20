import { createRef, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import {
  Plus, X, Server, Play, ClipboardPaste, Pencil, Trash2, Monitor, Loader2,
} from "lucide-react";
import api, { apiError } from "@/lib/api";
import { Layout, PageHeader } from "@/components/Layout";
import { TerminalView } from "@/components/TerminalView";
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
  const [statuses, setStatuses] = useState({});
  const refs = useRef({ t0: createRef() });

  const [servers, setServers] = useState([]);
  const [commands, setCommands] = useState([]);

  const [serverDialog, setServerDialog] = useState(null); // null | {} (new) | server (edit)
  const [cmdDialog, setCmdDialog] = useState(null);

  const loadServers = async () => {
    try { setServers((await api.get("/terminal/servers")).data); } catch (e) {}
  };
  const loadCommands = async () => {
    try { setCommands((await api.get("/terminal/commands")).data); } catch (e) {}
  };
  useEffect(() => { loadServers(); loadCommands(); }, []);

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

      <div className="flex h-[calc(100vh-73px)]">
        {/* terminal area */}
        <div className="flex min-w-0 flex-1 flex-col bg-[#050505]">
          {/* tab bar */}
          <div className="flex items-center gap-1 border-b border-border bg-[#0a0a0a] px-2 py-1.5">
            <div className="flex flex-1 items-center gap-1 overflow-x-auto">
              {tabs.map((t) => (
                <button
                  key={t.id}
                  data-testid={`term-tab-${t.id}`}
                  onClick={() => setActiveTab(t.id)}
                  className={`group flex shrink-0 items-center gap-2 rounded-sm border px-3 py-1.5 font-mono text-xs transition-colors ${
                    activeTab === t.id
                      ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-300"
                      : "border-transparent text-muted-foreground hover:bg-white/5"
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
              ))}
            </div>
            <Button data-testid="term-new-tab" size="sm" variant="outline" onClick={addLocalTab} className="h-7 shrink-0 border-white/15 bg-transparent">
              <Plus className="mr-1 h-3.5 w-3.5" /> New
            </Button>
          </div>

          {/* terminals (all mounted, only active visible) */}
          <div className="relative flex-1 overflow-hidden p-2">
            {tabs.map((t) => (
              <div key={t.id} className={`absolute inset-2 ${activeTab === t.id ? "block" : "hidden"}`}>
                <TerminalView
                  ref={refs.current[t.id]}
                  session={t.type === "ssh" ? { type: "ssh", serverId: t.serverId } : { type: "local" }}
                  active={activeTab === t.id}
                  onStatus={(s) => setStatuses((prev) => ({ ...prev, [t.id]: s }))}
                />
              </div>
            ))}
          </div>
        </div>

        {/* side panel */}
        <div className="flex w-80 shrink-0 flex-col border-l border-border bg-background">
          <Tabs defaultValue="servers" className="flex min-h-0 flex-1 flex-col">
            <TabsList className="m-3 grid grid-cols-2">
              <TabsTrigger value="servers" data-testid="side-tab-servers">Servers</TabsTrigger>
              <TabsTrigger value="commands" data-testid="side-tab-commands">Commands</TabsTrigger>
            </TabsList>

            {/* servers */}
            <TabsContent value="servers" className="flex min-h-0 flex-1 flex-col px-3 pb-3">
              <Button data-testid="add-server-btn" variant="outline" onClick={() => setServerDialog({})} className="mb-3 w-full shrink-0 border-white/15 bg-transparent">
                <Plus className="mr-1.5 h-4 w-4" /> Add Server
              </Button>
              <div className="min-h-0 flex-1 overflow-y-auto pr-1">
                {servers.length === 0 && (
                  <p className="px-1 py-4 text-center font-mono text-xs text-muted-foreground/60">No servers yet.</p>
                )}
                {servers.map((s) => (
                  <div key={s.id} data-testid={`server-item-${s.id}`} className="mb-2 border border-border bg-card p-3">
                    <div className="flex items-center justify-between">
                      <div className="min-w-0">
                        <div className="truncate text-sm font-medium">{s.name}</div>
                        <div className="truncate font-mono text-[11px] text-muted-foreground">
                          {s.username}@{s.host}:{s.port} · {s.auth_type}
                        </div>
                      </div>
                    </div>
                    <div className="mt-2 flex gap-1.5">
                      <Button data-testid={`server-connect-${s.id}`} size="sm" onClick={() => openServerTab(s)} className="h-7 flex-1 bg-emerald-500/15 text-emerald-300 hover:bg-emerald-500/25">
                        <Play className="mr-1 h-3 w-3" /> Connect
                      </Button>
                      <Button data-testid={`server-edit-${s.id}`} size="sm" variant="outline" onClick={() => setServerDialog(s)} className="h-7 border-white/15 bg-transparent px-2"><Pencil className="h-3 w-3" /></Button>
                      <Button data-testid={`server-delete-${s.id}`} size="sm" variant="outline" onClick={async () => { await api.delete(`/terminal/servers/${s.id}`); loadServers(); toast.success("Server removed"); }} className="h-7 border-white/15 bg-transparent px-2 text-red-400"><Trash2 className="h-3 w-3" /></Button>
                    </div>
                  </div>
                ))}
              </div>
            </TabsContent>

            {/* commands */}
            <TabsContent value="commands" className="flex min-h-0 flex-1 flex-col px-3 pb-3">
              <Button data-testid="add-command-btn" variant="outline" onClick={() => setCmdDialog({})} className="mb-3 w-full shrink-0 border-white/15 bg-transparent">
                <Plus className="mr-1.5 h-4 w-4" /> Add Command
              </Button>
              <div className="min-h-0 flex-1 overflow-y-auto pr-1">
                {commands.length === 0 && (
                  <p className="px-1 py-4 text-center font-mono text-xs text-muted-foreground/60">No saved commands.</p>
                )}
                {commands.map((c) => (
                  <div key={c.id} data-testid={`command-item-${c.id}`} className="mb-2 border border-border bg-card p-3">
                    <div className="text-sm font-medium">{c.name}</div>
                    <code className="mt-1 block truncate font-mono text-[11px] text-emerald-400/80">{c.command}</code>
                    <div className="mt-2 flex gap-1.5">
                      <Button data-testid={`command-run-${c.id}`} size="sm" onClick={() => runCommand(c.command)} className="h-7 flex-1 bg-emerald-500/15 text-emerald-300 hover:bg-emerald-500/25">
                        <Play className="mr-1 h-3 w-3" /> Run
                      </Button>
                      <Button data-testid={`command-paste-${c.id}`} size="sm" variant="outline" onClick={() => pasteCommand(c.command)} className="h-7 border-white/15 bg-transparent px-2"><ClipboardPaste className="h-3 w-3" /></Button>
                      <Button data-testid={`command-edit-${c.id}`} size="sm" variant="outline" onClick={() => setCmdDialog(c)} className="h-7 border-white/15 bg-transparent px-2"><Pencil className="h-3 w-3" /></Button>
                      <Button data-testid={`command-delete-${c.id}`} size="sm" variant="outline" onClick={async () => { await api.delete(`/terminal/commands/${c.id}`); loadCommands(); toast.success("Command removed"); }} className="h-7 border-white/15 bg-transparent px-2 text-red-400"><Trash2 className="h-3 w-3" /></Button>
                    </div>
                  </div>
                ))}
              </div>
            </TabsContent>
          </Tabs>
        </div>
      </div>

      {serverDialog && (
        <ServerDialog server={serverDialog} onClose={() => setServerDialog(null)} onSaved={() => { setServerDialog(null); loadServers(); }} />
      )}
      {cmdDialog && (
        <CommandDialog command={cmdDialog} onClose={() => setCmdDialog(null)} onSaved={() => { setCmdDialog(null); loadCommands(); }} />
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
          <Button variant="outline" onClick={onClose} className="border-white/15 bg-transparent">Cancel</Button>
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
          <Button variant="outline" onClick={onClose} className="border-white/15 bg-transparent">Cancel</Button>
          <Button data-testid="command-save-btn" onClick={save} disabled={saving}>{saving ? <Loader2 className="h-4 w-4 animate-spin" /> : "Save"}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
