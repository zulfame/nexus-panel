import { useCallback, useEffect, useRef, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { toast } from "sonner";
import {
  Rocket, Play, Square, RotateCw, Trash2, ArrowLeft, Save, Loader2,
  GitBranch, Globe, Database, Server, Terminal, RefreshCw, Activity, Radio,
} from "lucide-react";
import api, { apiError } from "@/lib/api";
import { Layout } from "@/components/Layout";
import { StatusBadge } from "@/components/StatusBadge";
import { LogViewer } from "@/components/LogViewer";
import { ContainerHealth } from "@/components/ContainerHealth";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger,
} from "@/components/ui/alert-dialog";

const field = "border-white/20 bg-transparent font-mono focus-visible:ring-1 focus-visible:ring-white";
const lbl = "font-mono text-xs uppercase tracking-wider text-muted-foreground";

export default function ProjectDetail() {
  const { id } = useParams();
  const navigate = useNavigate();
  const [p, setP] = useState(null);
  const [form, setForm] = useState(null);
  const [envText, setEnvText] = useState("");
  const [wsLines, setWsLines] = useState([]);
  const [liveStatus, setLiveStatus] = useState("");
  const [wsConnected, setWsConnected] = useState(false);
  const [containerLogs, setContainerLogs] = useState([]);
  const [health, setHealth] = useState([]);
  const [liveContainer, setLiveContainer] = useState(false);
  const containerWsRef = useRef(null);
  const [busy, setBusy] = useState("");
  const [saving, setSaving] = useState(false);

  const loadProject = useCallback(async () => {
    try {
      const { data } = await api.get(`/projects/${id}`);
      setP(data);
      setForm((prev) => prev || {
        name: data.name, repo_url: data.repo_url, branch: data.branch, github_token: "",
        domain: data.domain || "", ssl_mode: data.ssl_mode, ssl_email: data.ssl_email || "",
        ssl_cert_path: data.ssl_cert_path || "", ssl_key_path: data.ssl_key_path || "",
        db_name: data.db_name || "", backend_port: data.backend_port, frontend_port: data.frontend_port,
      });
      if (envText === "") setEnvText((data.env_vars || []).map((e) => `${e.key}=${e.value}`).join("\n"));
    } catch (e) {
      toast.error(apiError(e));
    }
  }, [id]); // eslint-disable-line

  const loadHealth = useCallback(async () => {
    try {
      const { data } = await api.get(`/projects/${id}/health`);
      setHealth(data.containers || []);
    } catch (e) {
      setHealth([]);
    }
  }, [id]);

  useEffect(() => {
    loadProject();
    loadHealth();
    const t = setInterval(() => { loadProject(); loadHealth(); }, 4000);
    return () => clearInterval(t);
  }, [loadProject, loadHealth]);

  useEffect(() => {
    const token = localStorage.getItem("panel_token");
    const wsBase = (process.env.REACT_APP_BACKEND_URL || "").replace(/^http/, "ws");
    let ws;
    try {
      ws = new WebSocket(`${wsBase}/api/ws/projects/${id}/logs?token=${token}`);
      ws.onopen = () => setWsConnected(true);
      ws.onclose = () => setWsConnected(false);
      ws.onerror = () => setWsConnected(false);
      ws.onmessage = (e) => {
        const msg = JSON.parse(e.data);
        if (msg.type === "reset") { setWsLines([]); setLiveStatus("running"); }
        else if (msg.type === "line") setWsLines((prev) => [...prev, msg.line]);
        else if (msg.type === "status") setLiveStatus(msg.status);
        else if (msg.type === "end") { setLiveStatus(msg.status); loadProject(); }
      };
    } catch (err) {}
    return () => { if (ws) ws.close(); };
  }, [id, loadProject]);

  const setF = (k, v) => setForm((f) => ({ ...f, [k]: v }));

  const parseEnv = () =>
    envText.split("\n").map((l) => l.trim()).filter((l) => l && l.includes("="))
      .map((l) => { const i = l.indexOf("="); return { key: l.slice(0, i).trim(), value: l.slice(i + 1).trim() }; });

  const save = async () => {
    setSaving(true);
    try {
      const payload = { ...form, env_vars: parseEnv() };
      if (!payload.github_token) delete payload.github_token;
      await api.put(`/projects/${id}`, payload);
      toast.success("Configuration saved");
      loadProject();
    } catch (e) {
      toast.error(apiError(e));
    } finally {
      setSaving(false);
    }
  };

  const action = async (act) => {
    setBusy(act);
    try {
      const url = act === "deploy" ? `/projects/${id}/deploy` : `/projects/${id}/${act}`;
      await api.post(url);
      toast.success(`${act} started`);
    } catch (e) {
      toast.error(apiError(e));
    } finally {
      setTimeout(() => setBusy(""), 800);
    }
  };

  const remove = async () => {
    try {
      await api.delete(`/projects/${id}`);
      toast.success("Project deleted");
      navigate("/projects");
    } catch (e) {
      toast.error(apiError(e));
    }
  };

  const loadContainerLogs = async () => {
    try {
      const { data } = await api.get(`/projects/${id}/container-logs`);
      setContainerLogs(data.lines || []);
    } catch (e) {
      toast.error(apiError(e));
    }
  };

  const stopLiveContainer = useCallback(() => {
    if (containerWsRef.current) {
      try { containerWsRef.current.close(); } catch (e) {}
      containerWsRef.current = null;
    }
    setLiveContainer(false);
  }, []);

  const toggleLiveContainer = () => {
    if (liveContainer) {
      stopLiveContainer();
      return;
    }
    const token = localStorage.getItem("panel_token");
    const wsBase = (process.env.REACT_APP_BACKEND_URL || "").replace(/^http/, "ws");
    setContainerLogs([]);
    try {
      const ws = new WebSocket(`${wsBase}/api/ws/projects/${id}/container-logs?token=${token}`);
      ws.onopen = () => setLiveContainer(true);
      ws.onmessage = (e) => {
        const msg = JSON.parse(e.data);
        if (msg.type === "line") setContainerLogs((prev) => [...prev, msg.text]);
        else if (msg.type === "error") { toast.error(msg.message); stopLiveContainer(); }
      };
      ws.onclose = () => setLiveContainer(false);
      ws.onerror = () => setLiveContainer(false);
      containerWsRef.current = ws;
    } catch (err) {
      toast.error("Failed to open live stream");
    }
  };

  useEffect(() => () => stopLiveContainer(), [stopLiveContainer]);

  if (!p || !form) {
    return <Layout><div className="p-8 font-mono text-sm text-muted-foreground">Loading…</div></Layout>;
  }

  const latestLog = null; // eslint-disable-line
  return (    <Layout>
      <header className="sticky top-0 z-20 border-b border-border bg-background/95 px-8 py-5 backdrop-blur">
        <button data-testid="back-btn" onClick={() => navigate("/projects")} className="mb-3 flex items-center gap-1.5 font-mono text-xs text-muted-foreground hover:text-foreground">
          <ArrowLeft className="h-3.5 w-3.5" /> Projects
        </button>
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-4">
            <h1 className="font-heading text-2xl font-bold tracking-tight">{p.name}</h1>
            <StatusBadge status={p.status} />
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Button data-testid="deploy-action-btn" disabled={busy} onClick={() => action("deploy")} className="bg-status-running text-black hover:bg-status-running/85">
              {busy === "deploy" ? <Loader2 className="h-4 w-4 animate-spin" /> : <><Rocket className="mr-1.5 h-4 w-4" /> Deploy</>}
            </Button>
            <Button data-testid="start-action-btn" variant="outline" disabled={busy} onClick={() => action("start")} className="border-white/20 bg-transparent"><Play className="h-4 w-4" /></Button>
            <Button data-testid="stop-action-btn" variant="outline" disabled={busy} onClick={() => action("stop")} className="border-white/20 bg-transparent"><Square className="h-4 w-4" /></Button>
            <Button data-testid="restart-action-btn" variant="outline" disabled={busy} onClick={() => action("restart")} className="border-white/20 bg-transparent"><RotateCw className="h-4 w-4" /></Button>
            <AlertDialog>
              <AlertDialogTrigger asChild>
                <Button data-testid="delete-action-btn" variant="outline" className="border-status-error/40 bg-transparent text-status-error hover:bg-status-error/10"><Trash2 className="h-4 w-4" /></Button>
              </AlertDialogTrigger>
              <AlertDialogContent className="border-border bg-card">
                <AlertDialogHeader>
                  <AlertDialogTitle>Delete {p.name}?</AlertDialogTitle>
                  <AlertDialogDescription className="font-mono text-xs">
                    This removes containers, nginx config and cloned source. This cannot be undone.
                  </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel className="border-white/20 bg-transparent">Cancel</AlertDialogCancel>
                  <AlertDialogAction data-testid="confirm-delete-btn" onClick={remove} className="bg-status-error text-white hover:bg-status-error/85">Delete</AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
          </div>
        </div>
        {p.last_message && <p className="mt-2 font-mono text-xs text-muted-foreground">{p.last_message}</p>}
      </header>

      <div className="p-8">
        <div className="mb-6 grid grid-cols-2 gap-4 md:grid-cols-4">
          {[
            { icon: GitBranch, label: "Branch", value: p.branch },
            { icon: Globe, label: "Domain", value: p.domain || "—" },
            { icon: Server, label: "Ports FE/BE", value: `${p.frontend_port}/${p.backend_port}` },
            { icon: Database, label: "Database", value: p.db_name },
          ].map((x) => (
            <div key={x.label} className="border border-border bg-card p-4">
              <div className="mb-2 flex items-center gap-1.5 text-muted-foreground"><x.icon className="h-3.5 w-3.5" /><span className="font-mono text-[11px] uppercase tracking-wider">{x.label}</span></div>
              <div className="truncate font-mono text-sm">{x.value}</div>
            </div>
          ))}
        </div>

        <div className="mb-6 border border-border bg-card p-4" data-testid="container-health-panel">
          <div className="mb-3 flex items-center gap-2 text-muted-foreground">
            <Activity className="h-3.5 w-3.5" />
            <span className="font-mono text-[11px] uppercase tracking-wider">Container Health</span>
          </div>
          <ContainerHealth containers={health} />
        </div>

        <Tabs defaultValue="config">
          <TabsList className="bg-card">
            <TabsTrigger value="config" data-testid="tab-config">Configuration</TabsTrigger>
            <TabsTrigger value="logs" data-testid="tab-logs">Deploy Logs</TabsTrigger>
            <TabsTrigger value="container" data-testid="tab-container">Container Logs</TabsTrigger>
          </TabsList>

          <TabsContent value="config" className="mt-5">
            <div className="border border-border bg-card p-6">
              <div className="grid grid-cols-1 gap-5 md:grid-cols-2">
                <div className="space-y-2"><Label className={lbl}>Name</Label><Input data-testid="cfg-name" className={field} value={form.name} onChange={(e) => setF("name", e.target.value)} /></div>
                <div className="space-y-2"><Label className={lbl}>Branch</Label><Input data-testid="cfg-branch" className={field} value={form.branch} onChange={(e) => setF("branch", e.target.value)} /></div>
                <div className="space-y-2 md:col-span-2"><Label className={lbl}>Repository URL</Label><Input data-testid="cfg-repo" className={field} value={form.repo_url} onChange={(e) => setF("repo_url", e.target.value)} /></div>
                <div className="space-y-2"><Label className={lbl}>GitHub Token {p.has_github_token && <span className="text-status-running">(set)</span>}</Label><Input data-testid="cfg-token" type="password" className={field} value={form.github_token} onChange={(e) => setF("github_token", e.target.value)} placeholder={p.has_github_token ? "•••• leave blank to keep" : "ghp_…"} /></div>
                <div className="space-y-2"><Label className={lbl}>Database Name</Label><Input data-testid="cfg-db" className={field} value={form.db_name} onChange={(e) => setF("db_name", e.target.value)} /></div>
                <div className="space-y-2"><Label className={lbl}>Frontend Port</Label><Input data-testid="cfg-fe-port" type="number" className={field} value={form.frontend_port} onChange={(e) => setF("frontend_port", parseInt(e.target.value) || 0)} /></div>
                <div className="space-y-2"><Label className={lbl}>Backend Port</Label><Input data-testid="cfg-be-port" type="number" className={field} value={form.backend_port} onChange={(e) => setF("backend_port", parseInt(e.target.value) || 0)} /></div>
              </div>

              <div className="mt-6 border-t border-border pt-6">
                <h3 className="mb-4 font-heading text-sm font-bold uppercase tracking-wider text-muted-foreground">Domain & SSL</h3>
                <div className="grid grid-cols-1 gap-5 md:grid-cols-2">
                  <div className="space-y-2"><Label className={lbl}>Domain</Label><Input data-testid="cfg-domain" className={field} value={form.domain} onChange={(e) => setF("domain", e.target.value)} /></div>
                  <div className="space-y-2">
                    <Label className={lbl}>SSL Mode</Label>
                    <Select value={form.ssl_mode} onValueChange={(v) => setF("ssl_mode", v)}>
                      <SelectTrigger data-testid="cfg-ssl-mode" className={field}><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="letsencrypt">Let's Encrypt (auto)</SelectItem>
                        <SelectItem value="custom">Custom certificate</SelectItem>
                        <SelectItem value="none">None</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  {form.ssl_mode === "letsencrypt" && (
                    <div className="space-y-2 md:col-span-2"><Label className={lbl}>Let's Encrypt Email</Label><Input data-testid="cfg-ssl-email" className={field} value={form.ssl_email} onChange={(e) => setF("ssl_email", e.target.value)} /></div>
                  )}
                  {form.ssl_mode === "custom" && (
                    <>
                      <div className="space-y-2"><Label className={lbl}>Cert Path</Label><Input data-testid="cfg-cert" className={field} value={form.ssl_cert_path} onChange={(e) => setF("ssl_cert_path", e.target.value)} /></div>
                      <div className="space-y-2"><Label className={lbl}>Key Path</Label><Input data-testid="cfg-key" className={field} value={form.ssl_key_path} onChange={(e) => setF("ssl_key_path", e.target.value)} /></div>
                    </>
                  )}
                </div>
              </div>

              <div className="mt-6 border-t border-border pt-6">
                <h3 className="mb-4 font-heading text-sm font-bold uppercase tracking-wider text-muted-foreground">Environment Variables</h3>
                <textarea data-testid="cfg-env" className="min-h-[140px] w-full border border-white/20 bg-transparent p-3 font-mono text-sm focus:outline-none focus:ring-1 focus:ring-white" value={envText} onChange={(e) => setEnvText(e.target.value)} placeholder="KEY=VALUE per line" />
              </div>

              <div className="mt-6 flex justify-end">
                <Button data-testid="save-config-btn" disabled={saving} onClick={save} className="bg-white text-black hover:bg-white/85">
                  {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <><Save className="mr-1.5 h-4 w-4" /> Save Configuration</>}
                </Button>
              </div>
            </div>
          </TabsContent>

          <TabsContent value="logs" className="mt-5">
            <div className="mb-3 flex items-center gap-2 text-xs text-muted-foreground">
              <span
                data-testid="ws-status-dot"
                className={`h-1.5 w-1.5 rounded-full ${wsConnected ? "animate-pulse bg-emerald-500" : "bg-zinc-600"}`}
              />
              {wsConnected ? "live stream connected" : "connecting…"}
              {liveStatus && <span>· {liveStatus}</span>}
            </div>
            <LogViewer lines={wsLines} live={wsConnected} title="deploy logs" testid="deploy-log-viewer" emptyText="Run a deploy to see build output here (streamed live)." />
          </TabsContent>

          <TabsContent value="container" className="mt-5">
            <div className="mb-3 flex items-center justify-between">
              <span className="font-mono text-xs text-muted-foreground">docker compose logs</span>
              <div className="flex items-center gap-2">
                <Button
                  data-testid="live-container-logs-btn"
                  variant="outline"
                  onClick={toggleLiveContainer}
                  className={`border-white/20 bg-transparent ${liveContainer ? "border-emerald-500/40 text-emerald-400" : ""}`}
                >
                  <Radio className={`mr-1.5 h-3.5 w-3.5 ${liveContainer ? "animate-pulse" : ""}`} />
                  {liveContainer ? "Stop Live" : "Go Live"}
                </Button>
                <Button data-testid="refresh-container-logs-btn" variant="outline" disabled={liveContainer} onClick={loadContainerLogs} className="border-white/20 bg-transparent">
                  <RefreshCw className="mr-1.5 h-3.5 w-3.5" /> Fetch
                </Button>
              </div>
            </div>
            <LogViewer lines={containerLogs} live={liveContainer} title="docker compose logs" testid="container-log-viewer" emptyText="Click Fetch for a snapshot, or Go Live to stream runtime logs." />
          </TabsContent>
        </Tabs>
      </div>
    </Layout>
  );
}
