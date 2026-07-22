import { useCallback, useEffect, useRef, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { toast } from "sonner";
import {
  Rocket, Play, Square, RotateCw, Trash2, ArrowLeft, Save, Loader2,
  GitBranch, Globe, Database, Server, Terminal, RefreshCw, Activity, Radio, ShieldCheck, ExternalLink,
  KeyRound, ScanSearch, AlertTriangle, Check, Plus, Layers, GitCommit, ArrowUpCircle, History, RotateCcw, Webhook, Copy, Zap, FileDiff, TrendingUp, Clock, Pencil,
} from "lucide-react";
import api, { apiError } from "@/lib/api";
import { Layout } from "@/components/Layout";
import { StatusBadge } from "@/components/StatusBadge";
import { SslBadge } from "@/components/SslBadge";
import { EnvBadge } from "@/components/EnvBadge";
import { DomainHealthDot } from "@/components/DomainHealth";
import { LogViewer } from "@/components/LogViewer";
import { ContainerHealth } from "@/components/ContainerHealth";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Switch } from "@/components/ui/switch";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { DSModal, DSButton, DSPanel } from "@/components/ds";
import { MetricsChart } from "@/components/MetricsChart";
import { DeployTimeline } from "@/components/DeployTimeline";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger,
} from "@/components/ui/alert-dialog";

const field = "ds-field bg-transparent focus-visible:ring-1 focus-visible:ring-[var(--ds-primary)]";
const lbl = "text-xs uppercase tracking-wider text-muted-foreground";

function timeAgo(dateStr) {
  if (!dateStr) return null;
  const d = new Date(dateStr);
  if (isNaN(d)) return null;
  const s = Math.floor((Date.now() - d.getTime()) / 1000);
  if (s < 60) return "just now";
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const days = Math.floor(h / 24);
  return `${days}d ago`;
}

