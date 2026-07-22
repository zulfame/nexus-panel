import { useState, useEffect, useRef } from "react";
import { toast } from "sonner";
import { RotateCcw, Wrench, Power, Server, Monitor, CloudUpload, RefreshCw } from "lucide-react";
import api, { apiError } from "@/lib/api";
import { DSModal, DSButton } from "@/components/ds";
import { LogViewer } from "@/components/LogViewer";
import { ChangelogModal } from "@/components/ChangelogModal";

const PROC = {
  update: {
    start: "/ops/update",
    logPath: "/ops/update-log",
    title: "Updating panel",
    filename: "update.log",
    okText: "✓ Update complete — the panel was rebuilt to the latest version.",
    failText: (rc) => `✗ Update failed (exit ${rc}). The panel was rolled back to the previous release. Review the log above.`,
  },
  fix: {
    start: "/ops/fix",
    logPath: "/ops/repair-log",
    title: "Repairing panel",
    filename: "repair.log",
    okText: "✓ Repair completed — panel rebuilt (version unchanged).",
    failText: (rc) => `✗ Repair failed (exit ${rc}). Check the log above.`,
  },
};

function ActionButton({ testid, icon: Icon, label, onClick, dot, disabled }) {
  return (
    <button
      data-testid={testid}
      onClick={onClick}
      disabled={disabled}
      className="ds-transition relative flex items-center gap-2 rounded-[var(--ds-radius-btn)] border border-[var(--ds-border)] px-3 py-1.5 text-[13px] font-medium text-[var(--ds-text)] hover:border-[var(--ds-primary)]/40 hover:bg-[var(--ds-hover)] disabled:cursor-not-allowed disabled:opacity-40"
    >
      <Icon className="h-4 w-4 text-[var(--ds-muted)]" strokeWidth={1.75} />
      <span className="hidden sm:inline">{label}</span>
      {dot && (
        <span data-testid={`${testid}-dot`} className="absolute -right-0.5 -top-0.5 flex h-2 w-2">
          <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-[var(--ds-primary)] opacity-75" />
          <span className="relative inline-flex h-2 w-2 rounded-full bg-[var(--ds-primary)]" />
        </span>
      )}
    </button>
  );
}

