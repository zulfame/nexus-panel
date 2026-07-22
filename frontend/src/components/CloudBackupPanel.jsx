import { useCallback, useEffect, useRef, useState } from "react";
import notify from "@/lib/notify";
import api, { apiError } from "@/lib/api";
import { useAuth } from "@/context/AuthContext";
import { DSPanel, DSButton, DSModal } from "@/components/ds";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Cloud, CloudUpload, PlugZap, Download, Trash2, CheckCircle2, XCircle, Loader2, RefreshCw,
} from "lucide-react";

const field = "ds-field bg-transparent focus-visible:ring-1 focus-visible:ring-[var(--ds-primary)]";
const lbl = "text-xs font-bold uppercase tracking-[0.1em] text-muted-foreground mb-1 block";
const sel = "w-full rounded-md border border-[var(--ds-border)] bg-[var(--ds-card)] px-3 py-2 text-sm text-[var(--ds-text)] focus:outline-none focus:ring-1 focus:ring-[var(--ds-primary)]";

const PROVIDERS = [
  { id: "aws", label: "AWS S3" },
  { id: "r2", label: "Cloudflare R2" },
  { id: "minio", label: "MinIO" },
  { id: "custom", label: "Other (S3-compatible)" },
];

function fmtBytes(b) {
  if (!b) return "0 B";
  const u = ["B", "KB", "MB", "GB"];
  const i = Math.floor(Math.log(b) / Math.log(1024));
  return `${(b / Math.pow(1024, i)).toFixed(1)} ${u[i]}`;
}
function fmtDate(iso) {
  return iso ? new Date(iso).toLocaleString() : "—";
}
const statusColor = (s) =>
  s === "success" ? "text-emerald-400" : s === "partial" ? "text-amber-400" : s === "running" ? "text-[var(--ds-primary)]" : "text-red-400";