export default function ProjectDetail() {
  const { id } = useParams();
  const navigate = useNavigate();
  const [p, setP] = useState(null);
  const [activeTab, setActiveTab] = useState("overview");
  const [form, setForm] = useState(null);
  const [envText, setEnvText] = useState("");
  const [wsLines, setWsLines] = useState([]);
  const [liveStatus, setLiveStatus] = useState("");
  const [wsConnected, setWsConnected] = useState(false);
  const [containerLogs, setContainerLogs] = useState([]);
  const [health, setHealth] = useState([]);
  const [ssl, setSsl] = useState(null);
  const [domainHealth, setDomainHealth] = useState(undefined);
  const [dns, setDns] = useState(null);
  const [envScan, setEnvScan] = useState(null);
  const [scanning, setScanning] = useState(false);
  const [checkingDns, setCheckingDns] = useState(false);
  const [renewing, setRenewing] = useState(false);
  const [updates, setUpdates] = useState(null);
  const [checkingUpdates, setCheckingUpdates] = useState(false);
  const [history, setHistory] = useState([]);
  const [rollbackTarget, setRollbackTarget] = useState(null);
  const [webhook, setWebhook] = useState(null);
  const [savingAuto, setSavingAuto] = useState(false);
  const [deployNote, setDeployNote] = useState("");
  const [deleteConfirm, setDeleteConfirm] = useState("");
  const [showDelete, setShowDelete] = useState(false);
  const [diff, setDiff] = useState(null);
  const [diffLoading, setDiffLoading] = useState(false);
  const [webhookEvents, setWebhookEvents] = useState([]);
  const [liveContainer, setLiveContainer] = useState(false);
  const containerWsRef = useRef(null);
  const [busy, setBusy] = useState("");
  const [saving, setSaving] = useState(false);
  const [deployWarn, setDeployWarn] = useState(null);
  const envInitRef = useRef(false);

  const loadProject = useCallback(async () => {
    try {
      const { data } = await api.get(`/projects/${id}`);
      setP(data);
      setForm((prev) => prev || {
        name: data.name, repo_url: data.repo_url, branch: data.branch, environment: data.environment || "", github_token: "",
        domain: data.domain || "", ssl_mode: data.ssl_mode, ssl_email: data.ssl_email || "",
        ssl_cert_path: data.ssl_cert_path || "", ssl_key_path: data.ssl_key_path || "",
        db_name: data.db_name || "", backend_port: data.backend_port, frontend_port: data.frontend_port,
      });
      if (!envInitRef.current) {
        envInitRef.current = true;
        setEnvText((data.env_vars || []).map((e) => `${e.key}=${e.value}`).join("\n"));
      }
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

  const loadSsl = useCallback(async () => {
    try {
      const { data } = await api.get(`/projects/${id}/ssl-status`);
      setSsl(data);
    } catch (e) {
      setSsl(null);
    }
  }, [id]);

  const loadDomainHealth = useCallback(async () => {
    try {
      const { data } = await api.get(`/projects/${id}/domain-health`);
      setDomainHealth(data);
    } catch (e) {
      setDomainHealth(null);
    }
  }, [id]);

  const checkUpdates = useCallback(async (silent) => {
    if (!silent) setCheckingUpdates(true);
    try {
      const { data } = await api.get(`/projects/${id}/updates`);
      setUpdates(data);
      if (!silent) {
        if (!data.cloned) toast.info("Project not deployed yet — deploy it first");
        else if (data.up_to_date) toast.success("Already up to date");
        else toast.info(`${data.behind} update(s) available`);
      }
    } catch (e) {
      if (!silent) toast.error(apiError(e));
    } finally {
      if (!silent) setCheckingUpdates(false);
    }
  }, [id]);

  const loadHistory = useCallback(async () => {
    try {
      const { data } = await api.get(`/projects/${id}/history`);
      setHistory(data || []);
    } catch (e) {
      setHistory([]);
    }
  }, [id]);

  const loadWebhook = useCallback(async () => {
    try {
      const { data } = await api.get(`/projects/${id}/webhook`);
      setWebhook(data);
    } catch (e) {
      setWebhook(null);
    }
  }, [id]);

  const loadWebhookEvents = useCallback(async () => {
    try {
      const { data } = await api.get(`/projects/${id}/webhook-events`);
      setWebhookEvents(data || []);
    } catch (e) {
      setWebhookEvents([]);
    }
  }, [id]);

  const openDiff = async (base, head) => {
    setDiff({ loading: true, base, head });
    setDiffLoading(true);
    try {
      const { data } = await api.get(`/projects/${id}/diff?base=${encodeURIComponent(base || "")}&head=${encodeURIComponent(head || "")}`);
      setDiff({ ...data, base, head });
    } catch (e) {
      toast.error(apiError(e));
      setDiff(null);
    } finally {
      setDiffLoading(false);
    }
  };

  const toggleAutoDeploy = async (enabled) => {
    setSavingAuto(true);
    try {
      await api.put(`/projects/${id}`, { auto_deploy_enabled: enabled });
      setWebhook((w) => (w ? { ...w, enabled } : w));
      toast.success(enabled ? "Auto-deploy enabled" : "Auto-deploy disabled");
      loadProject();
    } catch (e) {
      toast.error(apiError(e));
    } finally {
      setSavingAuto(false);
    }
  };

  const regenerateWebhook = async () => {
    try {
      const { data } = await api.post(`/projects/${id}/webhook/regenerate`);
      setWebhook(data);
      toast.success("Webhook secret regenerated — update it in GitHub");
    } catch (e) {
      toast.error(apiError(e));
    }
  };

  const copyText = (text, label) => {
    navigator.clipboard?.writeText(text);
    toast.success(`${label} copied`);
  };

  const doRollback = async (commit) => {
    setRollbackTarget(null);
    setBusy("deploy");
    try {
      await api.post(`/projects/${id}/rollback`, { commit });
      toast.success(`Rollback to ${commit.slice(0, 7)} started — see Deploy Logs`);
    } catch (e) {
      toast.error(apiError(e));
    } finally {
      setTimeout(() => setBusy(""), 800);
    }
  };

  useEffect(() => {
    loadProject();
    loadHealth();
    loadSsl();
    const t = setInterval(() => { loadProject(); loadHealth(); loadSsl(); }, 4000);
    return () => clearInterval(t);
  }, [loadProject, loadHealth, loadSsl]);

  useEffect(() => {
    loadDomainHealth();
    const t = setInterval(loadDomainHealth, 60000);
    return () => clearInterval(t);
  }, [loadDomainHealth]);

  useEffect(() => { checkUpdates(true); loadHistory(); loadWebhook(); loadWebhookEvents(); }, [checkUpdates, loadHistory, loadWebhook, loadWebhookEvents]);

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

  const parseEnvText = (text) =>
    text.split("\n").map((l) => l.trim()).filter((l) => l && l.includes("="))
      .map((l) => { const i = l.indexOf("="); return { key: l.slice(0, i).trim(), value: l.slice(i + 1).trim() }; });
  const parseEnv = () => parseEnvText(envText);

  const persistEnv = async (mergedText) => {
    try {
      const payload = { ...form, env_vars: parseEnvText(mergedText) };
      if (!payload.github_token) delete payload.github_token;
      await api.put(`/projects/${id}`, payload);
    } catch (e) {
      toast.error(apiError(e));
    }
  };

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

  const randHex = (n = 48) =>
    Array.from(crypto.getRandomValues(new Uint8Array(n)))
      .map((b) => b.toString(16).padStart(2, "0"))
      .join("");

  const upsertEnvLine = (key, value) => {
    const lines = envText.split("\n").filter((l) => l.trim());
    const idx = lines.findIndex((l) => l.split("=")[0].trim() === key);
    if (idx >= 0) lines[idx] = `${key}=${value}`;
    else lines.push(`${key}=${value}`);
    setEnvText(lines.join("\n"));
  };

  const generateSecret = () => {
    upsertEnvLine("JWT_SECRET", randHex(48));
    toast.success("JWT_SECRET generated — remember to Save");
  };

  // Nexus Standard Env Contract: the same baseline env skeleton for every project.
  const applyStandardEnv = () => {
    const lines = envText.split("\n").filter((l) => l.trim());
    const existing = new Set(lines.map((l) => l.split("=")[0].trim()));
    const standard = [
      ["JWT_SECRET", randHex(48)],
      ["ADMIN_EMAIL", ""],
      ["ADMIN_PASSWORD", ""],
      ["EMERGENT_LLM_KEY", ""],
      ["LOCAL_STORAGE_DIR", "/app/data"],
    ];
    const added = [];
    standard.forEach(([k, v]) => {
      if (!existing.has(k)) { lines.push(`${k}=${v}`); added.push(k); }
    });
    if (added.length) {
      setEnvText(lines.join("\n"));
      toast.success(`Added ${added.length} standard var(s): ${added.join(", ")} — fill ADMIN_EMAIL/PASSWORD & keys, then Save`);
    } else {
      toast.info("All standard variables already present");
    }
  };

  // Classify the env var type to pick a safe default value + hint.
  const classifyEnv = (key) => {
    const k = (key || "").toUpperCase();
    // Internal secret → auto random value
    if (
      /(JWT_SECRET|SECRET_KEY|SESSION_SECRET|APP_SECRET|ENCRYPTION_KEY|FERNET_KEY|SIGNING_KEY|SALT)$/.test(k) ||
      /_SECRET$/.test(k) || k === "SECRET"
    )
      return { gen: true, hint: "Internal app secret — a secure random value is generated automatically." };
    // Specific boolean flags
    if (k === "RESEED")
      return { gen: false, value: "false", hint: "Flag: re-seed data. Safe default: false (don't wipe existing data)." };
    if (k === "SEED_ON_STARTUP")
      return { gen: false, value: "true", hint: "Flag: seed initial data on startup. Default: true." };
    if (/^(ENABLE_|DISABLE_|USE_)/.test(k) || /(_ENABLED|_DISABLED|DEBUG|VERBOSE)$/.test(k))
      return { gen: false, value: "false", hint: "Boolean flag (true/false). Safe default: false." };
    // Password
    if (/(PASSWORD|PASSWD|_PASS)$/.test(k) || k === "PASS")
      return { gen: false, hint: "Login password — type your own memorable value (NOT a random hex)." };
    // API key / token
    if (/(_KEY|APIKEY|API_KEY|_TOKEN|ACCESS_KEY|CLIENT_SECRET|_DSN)$/.test(k) || /TOKEN$/.test(k))
      return { gen: false, hint: "Provider API key/token (e.g. EMERGENT_LLM_KEY) — paste the real value, not a random one." };
    // Specific folders → under /app/data for persistence
    if (/BACKUP.*(DIR|PATH)$/.test(k))
      return { gen: false, value: "/app/data/backups", hint: "Backup folder inside the container (persistent)." };
    if (/LOG.*(DIR|PATH)$/.test(k))
      return { gen: false, value: "/app/data/logs", hint: "Log folder inside the container (persistent)." };
    if (/(UPLOAD|MEDIA|FILE).*(DIR|PATH)$/.test(k))
      return { gen: false, value: "/app/data/uploads", hint: "Upload folder inside the container (persistent)." };
    if (k === "APP_DIR")
      return { gen: false, value: "/app", hint: "Application root inside the container." };
    if (/(DIR|PATH|FOLDER)$/.test(k))
      return { gen: false, value: "/app/data", hint: "Folder path INSIDE the container (e.g. /app/data). Change if needed." };
    // URL / email / number
    if (/URL$/.test(k)) return { gen: false, hint: "Enter a full URL (e.g. https://...)." };
    if (/EMAIL$/.test(k)) return { gen: false, hint: "Enter an email address." };
    if (/(_LIMIT|_MAX|_MIN|_SIZE|_COUNT|_TTL|_TIMEOUT|_PORT|PORT)$/.test(k))
      return { gen: false, hint: "Enter a numeric value." };
    return { gen: false, hint: "Enter an appropriate value." };
  };

  const addMissingVar = (key) => {
    const c = classifyEnv(key);
    const val = c.gen ? randHex(48) : (c.value || "");
    upsertEnvLine(key, val);
    toast.success(`${key}: ${c.hint}`);
  };

  const scanEnv = async () => {
    setScanning(true);
    try {
      const { data } = await api.get(`/projects/${id}/env-scan`);
      setEnvScan(data);
      if (!data.scanned) return;
      // Feature: auto-fill defaults from the README.md table for not-yet-set vars.
      const rd = data.readme_defaults || {};
      const lines = envText.split("\n").filter((l) => l.trim());
      const existing = new Set(lines.map((l) => l.split("=")[0].trim()));
      const applied = [];
      (data.missing || []).forEach((k) => {
        if (!existing.has(k) && rd[k] != null) { lines.push(`${k}=${rd[k]}`); applied.push(k); }
      });
      if (applied.length) {
        setEnvText(lines.join("\n"));
        toast.success(`Filled defaults from README: ${applied.join(", ")} — review then Save`);
      }
      const stillMissing = (data.missing || []).filter((k) => !applied.includes(k));
      if (stillMissing.length === 0) toast.success("All referenced env vars are set");
      else toast.warning(`${stillMissing.length} env var(s) not set`);
    } catch (e) {
      toast.error(apiError(e));
    } finally {
      setScanning(false);
    }
  };

  const doDeploy = async (force) => {
    setBusy("deploy");
    try {
      await api.post(`/projects/${id}/deploy${force ? "?force=true" : ""}`, { note: deployNote });
      toast.success("Deployment started");
      setDeployWarn(null);
      setDeployNote("");
      setTimeout(loadHistory, 1500);
    } catch (e) {
      if (e?.response?.status === 428 && e.response.data?.detail) {
        setDeployWarn(e.response.data.detail);
      } else {
        toast.error(apiError(e));
      }
    } finally {
      setTimeout(() => setBusy(""), 800);
    }
  };

  const fillMissingAndSave = async () => {
    const d = deployWarn || {};
    const rd = d.readme_defaults || {};
    const lines = envText.split("\n").filter((l) => l.trim());
    const existing = new Set(lines.map((l) => l.split("=")[0].trim()));
    (d.missing_required || []).forEach((k) => {
      if (existing.has(k)) return;
      const c = classifyEnv(k);
      const val = rd[k] != null ? rd[k] : (c.gen ? randHex(48) : (c.value || ""));
      lines.push(`${k}=${val}`);
    });
    const merged = lines.join("\n");
    setEnvText(merged);
    await persistEnv(merged);
    toast.success("Defaults filled & saved — complete any empty values (e.g. API keys), then Deploy again");
    setDeployWarn(null);
  };

  const action = async (act) => {
    if (act === "deploy") { doDeploy(false); return; }
    setBusy(act);
    try {
      await api.post(`/projects/${id}/${act}`);
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

  const checkDns = async () => {
    setCheckingDns(true);
    try {
      const { data } = await api.get(`/projects/${id}/dns-check`);
      setDns(data);
      if (data.matches) toast.success("DNS points to this server");
      else toast.warning("DNS does not point to this server yet");
    } catch (e) {
      toast.error(apiError(e));
    } finally {
      setCheckingDns(false);
    }
  };

  const renewSsl = async () => {
    setRenewing(true);
    try {
      await api.post(`/projects/${id}/renew-ssl`);
      toast.success("SSL renewal started — see Deploy Logs");
    } catch (e) {
      toast.error(apiError(e));
    } finally {
      setTimeout(() => setRenewing(false), 800);
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
    return <Layout><div className="p-8 text-sm text-muted-foreground">Loading…</div></Layout>;
  }

  const latestLog = null; // eslint-disable-line
  const upd = updates || {
    cloned: p.current_commit ? true : undefined,
    behind: p.updates_behind || 0,
    current: p.current_commit || null,
    commits: [],
  };
  return (    <Layout>
      <header className="sticky top-14 z-20 border-b border-border bg-background/95 px-4 py-4 backdrop-blur sm:px-8 sm:py-5 lg:top-14">
        <button data-testid="back-btn" onClick={() => navigate("/projects")} className="mb-3 flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground">
          <ArrowLeft className="h-3.5 w-3.5" /> <span className="hover:underline">Projects</span> <span className="text-muted-foreground/50">/</span> <span className="text-foreground">{p.name}</span>
        </button>
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <div className="flex flex-wrap items-center gap-3">
              <h1 className="font-heading text-xl font-bold tracking-tight sm:text-2xl">{p.name}</h1>
              <StatusBadge status={p.status} />
              <SslBadge ssl={ssl} />
              <EnvBadge environment={p.environment} testid="detail-env-badge" />
              {p.domain ? (
                <a
                  data-testid="open-project-url"
                  href={`${ssl && (ssl.state === "active" || ssl.state === "expiring") ? "https" : "http"}://${p.domain}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex items-center gap-1.5 rounded-md border border-[var(--ds-border)] px-2 py-0.5 text-xs text-muted-foreground transition-colors hover:border-[var(--ds-primary)]/40 hover:text-foreground"
                  title={domainHealth?.reachable === true ? "Reachable from the internet" : domainHealth?.reachable === false ? "Unreachable from the internet" : "Checking reachability…"}
                >
                  <DomainHealthDot health={domainHealth} testid="detail-domain-health" />
                  {p.domain}
                  <ExternalLink className="h-3.5 w-3.5" />
                </a>
              ) : (
                <span className="flex items-center gap-1.5 rounded-md border border-[var(--ds-border)] px-2 py-0.5 text-xs text-muted-foreground" data-testid="detail-no-domain">
                  <Globe className="h-3.5 w-3.5" /> No domain
                </span>
              )}
            </div>
            <p className="mt-1.5 text-xs text-muted-foreground">
              Created {timeAgo(p.created_at) || "—"}
              {p.updated_at && <> · Updated {timeAgo(p.updated_at)}</>}
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Button data-testid="deploy-action-btn" disabled={busy} onClick={() => action("deploy")} className="bg-status-running text-black hover:bg-status-running/85">
              {busy === "deploy" ? <Loader2 className="h-4 w-4 animate-spin" /> : <><Rocket className="mr-1.5 h-4 w-4" /> Deploy</>}
            </Button>
            <Button data-testid="start-action-btn" variant="outline" disabled={busy} onClick={() => action("start")} className="border-[var(--ds-border)] bg-transparent"><Play className="h-4 w-4" /></Button>
            <Button data-testid="stop-action-btn" variant="outline" disabled={busy} onClick={() => action("stop")} className="border-[var(--ds-border)] bg-transparent"><Square className="h-4 w-4" /></Button>
            <Button data-testid="restart-action-btn" variant="outline" disabled={busy} onClick={() => action("restart")} className="border-[var(--ds-border)] bg-transparent"><RotateCw className="h-4 w-4" /></Button>
            {p.ssl_mode === "letsencrypt" && (
              <Button data-testid="renew-ssl-btn" variant="outline" disabled={renewing} onClick={renewSsl} className="border-emerald-500/30 bg-transparent text-emerald-400 hover:bg-emerald-500/10">
                {renewing ? <Loader2 className="h-4 w-4 animate-spin" /> : <><ShieldCheck className="mr-1.5 h-4 w-4" /> Renew SSL</>}
              </Button>
            )}
            <Button data-testid="delete-action-btn" variant="outline" onClick={() => setShowDelete(true)} className="border-status-error/40 bg-transparent text-status-error hover:bg-status-error/10"><Trash2 className="h-4 w-4" /></Button>
            <DSModal
              open={showDelete}
              onOpenChange={(o) => { setShowDelete(o); if (!o) setDeleteConfirm(""); }}
              size="sm"
              title={<span className="flex items-center gap-2 text-[var(--ds-danger)]"><Trash2 className="h-5 w-5" /> Delete {p.name}?</span>}
              data-testid="delete-dialog"
              footer={<>
                <DSButton variant="outline" data-testid="delete-cancel" onClick={() => { setShowDelete(false); setDeleteConfirm(""); }}>Cancel</DSButton>
                <DSButton variant="danger" data-testid="confirm-delete-btn" disabled={deleteConfirm.trim() !== p.name} onClick={remove}>Delete permanently</DSButton>
              </>}
            >
              <p className="mb-4 text-[13px] text-[var(--ds-muted)]">This removes containers, nginx config and cloned source. This cannot be undone.</p>
              <div className="space-y-2">
                <Label className="text-[12px] text-[var(--ds-muted)]">Type <span className="text-[var(--ds-text)]">{p.name}</span> to confirm</Label>
                <Input
                  data-testid="delete-confirm-input"
                  value={deleteConfirm}
                  onChange={(e) => setDeleteConfirm(e.target.value)}
                  placeholder={p.name}
                  className={field}
                  autoComplete="off"
                />
              </div>
            </DSModal>
          </div>
        </div>
        {p.last_message && <p className="mt-2 text-xs text-muted-foreground">{p.last_message}</p>}
      </header>

      <DSModal
        open={!!deployWarn} onOpenChange={(o) => !o && setDeployWarn(null)}
        size="md" data-testid="deploy-warn-dialog"
        title={<span className="flex items-center gap-2 text-amber-400"><AlertTriangle className="h-5 w-5" /> Required variables not set</span>}
        footerAlign="end"
        footer={<>
          <DSButton variant="outline" data-testid="deploy-warn-cancel" onClick={() => setDeployWarn(null)}>Cancel</DSButton>
          <DSButton variant="outline" data-testid="deploy-warn-fill" onClick={fillMissingAndSave}>Fill Defaults &amp; Save</DSButton>
          <DSButton data-testid="deploy-warn-force" onClick={() => doDeploy(true)} className="bg-amber-500 text-black hover:bg-amber-500/85">Deploy Anyway</DSButton>
        </>}
      >
        {deployWarn?.message} Deploying may cause some features to fail (e.g. 500 errors).
        <div className="mt-3 flex flex-wrap gap-1.5">
          {(deployWarn?.missing_required || []).map((k) => (
            <span key={k} className="rounded-sm border border-red-500/30 bg-red-500/10 px-2 py-1 text-[12px] text-red-400">{k}</span>
          ))}
        </div>
      </DSModal>

      <Dialog open={!!diff} onOpenChange={(o) => !o && setDiff(null)}>
        <DialogContent className="max-w-3xl border-border bg-card" data-testid="diff-dialog">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-sm">
              <FileDiff className="h-4 w-4 text-sky-400" />
              Changes {diff?.base ? <span className="text-amber-400">{String(diff.base).slice(0, 7)}</span> : "parent"} → <span className="text-emerald-400">{String(diff?.head || "").slice(0, 7)}</span>
            </DialogTitle>
          </DialogHeader>
          {diffLoading ? (
            <div className="flex items-center justify-center py-12 text-muted-foreground"><Loader2 className="mr-2 h-5 w-5 animate-spin" /> Loading diff…</div>
          ) : diff && diff.ok === false ? (
            <div className="py-8 text-center text-sm text-muted-foreground" data-testid="diff-error">{diff.message}</div>
          ) : diff ? (
            <div className="space-y-3">
              {(diff.files || []).length === 0 ? (
                <p className="text-xs text-muted-foreground">No file changes between these commits.</p>
              ) : (
                <div className="max-h-[160px] overflow-y-auto rounded-sm border border-border" data-testid="diff-files">
                  {diff.files.map((f, i) => (
                    <div key={i} className="flex items-center justify-between gap-3 border-b border-border/60 px-3 py-1.5 last:border-b-0 text-[11px]">
                      <span className="min-w-0 flex-1 truncate">{f.path}</span>
                      <span className="whitespace-nowrap">
                        <span className="text-emerald-400">+{f.additions ?? "?"}</span>{" "}
                        <span className="text-red-400">-{f.deletions ?? "?"}</span>
                      </span>
                    </div>
                  ))}
                </div>
              )}
              {diff.patch && (
                <pre className="max-h-[380px] overflow-auto rounded-sm border border-border bg-[#0a0a0a] p-3 font-mono text-[11px] leading-relaxed" data-testid="diff-patch">
                  {diff.patch.split("\n").map((ln, i) => (
                    <div key={i} className={ln.startsWith("+") && !ln.startsWith("+++") ? "text-emerald-400" : ln.startsWith("-") && !ln.startsWith("---") ? "text-red-400" : ln.startsWith("@@") ? "text-sky-400" : "text-zinc-400"}>{ln || " "}</div>
                  ))}
                </pre>
              )}
              {diff.truncated && <p className="text-[10px] text-amber-400">Diff truncated (very large changeset).</p>}
            </div>
          ) : null}
        </DialogContent>
      </Dialog>

      <AlertDialog open={!!rollbackTarget} onOpenChange={(o) => !o && setRollbackTarget(null)}>
        <AlertDialogContent className="border-border bg-card" data-testid="rollback-dialog">
          <AlertDialogHeader>
            <AlertDialogTitle className="flex items-center gap-2 text-sky-400">
              <RotateCcw className="h-4 w-4" /> Rollback to this version?
            </AlertDialogTitle>
            <AlertDialogDescription className="text-xs">
              This checks out commit <span className="text-foreground">{rollbackTarget?.short}</span> ({rollbackTarget?.message}) and rebuilds the containers.
              Your live app will briefly restart during the rebuild.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel className="border-[var(--ds-border)] bg-transparent" data-testid="rollback-cancel">Cancel</AlertDialogCancel>
            <AlertDialogAction data-testid="rollback-confirm" onClick={() => doRollback(rollbackTarget.hash)} className="bg-sky-500 text-black hover:bg-sky-500/85">
              Rollback Now
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <div className="p-4 sm:p-6 lg:p-8">
        {/* meta strip */}
        <div className="mb-5 grid grid-cols-2 divide-y divide-[var(--ds-border)] overflow-hidden rounded-xl border border-border bg-card md:grid-cols-4 md:divide-x md:divide-y-0" data-testid="meta-strip">
          {[
            { icon: GitBranch, label: "Branch", value: p.branch, mono: true },
            { icon: Globe, label: "Domain", value: p.domain || "—" },
            { icon: Server, label: "Ports FE/BE", value: `${p.frontend_port || "—"} / ${p.backend_port || "—"}`, mono: true },
            { icon: Database, label: "Database", value: p.db_name || "—", mono: true },
          ].map((x) => (
            <div key={x.label} className="p-4 sm:p-5">
              <div className="mb-2 flex items-center gap-1.5 text-muted-foreground"><x.icon className="h-3.5 w-3.5" /><span className="text-[11px] uppercase tracking-wider">{x.label}</span></div>
              <div className={`truncate text-sm text-[var(--ds-text)] ${x.mono ? "font-mono" : ""}`}>{x.value}</div>
            </div>
          ))}
        </div>

        {/* stat cards */}
        <div className="mb-6 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5" data-testid="stat-cards">
          {(() => {
            const envVal = p.environment || (envText.match(/^NODE_ENV\s*=\s*(.+)$/m) || [])[1];
            const upEntry = (health || []).find((h) => /^up\s/i.test(h.status || ""));
            const uptimeVal = upEntry ? (upEntry.status.replace(/^up\s+/i, "").replace(/\s*\(.*\)\s*$/, "").trim() || "—") : "—";
            const deploy = p.status === "running" ? "Active" : p.status === "error" ? "Failed" : p.status === "building" || p.status === "cloning" ? "In progress" : "Not started";
            return [
              { icon: Radio, label: "Status", value: p.status, sub: p.status === "created" ? "Waiting to be deployed" : p.last_message ? "See message below" : "Current state", tone: p.status === "running" ? "success" : p.status === "error" ? "error" : "warning" },
              { icon: Rocket, label: "Deployment", value: deploy, sub: deploy === "Not started" ? "Not started" : "Last run", tone: p.status === "running" ? "success" : p.status === "error" ? "error" : "muted" },
              { icon: Clock, label: "Uptime", value: uptimeVal, sub: uptimeVal !== "—" ? "Since last start" : "Not available", tone: uptimeVal !== "—" ? "success" : "muted" },
              { icon: Zap, label: "Last Deploy", value: timeAgo(p.last_deploy_at) || "Never", sub: p.last_deploy_at ? new Date(p.last_deploy_at).toLocaleDateString() : "Never deployed", tone: "muted" },
              { icon: Layers, label: "Environment", value: envVal || "—", sub: envVal ? "Deployment target" : "Not set", tone: envVal ? "primary" : "muted" },
            ].map((s) => {
              const toneCls = { success: "text-[var(--ds-success)]", error: "text-[var(--ds-error)]", warning: "text-[var(--ds-warning)]", primary: "text-[var(--ds-primary)]", muted: "text-[var(--ds-text)]" }[s.tone];
              return (
                <div key={s.label} className="rounded-xl border border-border bg-card p-4 transition-colors hover:border-[var(--ds-primary)]/40" data-testid={`stat-${s.label.toLowerCase().replace(/[^a-z]/g,'')}`}>
                  <div className="mb-2 flex items-center gap-1.5 text-muted-foreground"><s.icon className="h-3.5 w-3.5" /><span className="text-[11px] uppercase tracking-wider">{s.label}</span></div>
                  <div className={`truncate text-lg font-semibold capitalize ${toneCls}`}>{s.value}</div>
                  <div className="mt-0.5 truncate text-[11px] text-muted-foreground">{s.sub}</div>
                </div>
              );
            });
          })()}
        </div>

        <Tabs value={activeTab} onValueChange={setActiveTab}>
          <TabsList className="flex w-full justify-start overflow-x-auto bg-card">
            <TabsTrigger value="overview" data-testid="tab-overview">Overview</TabsTrigger>
            <TabsTrigger value="config" data-testid="tab-config">Configuration</TabsTrigger>
            <TabsTrigger value="metrics" data-testid="tab-metrics">Metrics</TabsTrigger>
            <TabsTrigger value="logs" data-testid="tab-logs">Deploy Logs</TabsTrigger>
            <TabsTrigger value="container" data-testid="tab-container">Container Logs</TabsTrigger>
            <TabsTrigger value="environment" data-testid="tab-environment">Environment</TabsTrigger>
            <TabsTrigger value="history" data-testid="tab-history">History</TabsTrigger>
          </TabsList>

          <TabsContent value="overview" className="mt-5 space-y-4">
        {/* overview: source updates + auto-deploy side by side */}
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <DSPanel
          data-testid="updates-panel" className="lg:order-2"
          title={<span className="flex items-center gap-2"><GitCommit className="h-4 w-4 text-[var(--ds-primary)]" /> Source Updates</span>}
          headerRight={
            <div className="flex items-center gap-2">
              <Button
                data-testid="check-updates-btn"
                variant="outline"
                size="sm"
                disabled={checkingUpdates}
                onClick={() => checkUpdates(false)}
                className="border-[var(--ds-border)] bg-transparent"
              >
                {checkingUpdates ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <><RefreshCw className="mr-1.5 h-3.5 w-3.5" /> Check for Updates</>}
              </Button>
              {upd.behind > 0 && (
                <Button
                  data-testid="update-now-btn"
                  size="sm"
                  disabled={busy}
                  onClick={() => action("deploy")}
                  className="bg-status-running text-black hover:bg-status-running/85"
                >
                  {busy === "deploy" ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <><ArrowUpCircle className="mr-1.5 h-3.5 w-3.5" /> Update Now</>}
                </Button>
              )}
            </div>
          }
        >
          <div className="flex flex-wrap items-center gap-3 text-xs">
            {upd.cloned === false ? (
              <span className="text-muted-foreground" data-testid="updates-not-deployed">Not deployed yet — run a deploy first.</span>
            ) : upd.behind > 0 ? (
              <span className="flex items-center gap-1.5 rounded-sm border border-amber-500/30 bg-amber-500/10 px-2 py-1 text-amber-400" data-testid="updates-available-badge">
                <ArrowUpCircle className="h-3.5 w-3.5" /> {upd.behind} update{upd.behind > 1 ? "s" : ""} available
              </span>
            ) : (
              <span className="flex items-center gap-1.5 rounded-sm border border-emerald-500/30 bg-emerald-500/10 px-2 py-1 text-emerald-400" data-testid="updates-uptodate-badge">
                <Check className="h-3.5 w-3.5" /> Up to date
              </span>
            )}
            {upd.current && (
              <span className="text-muted-foreground" data-testid="updates-current-commit">
                deployed: <span className="text-foreground">{upd.current.short}</span> · {upd.current.message}
              </span>
            )}
          </div>

          {upd.behind > 0 && (upd.commits || []).length > 0 && (
            <div className="mt-3 max-h-[180px] overflow-y-auto rounded-sm border border-border" data-testid="updates-commit-list">
              {(upd.commits || []).map((c) => (
                <div key={c.hash} className="flex items-baseline gap-3 border-b border-border/60 px-3 py-2 last:border-b-0">
                  <span className="text-[11px] text-amber-400">{c.short}</span>
                  <span className="flex-1 truncate text-xs">{c.message}</span>
                  <span className="whitespace-nowrap text-[10px] text-muted-foreground">{c.author} · {new Date(c.date).toLocaleDateString()}</span>
                </div>
              ))}
            </div>
          )}

          <div className="mt-4 flex flex-col gap-2 border-t border-border/60 pt-3 sm:flex-row sm:items-center">
            <Label className="whitespace-nowrap text-[10px] uppercase tracking-wider text-muted-foreground">Deploy note (optional)</Label>
            <Input
              data-testid="deploy-note-input"
              value={deployNote}
              onChange={(e) => setDeployNote(e.target.value)}
              placeholder="e.g. Hotfix: patch login bug — saved to history"
              maxLength={280}
              className={`${field} flex-1 text-xs`}
            />
          </div>
        </DSPanel>

        <DSPanel
          data-testid="auto-deploy-panel" className="lg:order-1"
          title={<span className="flex items-center gap-2"><Zap className="h-4 w-4 text-[var(--ds-primary)]" /> Auto-Deploy (GitHub Webhook)</span>}
          headerRight={
            <div className="flex items-center gap-2">
              <span className="text-xs text-muted-foreground">{webhook?.enabled ? "On" : "Off"}</span>
              <Switch
                data-testid="auto-deploy-toggle"
                checked={!!webhook?.enabled}
                disabled={savingAuto || !webhook}
                onCheckedChange={toggleAutoDeploy}
              />
            </div>
          }
        >
          <p className="text-xs text-muted-foreground">
            When enabled, a push to <span className="text-foreground">{webhook?.branch || p.branch}</span> on GitHub automatically pulls & rebuilds this project.
            {" "}A deploy is skipped (with a Telegram alert) if required env vars are missing.
          </p>

          {webhook?.enabled && (() => {
            const whUrl = webhook.path ? `${window.location.origin}${webhook.path}` : webhook.url;
            return (
            <div className="mt-4 space-y-3" data-testid="webhook-details">
              <div className="space-y-1">
                <Label className="text-[10px] uppercase tracking-wider text-muted-foreground">Payload URL</Label>
                <div className="flex items-center gap-2">
                  <Input data-testid="webhook-url" readOnly value={whUrl} className={`${field} text-xs`} />
                  <Button data-testid="copy-webhook-url" size="sm" variant="outline" onClick={() => copyText(whUrl, "URL")} className="h-9 shrink-0 border-[var(--ds-border)] bg-transparent"><Copy className="h-3.5 w-3.5" /></Button>
                </div>
              </div>
              <div className="space-y-1">
                <Label className="text-[10px] uppercase tracking-wider text-muted-foreground">Secret</Label>
                <div className="flex items-center gap-2">
                  <Input data-testid="webhook-secret" readOnly type="password" value={webhook.secret} className={`${field} text-xs`} />
                  <Button data-testid="copy-webhook-secret" size="sm" variant="outline" onClick={() => copyText(webhook.secret, "Secret")} className="h-9 shrink-0 border-[var(--ds-border)] bg-transparent"><Copy className="h-3.5 w-3.5" /></Button>
                  <Button data-testid="regenerate-webhook" size="sm" variant="outline" onClick={regenerateWebhook} className="h-9 shrink-0 border-[var(--ds-border)] bg-transparent"><RotateCcw className="mr-1.5 h-3.5 w-3.5" /> Rotate</Button>
                </div>
              </div>
              <div className="rounded-sm border border-border bg-background/50 p-3 text-[11px] text-muted-foreground" data-testid="webhook-setup-steps">
                <div className="mb-1 flex items-center gap-1.5 text-foreground"><Webhook className="h-3.5 w-3.5" /> GitHub setup</div>
                <div>1. Repo → Settings → Webhooks → <span className="text-foreground">Add webhook</span></div>
                <div>2. Payload URL = the URL above · Content type = <span className="text-foreground">application/json</span></div>
                <div>3. Secret = the secret above · Events = <span className="text-foreground">Just the push event</span></div>
                <div>4. Save, then push to <span className="text-foreground">{webhook.branch}</span> to trigger a deploy.</div>
              </div>

              {/* Recent Webhook Activity moved to its own card beside Container Health */}
            </div>
            );
          })()}
        </DSPanel>
        </div>

        {/* webhook activity + container health, side by side */}
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2 lg:items-stretch">
          <DSPanel
            data-testid="webhook-activity-panel"
            title={<span className="flex items-center gap-2"><Webhook className="h-4 w-4 text-[var(--ds-primary)]" /> Recent Webhook Activity</span>}
            headerRight={<Button data-testid="refresh-webhook-events" size="sm" variant="ghost" onClick={loadWebhookEvents} className="h-7 px-2 text-[11px] text-muted-foreground hover:text-foreground"><RefreshCw className="mr-1 h-3 w-3" /> Refresh</Button>}
          >
            {webhookEvents.length === 0 ? (
              <div className="rounded-sm border border-border bg-background/50 px-3 py-3 text-[11px] text-muted-foreground" data-testid="webhook-events-empty">
                {webhook?.enabled ? `No webhook triggers yet. Push to ${webhook.branch} to see activity here.` : "Auto-Deploy webhook is off. Enable it above to receive push events."}
              </div>
            ) : (
              <div className="max-h-[240px] overflow-y-auto rounded-sm border border-border" data-testid="webhook-events-list">
                {webhookEvents.map((ev, i) => {
                  const ok = ev.result === "deployed";
                  const skip = (ev.result || "").startsWith("skipped");
                  const cls = ok ? "text-emerald-400 border-emerald-500/30 bg-emerald-500/10"
                    : skip ? "text-amber-400 border-amber-500/30 bg-amber-500/10"
                    : ev.result === "deploying" ? "text-sky-400 border-sky-500/30 bg-sky-500/10"
                    : "text-red-400 border-red-500/30 bg-red-500/10";
                  return (
                    <div key={i} className="flex flex-wrap items-center gap-2 border-b border-border/60 px-3 py-2 last:border-b-0" data-testid="webhook-event-row">
                      <span className="whitespace-nowrap text-[10px] text-muted-foreground">{new Date(ev.ts).toLocaleString()}</span>
                      {ev.commit?.short && <span className="text-[11px] text-amber-400">{ev.commit.short}</span>}
                      <span className="min-w-0 flex-1 truncate text-[11px]">{ev.commit?.message || "—"}</span>
                      {ev.pusher && <span className="text-[10px] text-muted-foreground">by {ev.pusher}</span>}
                      <span className={`rounded-sm border px-1.5 py-0.5 text-[10px] ${cls}`}>{ev.result}</span>
                    </div>
                  );
                })}
              </div>
            )}
          </DSPanel>

          <DSPanel
            data-testid="container-health-panel"
            title={<span className="flex items-center gap-2"><Activity className="h-4 w-4 text-[var(--ds-primary)]" /> Container Health</span>}
          >
            <ContainerHealth containers={health} />
          </DSPanel>
        </div>

        {/* configuration summary (read-only) */}
        <DSPanel
          data-testid="config-summary"
          title={<span className="flex items-center gap-2"><Layers className="h-4 w-4 text-[var(--ds-primary)]" /> Configuration Summary</span>}
          headerRight={<Button data-testid="edit-config-btn" size="sm" variant="outline" onClick={() => setActiveTab("config")} className="h-8 border-[var(--ds-border)] bg-transparent text-xs"><Pencil className="mr-1.5 h-3.5 w-3.5" /> Edit Configuration</Button>}
        >
          <div className="grid grid-cols-2 gap-x-6 gap-y-4 lg:grid-cols-4">
            {[
              { label: "Repository", value: p.repo_url, mono: true },
              { label: "GitHub Token", value: p.has_github_token ? "•••••••• set" : "not set", mono: true },
              { label: "Database", value: p.db_name || "—", mono: true },
              { label: "Frontend Port", value: p.frontend_port || "—", mono: true },
              { label: "Backend Port", value: p.backend_port || "—", mono: true },
              { label: "Domain", value: p.domain || "—" },
              { label: "SSL Mode", value: p.ssl_mode === "letsencrypt" ? "Let's Encrypt" : p.ssl_mode === "custom" ? "Custom" : "None" },
              { label: "Environment", value: p.environment || "—" },
              { label: "Environment Vars", value: `${(envText.split("\n").filter((l) => l.includes("=")).length)} variables` },
            ].map((x) => (
              <div key={x.label} className="min-w-0">
                <div className="mb-1 text-[10px] uppercase tracking-wider text-muted-foreground">{x.label}</div>
                <div className={`truncate text-[13px] text-[var(--ds-text)] ${x.mono ? "font-mono" : ""}`} title={String(x.value)}>{x.value}</div>
              </div>
            ))}
          </div>
        </DSPanel>
          </TabsContent>

          <TabsContent value="config" className="mt-5">
            <DSPanel footerAlign="end" footer={<DSButton data-testid="save-config-btn" variant="primary" loading={saving} onClick={save}>Save Configuration</DSButton>}>
              <div className="grid grid-cols-1 gap-5 md:grid-cols-2">
                <div className="space-y-2"><Label className={lbl}>Name</Label><Input data-testid="cfg-name" className={field} value={form.name} onChange={(e) => setF("name", e.target.value)} /></div>
                <div className="space-y-2"><Label className={lbl}>Branch</Label><Input data-testid="cfg-branch" className={field} value={form.branch} onChange={(e) => setF("branch", e.target.value)} /></div>
                <div className="space-y-2 md:col-span-2">
                  <Label className={lbl}>Environment</Label>
                  <Input data-testid="cfg-environment" list="cfg-env-presets" className={field} value={form.environment} onChange={(e) => setF("environment", e.target.value)} placeholder="e.g. production, staging, demo…" />
                  <datalist id="cfg-env-presets">
                    <option value="production" /><option value="staging" /><option value="demo" /><option value="development" /><option value="testing" />
                  </datalist>
                </div>
                <div className="space-y-2 md:col-span-2"><Label className={lbl}>Repository URL</Label><Input data-testid="cfg-repo" className={field} value={form.repo_url} onChange={(e) => setF("repo_url", e.target.value)} /></div>
                <div className="space-y-2"><Label className={lbl}>GitHub Token {p.has_github_token && <span className="text-status-running">(set)</span>}</Label><Input data-testid="cfg-token" type="password" className={field} value={form.github_token} onChange={(e) => setF("github_token", e.target.value)} placeholder={p.has_github_token ? "•••• leave blank to keep" : "ghp_…"} /></div>
                <div className="space-y-2"><Label className={lbl}>Database Name</Label><Input data-testid="cfg-db" className={field} value={form.db_name} onChange={(e) => setF("db_name", e.target.value)} /></div>
                <div className="space-y-2"><Label className={lbl}>Frontend Port</Label><Input data-testid="cfg-fe-port" type="number" className={field} value={form.frontend_port} onChange={(e) => setF("frontend_port", parseInt(e.target.value) || 0)} /></div>
                <div className="space-y-2"><Label className={lbl}>Backend Port</Label><Input data-testid="cfg-be-port" type="number" className={field} value={form.backend_port} onChange={(e) => setF("backend_port", parseInt(e.target.value) || 0)} /></div>
              </div>

              <div className="mt-6 border-t border-border pt-6">
                <div className="mb-4 flex items-center justify-between">
                  <h3 className="font-heading text-sm font-bold uppercase tracking-wider text-muted-foreground">Domain & SSL</h3>
                  {form.domain && (
                    <Button data-testid="check-dns-btn" variant="outline" disabled={checkingDns} onClick={checkDns} className="h-8 border-[var(--ds-border)] bg-transparent text-xs">
                      {checkingDns ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <><Globe className="mr-1.5 h-3.5 w-3.5" /> Check DNS</>}
                    </Button>
                  )}
                </div>
                {dns && (
                  <div data-testid="dns-result" className={`mb-4 border p-3 text-xs ${dns.matches ? "border-emerald-500/30 bg-emerald-500/5 text-emerald-400" : "border-amber-500/30 bg-amber-500/5 text-amber-400"}`}>
                    <div>domain: {dns.domain || "—"} → {dns.resolved_ips?.length ? dns.resolved_ips.join(", ") : "not resolving"}</div>
                    <div>server ip: {dns.server_ip || "unknown"}</div>
                    <div className="mt-1 font-bold">{dns.matches ? "✓ Domain points to this server — ready for SSL" : "✗ Domain does not point here yet — update the DNS A record"}</div>
                  </div>
                )}
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

            </DSPanel>
          </TabsContent>

          <TabsContent value="environment" className="mt-5">
            <DSPanel
              title={<span className="flex items-center gap-2"><Layers className="h-4 w-4 text-[var(--ds-primary)]" /> Environment Variables</span>}
              headerRight={
                <div className="flex flex-wrap items-center gap-2">
                  <Button data-testid="apply-standard-env-btn" size="sm" variant="outline" onClick={applyStandardEnv} className="h-8 border-[var(--ds-border)] bg-transparent text-xs">
                    <Layers className="mr-1.5 h-3.5 w-3.5" /> Apply Standard Env
                  </Button>
                  <Button data-testid="generate-secret-btn" size="sm" variant="outline" onClick={generateSecret} className="h-8 border-[var(--ds-border)] bg-transparent text-xs">
                    <KeyRound className="mr-1.5 h-3.5 w-3.5" /> Generate JWT Secret
                  </Button>
                  <Button data-testid="scan-env-btn" size="sm" variant="outline" disabled={scanning} onClick={scanEnv} className="h-8 border-[var(--ds-border)] bg-transparent text-xs">
                    {scanning ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <><ScanSearch className="mr-1.5 h-3.5 w-3.5" /> Scan Required Vars</>}
                  </Button>
                </div>
              }
              footerAlign="end"
              footer={<DSButton data-testid="save-env-btn" variant="primary" loading={saving} onClick={save}>Save Environment</DSButton>}
            >
              <p className="mb-3 text-[12px] text-muted-foreground">Backend <code className="font-mono">.env</code> for this project. <code className="font-mono">MONGO_URL</code> &amp; <code className="font-mono">DB_NAME</code> are injected automatically.</p>

              {envScan && envScan.scanned && (
                <div data-testid="env-scan-result" className="mb-3 rounded-[var(--ds-radius-card)] border border-border bg-card p-3">
                  {envScan.required.length === 0 ? (
                    <p className="text-xs text-muted-foreground">No env vars referenced by the repo code.</p>
                  ) : (
                    <>
                      {envScan.missing.length > 0 && (
                        <div data-testid="env-missing-warning" className="mb-2 flex items-start gap-2 border border-amber-500/30 bg-amber-500/10 p-2 text-xs text-amber-400">
                          <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                          <span>{envScan.missing.length} required var(s) not set yet. Deploy will likely fail (e.g. 500 on login) until you add them.</span>
                        </div>
                      )}
                      <div className="flex flex-wrap gap-1.5">
                        {envScan.required.map((r) => (
                          <button
                            key={r.key}
                            data-testid={`env-req-${r.key}`}
                            type="button"
                            onClick={() => !r.provided && addMissingVar(r.key)}
                            title={r.provided ? "Already set" : classifyEnv(r.key).hint}
                            className={`inline-flex items-center gap-1.5 rounded-sm border px-2 py-1 text-[11px] ${
                              r.provided
                                ? "border-emerald-500/25 bg-emerald-500/10 text-emerald-400"
                                : "border-red-500/30 bg-red-500/10 text-red-400 hover:bg-red-500/20"
                            }`}
                          >
                            {r.provided ? <Check className="h-3 w-3" /> : <Plus className="h-3 w-3" />}
                            {r.key}
                            <span className="text-muted-foreground">·{r.source}</span>
                          </button>
                        ))}
                      </div>
                    </>
                  )}
                </div>
              )}
              {envScan && !envScan.scanned && (
                <p data-testid="env-scan-msg" className="mb-3 text-xs text-amber-400">{envScan.message}</p>
              )}

              <textarea data-testid="cfg-env" className="min-h-[280px] w-full rounded-[var(--ds-radius-input)] border border-[var(--ds-border)] bg-transparent p-3 font-mono text-sm focus:outline-none focus:ring-1 focus:ring-[var(--ds-primary)]" value={envText} onChange={(e) => setEnvText(e.target.value)} placeholder="KEY=VALUE per line" />
            </DSPanel>
          </TabsContent>

          <TabsContent value="metrics" className="mt-5">
            <DSPanel title={<span className="flex items-center gap-2"><TrendingUp className="h-4 w-4 text-[var(--ds-primary)]" /> Resource Metrics</span>}>
              <MetricsChart projectId={id} />
            </DSPanel>
          </TabsContent>

          <TabsContent value="history" className="mt-5 space-y-5">
            <DSPanel data-testid="timeline-panel" title={<span className="flex items-center gap-2"><TrendingUp className="h-4 w-4 text-[var(--ds-primary)]" /> Deploy Timeline</span>}>
              <DeployTimeline history={history} />
            </DSPanel>
            <DSPanel
              data-testid="history-list"
              title={<span className="flex items-center gap-2"><History className="h-4 w-4 text-[var(--ds-primary)]" /> Deploy History</span>}
              headerRight={<Button data-testid="refresh-history-btn" variant="outline" size="sm" onClick={loadHistory} className="h-8 border-[var(--ds-border)] bg-transparent text-xs"><RefreshCw className="mr-1.5 h-3.5 w-3.5" /> Refresh</Button>}
              bodyClassName="!p-0"
            >
              {history.length === 0 ? (
                <div className="p-8 text-center text-sm text-muted-foreground" data-testid="history-empty">
                  No deploy history yet. Deploy this project to start tracking versions.
                </div>
              ) : (
                <div className="overflow-x-auto">
                <table className="w-full min-w-[860px] text-left text-sm" data-testid="history-table">
                  <thead className="border-b border-border text-[11px] uppercase tracking-wider text-muted-foreground">
                    <tr>
                      <th className="px-5 py-3 font-medium">When</th>
                      <th className="px-5 py-3 font-medium">Type</th>
                      <th className="px-5 py-3 font-medium">Commit</th>
                      <th className="px-5 py-3 font-medium">Note</th>
                      <th className="px-5 py-3 font-medium">Result</th>
                      <th className="px-5 py-3 font-medium">Duration</th>
                      <th className="px-5 py-3 font-medium text-right">Action</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border/60">
                    {history.map((h, i) => {
                      const c = h.commit || {};
                      const isCurrent = upd.current && c.hash && upd.current.hash === c.hash;
                      const canRollback = h.status === "success" && c.hash && !isCurrent;
                      const prevCommit = history[i + 1]?.commit?.hash;
                      return (
                        <tr key={i} className="hover:bg-[var(--ds-hover)]" data-testid="history-row">
                          <td className="whitespace-nowrap px-5 py-3 text-xs text-muted-foreground">{new Date(h.started_at).toLocaleString()}</td>
                          <td className="px-5 py-3">
                            <span className={`rounded-sm border px-2 py-0.5 text-[11px] ${h.action === "rollback" ? "border-sky-500/30 bg-sky-500/10 text-sky-400" : "border-[var(--ds-border)] bg-[var(--ds-hover)] text-zinc-300"}`}>{h.action}</span>
                          </td>
                          <td className="px-5 py-3">
                            {c.short ? (
                              <span className="text-xs">
                                <span className="text-amber-400">{c.short}</span>
                                <span className="ml-2 text-muted-foreground">{c.message}</span>
                                {isCurrent && <span className="ml-2 rounded-sm border border-emerald-500/30 bg-emerald-500/10 px-1.5 py-0.5 text-[10px] text-emerald-400">current</span>}
                              </span>
                            ) : <span className="text-xs text-muted-foreground">—</span>}
                          </td>
                          <td className="px-5 py-3 max-w-[200px]">
                            {h.note ? <span className="block truncate text-xs text-zinc-300" title={h.note} data-testid="history-note">{h.note}</span> : <span className="text-xs text-muted-foreground">—</span>}
                          </td>
                          <td className="px-5 py-3">
                            <span className={`rounded-sm border px-2 py-0.5 text-[11px] ${h.status === "success" ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-400" : "border-red-500/30 bg-red-500/10 text-red-400"}`}>{h.status}</span>
                          </td>
                          <td className="px-5 py-3 text-xs text-muted-foreground">{h.duration_s != null ? `${h.duration_s}s` : "—"}</td>
                          <td className="px-5 py-3">
                            <div className="flex items-center justify-end gap-1.5">
                              {c.hash && (
                                <Button
                                  data-testid={`diff-btn-${c.short}`}
                                  variant="outline"
                                  size="sm"
                                  onClick={() => openDiff(prevCommit || "", c.hash)}
                                  className="h-7 border-[var(--ds-border)] bg-transparent text-xs"
                                >
                                  <FileDiff className="mr-1.5 h-3 w-3" /> Changes
                                </Button>
                              )}
                              {canRollback && (
                                <Button
                                  data-testid={`rollback-btn-${c.short}`}
                                  variant="outline"
                                  size="sm"
                                  disabled={busy}
                                  onClick={() => setRollbackTarget(c)}
                                  className="h-7 border-sky-500/30 bg-transparent text-xs text-sky-400 hover:bg-sky-500/10"
                                >
                                  <RotateCcw className="mr-1.5 h-3 w-3" /> Rollback
                                </Button>
                              )}
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
                </div>
              )}
            </DSPanel>
          </TabsContent>

          <TabsContent value="logs" className="mt-5">
            <DSPanel
              title={<span className="flex items-center gap-2"><Terminal className="h-4 w-4 text-[var(--ds-primary)]" /> Deploy Logs</span>}
              headerRight={
                <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
                  <span data-testid="ws-status-dot" className={`h-1.5 w-1.5 rounded-full ${wsConnected ? "animate-pulse bg-emerald-500" : "bg-zinc-600"}`} />
                  {wsConnected ? "live stream connected" : "connecting…"}
                  {liveStatus && <span>· {liveStatus}</span>}
                </span>
              }
              bodyClassName="!p-0"
            >
              <LogViewer lines={wsLines} live={wsConnected} flush filterable downloadable filename={`${p.slug}-deploy.log`} title="" testid="deploy-log-viewer" emptyText="Run a deploy to see build output here (streamed live)." />
            </DSPanel>
          </TabsContent>

          <TabsContent value="container" className="mt-5">
            <DSPanel
              title={<span className="flex items-center gap-2"><Terminal className="h-4 w-4 text-[var(--ds-primary)]" /> Container Logs</span>}
              headerRight={
                <div className="flex items-center gap-2">
                  <Button
                    data-testid="live-container-logs-btn"
                    variant="outline" size="sm"
                    onClick={toggleLiveContainer}
                    className={`h-8 border-[var(--ds-border)] bg-transparent text-xs ${liveContainer ? "border-emerald-500/40 text-emerald-400" : ""}`}
                  >
                    <Radio className={`mr-1.5 h-3.5 w-3.5 ${liveContainer ? "animate-pulse" : ""}`} />
                    {liveContainer ? "Stop Live" : "Go Live"}
                  </Button>
                  <Button data-testid="refresh-container-logs-btn" variant="outline" size="sm" disabled={liveContainer} onClick={loadContainerLogs} className="h-8 border-[var(--ds-border)] bg-transparent text-xs">
                    <RefreshCw className="mr-1.5 h-3.5 w-3.5" /> Fetch
                  </Button>
                </div>
              }
              bodyClassName="!p-0"
            >
              <LogViewer lines={containerLogs} live={liveContainer} flush filterable downloadable filename={`${p.slug}-container.log`} title="" testid="container-log-viewer" emptyText="Click Fetch for a snapshot, or Go Live to stream runtime logs." />
            </DSPanel>
          </TabsContent>
        </Tabs>
      </div>
    </Layout>
  );
}