export function PanelActions({ version }) {
  const [modal, setModal] = useState(null); // "update" | "fix" | "restart"
  const [changelogOpen, setChangelogOpen] = useState(false);
  const [unread, setUnread] = useState(false);
  const [updateAvailable, setUpdateAvailable] = useState(false);
  const [updateInfo, setUpdateInfo] = useState(null);
  const [busy, setBusy] = useState(false);
  // Streaming job state (shared by update & fix)
  const [proc, setProc] = useState(null); // { kind, log, done, rc }
  const timer = useRef(null);
  const fails = useRef(0);

  const running = proc && !proc.done; // a system-level job is in progress

  useEffect(() => () => clearInterval(timer.current), []);

  const poll = async (kind) => {
    const cfg = PROC[kind];
    try {
      const { data } = await api.get(cfg.logPath);
      fails.current = 0;
      setProc((p) => (p && p.kind === kind ? { ...p, log: data.log || p.log, done: !!data.done, rc: data.rc } : p));
      if (data.done) clearInterval(timer.current);
    } catch (e) {
      fails.current += 1;
      setProc((p) =>
        p && p.kind === kind
          ? { ...p, log: p.log.includes("panel is restarting") ? p.log : p.log + "\n· panel is restarting, finishing…" }
          : p
      );
      if (fails.current > 40) {
        clearInterval(timer.current);
        setProc((p) => (p && p.kind === kind ? { ...p, done: true } : p));
      }
    }
  };

  const startPolling = (kind) => {
    fails.current = 0;
    clearInterval(timer.current);
    timer.current = setInterval(() => poll(kind), 1500);
    poll(kind);
  };

  const startProc = async (kind) => {
    const cfg = PROC[kind];
    setBusy(true);
    try {
      await api.post(cfg.start, {});
      setBusy(false);
      setProc({ kind, log: `Starting ${kind}…`, done: false, rc: null });
      startPolling(kind);
    } catch (e) {
      setBusy(false);
      toast.error(apiError(e));
    }
  };

  const closeProc = () => {
    clearInterval(timer.current);
    setModal(null);
    setTimeout(() => setProc(null), 200);
  };

  // Resume an in-flight update after a page reload (blocking — no intervention allowed).
  useEffect(() => {
    api.get(PROC.update.logPath)
      .then(({ data }) => {
        if (data?.exists && data?.running) {
          setProc({ kind: "update", log: data.log || "Updating…", done: false, rc: data.rc });
          setModal("update");
          startPolling("update");
        }
      })
      .catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!version) return;
    const seen = localStorage.getItem("nexus-changelog-seen");
    setUnread(seen !== version);
  }, [version]);

  useEffect(() => {
    api.get("/system/panel-updates")
      .then(({ data }) => { setUpdateAvailable(!!data?.available); setUpdateInfo(data || null); })
      .catch(() => {});
  }, []);

  const openChangelog = () => {
    setChangelogOpen(true);
    if (version) localStorage.setItem("nexus-changelog-seen", version);
    setUnread(false);
  };

  const run = async (path, body) => {
    setBusy(true);
    try {
      const { data } = await api.post(path, body || {});
      toast.success(data?.message || "Done");
      setModal(null);
    } catch (e) {
      toast.error(apiError(e));
    } finally {
      setBusy(false);
    }
  };

  const ProgressView = ({ kind }) => {
    const cfg = PROC[kind];
    return (
      <div data-testid={`${kind}-progress`}>
        <LogViewer
          lines={(proc?.log || "").split("\n")}
          live={!proc?.done}
          flush
          downloadable
          filename={cfg.filename}
          title=""
          testid={`${kind}-log-viewer`}
          emptyText={`Waiting for ${kind} output…`}
        />
        {proc?.done && (
          <div
            className={`flex items-center justify-between gap-3 px-4 py-2.5 text-[13px] ${proc.rc === 0 || proc.rc === null ? "text-[var(--ds-success)]" : "text-[var(--ds-danger)]"}`}
            data-testid={`${kind}-result`}
          >
            <span>{proc.rc === 0 || proc.rc === null ? cfg.okText : cfg.failText(proc.rc)}</span>
          </div>
        )}
        {!proc?.done && (
          <p className="px-4 py-2.5 text-[12px] text-[var(--ds-muted)]">
            Keep this window open — the panel is working. It will restart automatically; this view resumes on its own.
          </p>
        )}
      </div>
    );
  };

  return (
    <div className="flex items-center gap-2" data-testid="panel-actions">
      <button
        data-testid="panel-version"
        onClick={openChangelog}
        className="ds-transition relative mr-1 hidden rounded-[var(--ds-radius-btn)] px-1.5 py-1 font-mono text-[12px] text-[var(--ds-muted)] hover:bg-[var(--ds-hover)] hover:text-[var(--ds-text)] sm:inline-flex sm:items-center"
        title={unread ? "New release — view change logs" : "View change logs"}
      >
        v{version || "—"}
        {unread && (
          <span data-testid="changelog-unread-dot" className="absolute -right-0.5 -top-0.5 flex h-2 w-2">
            <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-[var(--ds-success)] opacity-75" />
            <span className="relative inline-flex h-2 w-2 rounded-full bg-[var(--ds-success)]" />
          </span>
        )}
      </button>
      <span className="mr-1 hidden h-4 w-px bg-[var(--ds-border)] sm:inline-block" />
      <ActionButton testid="navbar-update-btn" icon={RotateCcw} label="Update" dot={updateAvailable} disabled={running} onClick={() => setModal("update")} />
      <ActionButton testid="navbar-fix-btn" icon={Wrench} label="Fix" disabled={running} onClick={() => setModal("fix")} />
      <ActionButton testid="navbar-restart-btn" icon={Power} label="Restart" disabled={running} onClick={() => setModal("restart")} />

      {/* Update */}
      <DSModal
        open={modal === "update"}
        onOpenChange={(o) => { if (!o && !(proc?.kind === "update" && !proc.done)) closeProc(); }}
        title={proc?.kind === "update" ? PROC.update.title : "Update panel"}
        icon={CloudUpload}
        size={proc?.kind === "update" ? "lg" : "sm"}
        bodyClassName={proc?.kind === "update" ? "!p-0" : ""}
        footer={proc?.kind === "update" ? (
          proc.done ? (
            <>
              <DSButton variant="outline" data-testid="update-close" onClick={closeProc}>Close</DSButton>
              {(proc.rc === 0 || proc.rc === null) && (
                <DSButton variant="primary" icon={RefreshCw} data-testid="update-reload" onClick={() => window.location.reload()}>Reload panel</DSButton>
              )}
            </>
          ) : (
            <DSButton variant="outline" data-testid="update-running" disabled>Update running…</DSButton>
          )
        ) : (
          <>
            <DSButton variant="outline" data-testid="update-cancel" onClick={() => setModal(null)}>Close</DSButton>
            <DSButton variant="primary" data-testid="update-confirm" loading={busy} onClick={() => startProc("update")}>Start update</DSButton>
          </>
        )}
      >
        {proc?.kind === "update" ? (
          <ProgressView kind="update" />
        ) : (
          <>
            Pull the latest release from source and rebuild the panel. Existing projects are not affected. The panel will restart automatically — <span className="text-[var(--ds-text)]">do not close this window</span> once the update starts.
            {updateInfo?.available ? (
              <div className="mt-4" data-testid="update-commits">
                <div className="mb-2 flex items-center gap-2 text-[12px] font-medium text-[var(--ds-text)]">
                  <span className="rounded-full bg-[var(--ds-primary)]/15 px-2 py-0.5 text-[11px] text-[var(--ds-primary)]">{updateInfo.behind} new commit{updateInfo.behind === 1 ? "" : "s"}</span>
                  <span className="font-mono text-[var(--ds-muted)]">{updateInfo.current} → {updateInfo.remote}</span>
                </div>
                <ul className="max-h-44 space-y-1.5 overflow-y-auto rounded-[var(--ds-radius-input)] border border-[var(--ds-border)] bg-[var(--ds-page)] p-3">
                  {(updateInfo.commits || []).map((c) => (
                    <li key={c.sha} className="flex items-start gap-2 text-[12px] leading-relaxed">
                      <span className="mt-px shrink-0 font-mono text-[var(--ds-primary)]">{c.sha}</span>
                      <span className="min-w-0 flex-1 text-[var(--ds-text-secondary)]">{c.subject}</span>
                      <span className="shrink-0 text-[11px] text-[var(--ds-muted)]">{c.when}</span>
                    </li>
                  ))}
                </ul>
              </div>
            ) : (
              <span className="mt-3 block text-[12px] text-[var(--ds-success)]">You're on the latest version{updateInfo?.current ? ` (${updateInfo.current})` : ""}.</span>
            )}
          </>
        )}
      </DSModal>

      {/* Fix */}
      <DSModal
        open={modal === "fix"}
        onOpenChange={(o) => { if (!o && !(proc?.kind === "fix" && !proc.done)) closeProc(); }}
        title={proc?.kind === "fix" ? PROC.fix.title : "Fix panel"}
        icon={Wrench}
        size={proc?.kind === "fix" ? "lg" : "sm"}
        bodyClassName={proc?.kind === "fix" ? "!p-0" : ""}
        footer={proc?.kind === "fix" ? (
          <DSButton variant="outline" data-testid="fix-close" disabled={!proc.done} onClick={closeProc}>
            {proc.done ? "Close" : "Repair running…"}
          </DSButton>
        ) : (
          <>
            <DSButton variant="outline" data-testid="fix-cancel" onClick={() => setModal(null)}>Close</DSButton>
            <DSButton variant="primary" data-testid="fix-confirm" loading={busy} onClick={() => startProc("fix")}>Continue fix</DSButton>
          </>
        )}
      >
        {proc?.kind === "fix" ? (
          <ProgressView kind="fix" />
        ) : (
          <>
            Repairing rebuilds the currently active release in place — reinstalls backend &amp; frontend dependencies and recompiles the UI, then runs a health check. Your version does not change. Progress will stream below.
            <span className="mt-2 block text-[var(--ds-muted)]">Current version: <span className="font-mono text-[var(--ds-text)]">v{version || "—"}</span></span>
          </>
        )}
      </DSModal>

      {/* Restart */}
      <DSModal
        open={modal === "restart"} onOpenChange={(o) => !o && setModal(null)}
        title="Restart server or panel" icon={Power} size="sm"
        description="Choose what to restart. This may interrupt running deployments briefly."
      >
        <div className="grid grid-cols-2 gap-3">
          <button data-testid="restart-server-btn" disabled={busy} onClick={() => run("/ops/restart", { target: "server" })}
            className="ds-transition flex flex-col items-center gap-2 rounded-[var(--ds-radius-card)] border border-[var(--ds-border)] p-5 text-[13px] font-medium text-[var(--ds-text)] hover:border-[var(--ds-danger)]/50 hover:bg-[var(--ds-hover)] disabled:opacity-60">
            <Server className="h-6 w-6 text-[var(--ds-danger)]" strokeWidth={1.5} /> Restart server
          </button>
          <button data-testid="restart-panel-btn" disabled={busy} onClick={() => run("/ops/restart", { target: "panel" })}
            className="ds-transition flex flex-col items-center gap-2 rounded-[var(--ds-radius-card)] border border-[var(--ds-border)] p-5 text-[13px] font-medium text-[var(--ds-text)] hover:border-[var(--ds-primary)]/50 hover:bg-[var(--ds-hover)] disabled:opacity-60">
            <Monitor className="h-6 w-6 text-[var(--ds-primary)]" strokeWidth={1.5} /> Restart panel
          </button>
        </div>
      </DSModal>

      <ChangelogModal open={changelogOpen} onOpenChange={setChangelogOpen} />
    </div>
  );
}
