import { useCallback, useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { toast } from "sonner";
import {
  Database, RefreshCw, DatabaseBackup, Archive, Download, Trash2, RotateCcw, HardDrive,
} from "lucide-react";
import api, { API, apiError } from "@/lib/api";
import { Layout } from "@/components/Layout";
import "@/styles/design-system.css";
import {
  DSCard, DSButton, DSIconButton, DSEmptyState, DSAlert, DSModal, DSCheckbox, DSSkeleton,
} from "@/components/ds";
import { EnvBadge } from "@/components/EnvBadge";
import { LogViewer } from "@/components/LogViewer";

const fmtBytes = (n) => {
  if (!n) return "0 B";
  const u = ["B", "KB", "MB", "GB", "TB"];
  const i = Math.floor(Math.log(n) / Math.log(1024));
  return `${(n / Math.pow(1024, i)).toFixed(i ? 1 : 0)} ${u[i]}`;
};
const fmtDate = (sec) => (sec ? new Date(sec * 1000).toLocaleString() : "—");

export default function Databases() {
  const [dbs, setDbs] = useState([]);
  const [tools, setTools] = useState({ mongodump: true, mongorestore: true });
  const [loading, setLoading] = useState(true);

  // job streaming modal
  const [job, setJob] = useState(null); // { kind, id, log, done, rc, dbName }
  const jobTimer = useRef(null);

  // manage-backups modal
  const [manage, setManage] = useState(null); // { db, backups }
  const [manageLoading, setManageLoading] = useState(false);

  // restore confirm modal
  const [restore, setRestore] = useState(null); // { db, file, drop }
  const [acting, setActing] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const { data } = await api.get("/databases");
      setDbs(data.databases || []);
      setTools(data.tools || {});
    } catch (e) {
      toast.error(apiError(e));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);
  useEffect(() => () => clearInterval(jobTimer.current), []);

  const pollJob = async (id, kind, dbName) => {
    try {
      const { data } = await api.get(`/databases/jobs/${id}`);
      const lines = (data.lines || []).map((l) => ({ stream: l.stream, text: l.text }));
      setJob({ kind, id, dbName, log: lines, done: !!data.done, rc: data.rc });
      if (data.done) {
        clearInterval(jobTimer.current);
        load();
      }
    } catch (e) {
      // keep trying a few times
    }
  };

  const startJob = async (kind, db, extra = {}) => {
    setActing(true);
    try {
      const path = kind === "backup"
        ? `/databases/${db.project_id}/backup`
        : `/databases/${db.project_id}/restore`;
      const { data } = await api.post(path, extra);
      setJob({ kind, id: data.job_id, dbName: db.db_name, log: [], done: false, rc: null });
      clearInterval(jobTimer.current);
      jobTimer.current = setInterval(() => pollJob(data.job_id, kind, db.db_name), 1200);
      pollJob(data.job_id, kind, db.db_name);
      setManage(null);
      setRestore(null);
    } catch (e) {
      toast.error(apiError(e));
    } finally {
      setActing(false);
    }
  };

  const closeJob = () => {
    if (job && !job.done) return; // block while running
    clearInterval(jobTimer.current);
    setJob(null);
  };

  const openManage = async (db) => {
    setManage({ db, backups: [] });
    setManageLoading(true);
    try {
      const { data } = await api.get(`/databases/${db.project_id}`);
      setManage({ db, backups: data.backups || [] });
    } catch (e) {
      toast.error(apiError(e));
    } finally {
      setManageLoading(false);
    }
  };

  const downloadBackup = async (db, name) => {
    try {
      const token = localStorage.getItem("panel_token") || sessionStorage.getItem("panel_token");
      const res = await fetch(`${API}/databases/${db.project_id}/backups/${name}/download`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) throw new Error("Download failed");
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url; a.download = name;
      document.body.appendChild(a); a.click(); document.body.removeChild(a);
      URL.revokeObjectURL(url);
    } catch (e) {
      toast.error("Download failed");
    }
  };

  const deleteBackup = async (db, name) => {
    try {
      await api.delete(`/databases/${db.project_id}/backups/${name}`);
      toast.success("Backup deleted");
      openManage(db);
      load();
    } catch (e) {
      toast.error(apiError(e));
    }
  };

  const toolsMissing = !tools.mongodump || !tools.mongorestore;

  return (
    <Layout>
      <div className="min-h-screen">
        <header className="sticky top-14 z-20 flex flex-wrap items-center justify-between gap-3 border-b border-[var(--ds-border)] bg-[var(--ds-page)]/85 px-4 py-5 backdrop-blur-xl sm:px-8 lg:top-14">
          <div>
            <h1 className="text-[24px] font-bold tracking-tight text-[var(--ds-text)]">Databases</h1>
            <p className="mt-0.5 text-[13px] text-[var(--ds-muted)]">Manage, back up and restore every project's MongoDB</p>
          </div>
          <DSButton variant="outline" size="sm" icon={RefreshCw} onClick={load} disabled={loading} data-testid="databases-refresh">Refresh</DSButton>
        </header>

        <div className="space-y-4 p-4 sm:p-6 lg:p-8">
          {toolsMissing && (
            <DSAlert variant="warning" title="Database tools not installed">
              <code className="font-mono">mongodump</code>/<code className="font-mono">mongorestore</code> were not found on this host.
              Backup &amp; restore need the <code className="font-mono">mongodb-database-tools</code> package (installed automatically on the VPS).
            </DSAlert>
          )}

          <DSCard data-testid="databases-table">
            <div className="overflow-x-auto">
              <table className="w-full min-w-[720px] text-left text-sm">
                <thead className="border-b border-[var(--ds-border)] text-[12px] uppercase tracking-wider text-[var(--ds-muted)]">
                  <tr>
                    <th className="px-5 py-3 font-medium">Database</th>
                    <th className="px-5 py-3 font-medium">Size</th>
                    <th className="px-5 py-3 font-medium">Collections</th>
                    <th className="px-5 py-3 font-medium">Backups</th>
                    <th className="px-5 py-3 font-medium">Status</th>
                    <th className="px-5 py-3 text-right font-medium">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[var(--ds-border)]/60">
                  {loading ? (
                    [...Array(3)].map((_, i) => (
                      <tr key={i}><td colSpan={6} className="px-5 py-4"><DSSkeleton className="h-6 w-full" /></td></tr>
                    ))
                  ) : dbs.length === 0 ? (
                    <tr><td colSpan={6} className="p-0">
                      <DSEmptyState icon={Database} title="No databases yet" description="Databases appear here once you create projects with a MongoDB database." />
                    </td></tr>
                  ) : (
                    dbs.map((db) => (
                      <tr key={db.project_id} className="ds-transition hover:bg-[var(--ds-hover)]" data-testid={`database-row-${db.slug}`}>
                        <td className="px-5 py-3.5">
                          <div className="flex flex-col gap-1">
                            <span className="font-mono text-[13px] text-[var(--ds-text)]">{db.db_name}</span>
                            <span className="flex items-center gap-2">
                              <Link to={`/projects/${db.project_id}`} className="text-[12px] text-[var(--ds-muted)] hover:text-[var(--ds-primary)]">{db.project_name}</Link>
                              <EnvBadge environment={db.environment} testid={`database-env-${db.slug}`} />
                            </span>
                          </div>
                        </td>
                        <td className="px-5 py-3.5 text-[13px] text-[var(--ds-text-secondary)]">{db.exists ? fmtBytes(db.stats.size_bytes) : "—"}</td>
                        <td className="px-5 py-3.5 text-[13px] text-[var(--ds-text-secondary)]">{db.exists ? db.stats.collections : "—"}</td>
                        <td className="px-5 py-3.5 text-[13px] text-[var(--ds-text-secondary)]">
                          {db.backups_count > 0 ? (
                            <span className="inline-flex items-center gap-1.5"><Archive className="h-3.5 w-3.5 text-[var(--ds-muted)]" />{db.backups_count}</span>
                          ) : "—"}
                        </td>
                        <td className="px-5 py-3.5">
                          <span className={`inline-flex items-center gap-1.5 text-[12px] ${db.exists ? "text-[var(--ds-success)]" : "text-[var(--ds-muted)]"}`}>
                            <span className={`h-1.5 w-1.5 rounded-full ${db.exists ? "bg-[var(--ds-success)]" : "bg-[var(--ds-muted)]"}`} />
                            {db.exists ? "Provisioned" : "Empty"}
                          </span>
                        </td>
                        <td className="px-5 py-3.5">
                          <div className="flex items-center justify-end gap-2">
                            <DSButton variant="outline" size="sm" icon={DatabaseBackup} disabled={toolsMissing || acting} onClick={() => startJob("backup", db)} data-testid={`database-backup-${db.slug}`}>Backup</DSButton>
                            <DSButton variant="ghost" size="sm" icon={Archive} onClick={() => openManage(db)} data-testid={`database-manage-${db.slug}`}>Backups</DSButton>
                          </div>
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </DSCard>
        </div>
      </div>

      {/* Backup / Restore job (streaming, blocking while running) */}
      <DSModal
        open={!!job}
        onOpenChange={(o) => { if (!o) closeJob(); }}
        title={job?.kind === "backup" ? `Backing up ${job?.dbName}` : `Restoring ${job?.dbName}`}
        icon={job?.kind === "backup" ? DatabaseBackup : RotateCcw}
        size="lg"
        bodyClassName="!p-0"
        footer={
          <DSButton variant="outline" data-testid="db-job-close" disabled={!job?.done} onClick={closeJob}>
            {job?.done ? "Close" : `${job?.kind === "backup" ? "Backup" : "Restore"} running…`}
          </DSButton>
        }
      >
        <div data-testid="db-job-progress">
          <LogViewer
            lines={job?.log?.length ? job.log : ["Starting…"]}
            live={!job?.done}
            flush
            downloadable
            filename={`${job?.kind || "job"}.log`}
            title=""
            testid="db-job-log-viewer"
            emptyText="Waiting for output…"
          />
          {job?.done && (
            <div className={`px-4 py-2.5 text-[13px] ${job.rc === 0 || job.rc === null ? "text-[var(--ds-success)]" : "text-[var(--ds-danger)]"}`} data-testid="db-job-result">
              {job.rc === 0 || job.rc === null
                ? `✓ ${job.kind === "backup" ? "Backup" : "Restore"} completed successfully.`
                : `✗ ${job.kind === "backup" ? "Backup" : "Restore"} failed (exit ${job.rc}). Check the log above.`}
            </div>
          )}
        </div>
      </DSModal>

      {/* Manage backups */}
      <DSModal
        open={!!manage}
        onOpenChange={(o) => { if (!o) setManage(null); }}
        title={`Backups — ${manage?.db?.db_name || ""}`}
        icon={HardDrive}
        size="lg"
        data-testid="db-manage-modal"
      >
        {manageLoading ? (
          <div className="space-y-2">{[...Array(3)].map((_, i) => <DSSkeleton key={i} className="h-12 w-full" />)}</div>
        ) : (manage?.backups?.length ? (
          <ul className="space-y-2" data-testid="db-backup-list">
            {manage.backups.map((b) => (
              <li key={b.name} className="flex flex-wrap items-center justify-between gap-3 rounded-[var(--ds-radius-input)] border border-[var(--ds-border)] bg-[var(--ds-page)] p-3">
                <div className="min-w-0">
                  <div className="truncate font-mono text-[12px] text-[var(--ds-text)]">{b.name}</div>
                  <div className="text-[11px] text-[var(--ds-muted)]">{fmtBytes(b.size)} · {fmtDate(b.created)}</div>
                </div>
                <div className="flex items-center gap-1.5">
                  <DSButton variant="outline" size="sm" icon={RotateCcw} disabled={!tools.mongorestore} onClick={() => setRestore({ db: manage.db, file: b.name, drop: false })} data-testid={`db-restore-${b.name}`}>Restore</DSButton>
                  <DSIconButton icon={Download} onClick={() => downloadBackup(manage.db, b.name)} title="Download" data-testid={`db-download-${b.name}`} />
                  <DSIconButton icon={Trash2} onClick={() => deleteBackup(manage.db, b.name)} title="Delete" className="hover:text-[var(--ds-danger)]" data-testid={`db-delete-${b.name}`} />
                </div>
              </li>
            ))}
          </ul>
        ) : (
          <DSEmptyState icon={Archive} title="No backups yet" description="Create a backup from the Databases table to see it here." />
        ))}
        <div className="mt-4 flex justify-end">
          <DSButton variant="primary" size="sm" icon={DatabaseBackup} disabled={toolsMissing || acting} onClick={() => manage && startJob("backup", manage.db)} data-testid="db-manage-backup-now">Backup now</DSButton>
        </div>
      </DSModal>

      {/* Restore confirm */}
      <DSModal
        open={!!restore}
        onOpenChange={(o) => { if (!o) setRestore(null); }}
        title="Restore database"
        icon={RotateCcw}
        size="sm"
        footer={<>
          <DSButton variant="outline" data-testid="db-restore-cancel" onClick={() => setRestore(null)}>Cancel</DSButton>
          <DSButton variant={restore?.drop ? "danger" : "primary"} loading={acting} data-testid="db-restore-confirm"
            onClick={() => restore && startJob("restore", restore.db, { file: restore.file, drop: restore.drop })}>
            Restore
          </DSButton>
        </>}
      >
        <p>
          Restore <span className="font-mono text-[var(--ds-text)]">{restore?.file}</span> into
          {" "}<span className="font-mono text-[var(--ds-text)]">{restore?.db?.db_name}</span>.
        </p>
        <div className="mt-4 rounded-[var(--ds-radius-input)] border border-[var(--ds-border)] bg-[var(--ds-page)] p-3">
          <DSCheckbox
            id="db-restore-drop"
            label="Drop & overwrite — delete existing collections before restoring (clean overwrite)"
            checked={!!restore?.drop}
            onChange={(v) => setRestore((r) => ({ ...r, drop: v }))}
          />
          <p className="mt-2 text-[12px] text-[var(--ds-muted)]">
            {restore?.drop
              ? "⚠ Existing data in matching collections will be removed and replaced."
              : "Default: documents are merged; existing data is kept unless overwritten by matching _id."}
          </p>
        </div>
      </DSModal>
    </Layout>
  );
}