export function CloudBackupPanel() {
  const { hasRole } = useAuth();
  const canEdit = hasRole("admin");
  const [cfg, setCfg] = useState(null);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [runs, setRuns] = useState([]);
  const [runningNow, setRunningNow] = useState(false);
  const [logOpen, setLogOpen] = useState(false);
  const [activeRun, setActiveRun] = useState(null);
  const pollRef = useRef(null);

  const loadConfig = useCallback(async () => {
    try {
      const { data } = await api.get("/settings/s3");
      setCfg({ ...data, secret_access_key: "" });
    } catch (e) { /* ignore */ }
  }, []);

  const loadRuns = useCallback(async () => {
    try {
      const { data } = await api.get("/cloud-backup/runs");
      setRuns(data);
    } catch (e) { /* ignore */ }
  }, []);

  useEffect(() => { loadConfig(); loadRuns(); }, [loadConfig, loadRuns]);
  useEffect(() => () => { if (pollRef.current) clearInterval(pollRef.current); }, []);

  const set = (k, v) => setCfg((c) => ({ ...c, [k]: v }));

  const onProvider = (p) => {
    setCfg((c) => ({
      ...c,
      provider: p,
      region: p === "r2" ? "auto" : c.region,
      path_style: p === "minio" ? true : c.path_style,
    }));
  };

  const save = async () => {
    setSaving(true);
    try {
      const { data } = await api.put("/settings/s3", cfg);
      setCfg({ ...data, secret_access_key: "" });
      notify.success("Cloud storage settings saved");
    } catch (e) {
      notify.error("Could not save settings", apiError(e));
    } finally {
      setSaving(false);
    }
  };

  const test = async () => {
    setTesting(true);
    try {
      const { data } = await api.post("/settings/s3/test");
      if (data.ok) notify.success("Connection successful", "Bucket is reachable.");
      else notify.error("Connection failed", data.error || "Check your credentials & endpoint.");
    } catch (e) {
      notify.error("Connection failed", apiError(e));
    } finally {
      setTesting(false);
    }
  };

  const pollRun = (runId) => {
    if (pollRef.current) clearInterval(pollRef.current);
    pollRef.current = setInterval(async () => {
      try {
        const { data } = await api.get(`/cloud-backup/runs/${runId}`);
        setActiveRun(data);
        if (data.done) {
          clearInterval(pollRef.current);
          pollRef.current = null;
          setRunningNow(false);
          loadRuns();
          if (data.status === "success") notify.success("Cloud backup complete");
          else if (data.status === "partial") notify.error("Cloud backup finished with errors");
          else notify.error("Cloud backup failed");
        }
      } catch (e) { /* keep polling */ }
    }, 2000);
  };

  const backupNow = async () => {
    setRunningNow(true);
    try {
      const { data } = await api.post("/cloud-backup/run");
      setActiveRun({ id: data.run_id, status: "running", lines: [], files: [] });
      setLogOpen(true);
      pollRun(data.run_id);
    } catch (e) {
      setRunningNow(false);
      notify.error("Could not start backup", apiError(e));
    }
  };

  const openRun = async (runId) => {
    try {
      const { data } = await api.get(`/cloud-backup/runs/${runId}`);
      setActiveRun(data);
      setLogOpen(true);
    } catch (e) {
      notify.error(apiError(e));
    }
  };

  const download = async (runId, key) => {
    try {
      const { data } = await api.get(`/cloud-backup/runs/${runId}/download`, { params: { key } });
      window.open(data.url, "_blank", "noopener");
    } catch (e) {
      notify.error("Could not create download link", apiError(e));
    }
  };

  const deleteRun = async (runId) => {
    try {
      await api.delete(`/cloud-backup/runs/${runId}`);
      notify.success("Backup deleted from cloud");
      loadRuns();
    } catch (e) {
      notify.error("Could not delete backup", apiError(e));
    }
  };

  if (!cfg) return <div className="text-sm text-muted-foreground">Loading…</div>;

  return (
    <div className="space-y-6">
      <DSPanel
        data-testid="s3-config-card"
        title={<span className="flex items-center gap-2"><Cloud className="h-4 w-4 text-[var(--ds-primary)]" strokeWidth={1.5} /> Cloud Storage (S3-compatible)</span>}
        headerRight={
          <span className="flex items-center gap-1.5 text-xs text-[var(--ds-muted)]" data-testid="s3-status">
            <span className={`h-1.5 w-1.5 rounded-full ${cfg.configured ? "bg-emerald-500" : "bg-zinc-600"}`} />
            {cfg.configured ? "configured" : "not configured"}
          </span>
        }
        footerAlign="end"
        footer={canEdit && <>
          <DSButton data-testid="s3-test-btn" variant="outline" icon={PlugZap} loading={testing} disabled={testing || !cfg.bucket || !cfg.access_key_id} onClick={test}>Test Connection</DSButton>
          <DSButton data-testid="s3-save-btn" variant="primary" loading={saving} onClick={save}>Save</DSButton>
        </>}
      >
        <p className="mb-4 text-[13px] text-[var(--ds-muted)]">
          Off-server disaster recovery. Backups dump the panel database and every project database
          (<code className="text-[11px]">mongodump --gzip</code>) and upload them to your bucket, so every object is directly restorable.
          Works with AWS S3, Cloudflare R2 and MinIO.
        </p>
        <div className="space-y-4">
          <label className="flex items-center gap-2.5 text-sm" data-testid="s3-enabled-row">
            <input type="checkbox" checked={!!cfg.enabled} disabled={!canEdit} onChange={(e) => set("enabled", e.target.checked)} data-testid="s3-enabled" className="h-4 w-4 accent-[var(--ds-primary)]" />
            <span>Enable cloud backups</span>
          </label>

          <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
            <div>
              <Label className={lbl}>Provider</Label>
              <select className={sel} value={cfg.provider} disabled={!canEdit} onChange={(e) => onProvider(e.target.value)} data-testid="s3-provider">
                {PROVIDERS.map((p) => <option key={p.id} value={p.id}>{p.label}</option>)}
              </select>
            </div>
            <div>
              <Label className={lbl}>Region</Label>
              <Input className={field} value={cfg.region || ""} disabled={!canEdit} onChange={(e) => set("region", e.target.value)} placeholder={cfg.provider === "r2" ? "auto" : "us-east-1"} data-testid="s3-region" />
            </div>
          </div>

          {cfg.provider !== "aws" && (
            <div>
              <Label className={lbl}>Endpoint URL</Label>
              <Input className={field} value={cfg.endpoint_url || ""} disabled={!canEdit} onChange={(e) => set("endpoint_url", e.target.value)}
                placeholder={cfg.provider === "r2" ? "https://<account>.r2.cloudflarestorage.com" : "https://minio.example.com:9000"} data-testid="s3-endpoint" />
            </div>
          )}

          <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
            <div>
              <Label className={lbl}>Bucket</Label>
              <Input className={field} value={cfg.bucket || ""} disabled={!canEdit} onChange={(e) => set("bucket", e.target.value)} placeholder="my-backups" data-testid="s3-bucket" />
            </div>
            <div>
              <Label className={lbl}>Prefix (folder)</Label>
              <Input className={field} value={cfg.prefix || ""} disabled={!canEdit} onChange={(e) => set("prefix", e.target.value)} placeholder="nexus-backups" data-testid="s3-prefix" />
            </div>
          </div>

          <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
            <div>
              <Label className={lbl}>Access Key ID</Label>
              <Input className={field} value={cfg.access_key_id || ""} disabled={!canEdit} onChange={(e) => set("access_key_id", e.target.value)} placeholder="AKIA… / R2 token id" data-testid="s3-access-key" />
            </div>
            <div>
              <Label className={lbl}>Secret Access Key</Label>
              <Input type="password" className={field} value={cfg.secret_access_key || ""} disabled={!canEdit} onChange={(e) => set("secret_access_key", e.target.value)}
                placeholder={cfg.secret_set ? "•••••••• (leave blank to keep current)" : "secret access key"} data-testid="s3-secret-key" />
            </div>
          </div>

          <label className="flex items-center gap-2.5 text-sm" data-testid="s3-pathstyle-row">
            <input type="checkbox" checked={!!cfg.path_style} disabled={!canEdit} onChange={(e) => set("path_style", e.target.checked)} data-testid="s3-path-style" className="h-4 w-4 accent-[var(--ds-primary)]" />
            <span>Use path-style addressing <span className="text-[11px] text-muted-foreground">(required for most MinIO setups)</span></span>
          </label>

          <div className="rounded-sm border border-border/60 bg-[var(--ds-hover)]/40 p-4">
            <div className="mb-3 text-xs font-bold uppercase tracking-[0.1em] text-muted-foreground">Schedule &amp; Retention</div>
            <label className="mb-3 flex items-center gap-2.5 text-sm" data-testid="s3-schedule-row">
              <input type="checkbox" checked={!!cfg.schedule_enabled} disabled={!canEdit} onChange={(e) => set("schedule_enabled", e.target.checked)} data-testid="s3-schedule-enabled" className="h-4 w-4 accent-[var(--ds-primary)]" />
              <span>Automatic daily backup</span>
            </label>
            <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
              <div>
                <Label className={lbl}>Daily run hour (UTC, 0–23)</Label>
                <Input type="number" min={0} max={23} className={field} value={cfg.schedule_hour ?? 3} disabled={!canEdit} onChange={(e) => set("schedule_hour", Number(e.target.value))} data-testid="s3-schedule-hour" />
              </div>
              <div>
                <Label className={lbl}>Keep last N backups</Label>
                <Input type="number" min={1} max={365} className={field} value={cfg.keep ?? 7} disabled={!canEdit} onChange={(e) => set("keep", Number(e.target.value))} data-testid="s3-keep" />
              </div>
            </div>
          </div>
        </div>
      </DSPanel>

      <DSPanel
        data-testid="cloud-backup-runs-card"
        title={<span className="flex items-center gap-2"><CloudUpload className="h-4 w-4 text-[var(--ds-primary)]" strokeWidth={1.5} /> Cloud Backups</span>}
        headerRight={
          <div className="flex items-center gap-2">
            <DSButton variant="ghost" size="sm" icon={RefreshCw} onClick={loadRuns} data-testid="cloud-backup-refresh">Refresh</DSButton>
            {canEdit && (
              <DSButton variant="primary" size="sm" icon={CloudUpload} loading={runningNow} disabled={runningNow || !cfg.configured} onClick={backupNow} data-testid="cloud-backup-now">Backup Now</DSButton>
            )}
          </div>
        }
      >
        {runs.length === 0 ? (
          <div className="rounded-sm border border-dashed border-border py-8 text-center text-xs text-muted-foreground" data-testid="no-cloud-backups">
            {cfg.configured ? "No cloud backups yet. Click “Backup Now” to create one." : "Configure and save cloud storage above to start."}
          </div>
        ) : (
          <div className="divide-y divide-border/60 rounded-sm border border-border" data-testid="cloud-backup-list">
            {runs.map((r) => (
              <div key={r.id} className="flex items-center justify-between gap-3 px-3 py-2.5" data-testid={`cloud-backup-row-${r.id}`}>
                <button className="min-w-0 flex-1 text-left" onClick={() => openRun(r.id)} data-testid={`cloud-backup-open-${r.id}`}>
                  <div className="flex items-center gap-2 text-xs">
                    <span className={`font-medium uppercase ${statusColor(r.status)}`}>{r.status}</span>
                    <span className="text-muted-foreground">· {r.trigger}</span>
                    <span className="text-muted-foreground">· {r.files?.length || 0} file(s)</span>
                  </div>
                  <div className="mt-0.5 truncate text-[10px] text-muted-foreground">{fmtDate(r.started_at)} · {r.run_key || "—"}</div>
                </button>
                {canEdit && (
                  <button onClick={() => deleteRun(r.id)} data-testid={`cloud-backup-delete-${r.id}`} className="shrink-0 rounded-sm p-1.5 text-red-400 hover:bg-red-500/10" title="Delete from cloud">
                    <Trash2 className="h-3.5 w-3.5" strokeWidth={1.5} />
                  </button>
                )}
              </div>
            ))}
          </div>
        )}
      </DSPanel>

      <DSModal
        open={logOpen} onOpenChange={setLogOpen} size="lg"
        title={<span className="flex items-center gap-2">
          {activeRun?.status === "running" ? <Loader2 className="h-4 w-4 animate-spin text-[var(--ds-primary)]" /> :
            activeRun?.status === "success" ? <CheckCircle2 className="h-4 w-4 text-emerald-400" /> : <XCircle className="h-4 w-4 text-red-400" />}
          Cloud Backup — <span className={statusColor(activeRun?.status)}>{activeRun?.status}</span>
        </span>}
        data-testid="cloud-backup-log-modal"
        footer={<DSButton variant="outline" onClick={() => setLogOpen(false)}>Close</DSButton>}
      >
        <div className="max-h-[360px] overflow-y-auto rounded-sm border border-border bg-[#050505] p-3 font-mono text-[11px] leading-relaxed" data-testid="cloud-backup-log">
          {(activeRun?.lines || []).length === 0 ? (
            <div className="text-muted-foreground">Starting…</div>
          ) : activeRun.lines.map((l, i) => (
            <div key={i} className={
              l.stream === "error" ? "text-red-400" : l.stream === "success" ? "text-emerald-400" : l.stream === "warning" ? "text-amber-400" : "text-zinc-300"
            }>{l.text}</div>
          ))}
        </div>
        {activeRun?.files?.length > 0 && (
          <div className="mt-4">
            <div className="mb-2 text-xs font-bold uppercase tracking-[0.1em] text-muted-foreground">Uploaded files</div>
            <div className="divide-y divide-border/60 rounded-sm border border-border">
              {activeRun.files.map((f) => (
                <div key={f.key} className="flex items-center justify-between px-3 py-2" data-testid={`cloud-backup-file-${f.db}`}>
                  <div className="min-w-0">
                    <div className="truncate text-xs">{f.db}</div>
                    <div className="text-[10px] text-muted-foreground">{fmtBytes(f.size)}</div>
                  </div>
                  <button onClick={() => download(activeRun.id, f.key)} data-testid={`cloud-backup-download-${f.db}`} className="flex items-center gap-1.5 rounded-sm border border-border px-2.5 py-1 text-[11px] text-muted-foreground hover:bg-[var(--ds-hover)] hover:text-foreground">
                    <Download className="h-3 w-3" strokeWidth={1.5} /> Download
                  </button>
                </div>
              ))}
            </div>
          </div>
        )}
      </DSModal>
    </div>
  );
}
