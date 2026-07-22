import { useState, useEffect, useRef } from "react";
import { toast } from "sonner";
import { RotateCcw, Wrench, Power, Server, Monitor, CloudUpload, Loader2 } from "lucide-react";
import api, { apiError } from "@/lib/api";
import { DSModal, DSButton } from "@/components/ds";
import { LogViewer } from "@/components/LogViewer";
import { ChangelogModal } from "@/components/ChangelogModal";

function ActionButton({ testid, icon: Icon, label, onClick, dot }) {
  return (
    <button
      data-testid={testid}
      onClick={onClick}
      className="ds-transition relative flex items-center gap-2 rounded-[var(--ds-radius-btn)] border border-[var(--ds-border)] px-3 py-1.5 text-[13px] font-medium text-[var(--ds-text)] hover:border-[var(--ds-primary)]/40 hover:bg-[var(--ds-hover)]"
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
  const [repairing, setRepairing] = useState(false);
  const [repairLog, setRepairLog] = useState("");
  const [repairDone, setRepairDone] = useState(false);
  const [repairRc, setRepairRc] = useState(null);
  const repairTimer = useRef(null);
  const repairFails = useRef(0);

  useEffect(() => () => clearInterval(repairTimer.current), []);

  const pollRepair = async () => {
    try {
      const { data } = await api.get("/ops/repair-log");
      repairFails.current = 0;
      if (data.log) setRepairLog(data.log);
      if (data.done) {
        setRepairDone(true);
        setRepairRc(data.rc);
        clearInterval(repairTimer.current);
      }
    } catch (e) {
      repairFails.current += 1;
      setRepairLog((l) => l.includes("panel is restarting") ? l : l + "\n· panel is restarting, finishing repair…");
      if (repairFails.current > 25) { clearInterval(repairTimer.current); setRepairDone(true); }
    }
  };

  const startRepair = async () => {
    setBusy(true);
    try {
      await api.post("/ops/fix", {});
      setBusy(false);
      setRepairing(true);
      setRepairDone(false);
      setRepairRc(null);
      setRepairLog("Starting repair…");
      repairFails.current = 0;
      clearInterval(repairTimer.current);
      repairTimer.current = setInterval(pollRepair, 1500);
      pollRepair();
    } catch (e) {
      setBusy(false);
      toast.error(apiError(e));
    }
  };

  const closeFix = () => {
    clearInterval(repairTimer.current);
    setModal(null);
    setTimeout(() => { setRepairing(false); setRepairLog(""); setRepairDone(false); setRepairRc(null); }, 200);
  };

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
      <ActionButton testid="navbar-update-btn" icon={RotateCcw} label="Update" dot={updateAvailable} onClick={() => setModal("update")} />
      <ActionButton testid="navbar-fix-btn" icon={Wrench} label="Fix" onClick={() => setModal("fix")} />
      <ActionButton testid="navbar-restart-btn" icon={Power} label="Restart" onClick={() => setModal("restart")} />

      {/* Update */}
      <DSModal
        open={modal === "update"} onOpenChange={(o) => !o && setModal(null)}
        title="Update panel" icon={CloudUpload} size="sm"
        footer={<>
          <DSButton variant="outline" data-testid="update-cancel" onClick={() => setModal(null)}>Close</DSButton>
          <DSButton variant="primary" data-testid="update-confirm" loading={busy} onClick={() => run("/ops/update")}>Start update</DSButton>
        </>}
      >
        Pull the latest release from source and rebuild the panel. Existing projects are not affected. The panel will restart automatically.
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
      </DSModal>

      {/* Fix */}
      <DSModal
        open={modal === "fix"} onOpenChange={(o) => !o && closeFix()}
        title={repairing ? "Repairing panel" : "Fix panel"} icon={CloudUpload} size={repairing ? "lg" : "sm"}
        footer={repairing ? (
          <DSButton variant="outline" data-testid="fix-close" disabled={!repairDone} onClick={closeFix}>
            {repairDone ? "Close" : "Repair running…"}
          </DSButton>
        ) : (<>
          <DSButton variant="outline" data-testid="fix-cancel" onClick={closeFix}>Close</DSButton>
          <DSButton variant="primary" data-testid="fix-confirm" loading={busy} onClick={startRepair}>Continue fix</DSButton>
        </>)}
        bodyClassName={repairing ? "!p-0" : ""}
      >
        {repairing ? (
          <div data-testid="repair-progress">
            <LogViewer
              lines={repairLog.split("\n")}
              live={!repairDone}
              flush
              filterable={false}
              downloadable
              filename="repair.log"
              title=""
              testid="repair-log-viewer"
              emptyText="Waiting for repair output…"
            />
            {repairDone && (
              <div className={`px-4 py-2.5 text-[13px] ${repairRc === 0 || repairRc === null ? "text-[var(--ds-success)]" : "text-[var(--ds-danger)]"}`} data-testid="repair-result">
                {repairRc === 0 || repairRc === null ? "✓ Repair completed — panel rebuilt (version unchanged)." : `✗ Repair failed (exit ${repairRc}). Check the log above.`}
              </div>
            )}
          </div>
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
