import { useState, useEffect } from "react";
import { toast } from "sonner";
import { RotateCcw, Wrench, Power, Server, Monitor, CloudUpload, Loader2 } from "lucide-react";
import api, { apiError } from "@/lib/api";
import { DSModal, DSButton } from "@/components/ds";
import { ChangelogModal } from "@/components/ChangelogModal";

function ActionButton({ testid, icon: Icon, label, onClick }) {
  return (
    <button
      data-testid={testid}
      onClick={onClick}
      className="ds-transition flex items-center gap-2 rounded-[var(--ds-radius-btn)] border border-[var(--ds-border)] px-3 py-1.5 text-[13px] font-medium text-[var(--ds-text)] hover:border-[var(--ds-primary)]/40 hover:bg-[var(--ds-hover)]"
    >
      <Icon className="h-4 w-4 text-[var(--ds-muted)]" strokeWidth={1.75} />
      <span className="hidden sm:inline">{label}</span>
    </button>
  );
}

export function PanelActions({ version }) {
  const [modal, setModal] = useState(null); // "update" | "fix" | "restart"
  const [changelogOpen, setChangelogOpen] = useState(false);
  const [unread, setUnread] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!version) return;
    const seen = localStorage.getItem("nexus-changelog-seen");
    setUnread(seen !== version);
  }, [version]);

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
      <ActionButton testid="navbar-update-btn" icon={RotateCcw} label="Update" onClick={() => setModal("update")} />
      <ActionButton testid="navbar-fix-btn" icon={Wrench} label="Fix" onClick={() => setModal("fix")} />
      <ActionButton testid="navbar-restart-btn" icon={Power} label="Restart" onClick={() => setModal("restart")} />

      {/* Update */}
      <DSModal
        open={modal === "update"} onOpenChange={(o) => !o && setModal(null)}
        title="Update panel" icon={CloudUpload} size="sm"
        footer={<>
          <DSButton variant="outline" data-testid="update-cancel" onClick={() => setModal(null)}>Close</DSButton>
          <DSButton variant="primary" data-testid="update-confirm" loading={busy} icon={busy ? undefined : RotateCcw} onClick={() => run("/ops/update")}>Start update</DSButton>
        </>}
      >
        Pull the latest release from source and rebuild the panel. Existing projects are not affected. The panel will restart automatically.
      </DSModal>

      {/* Fix */}
      <DSModal
        open={modal === "fix"} onOpenChange={(o) => !o && setModal(null)}
        title="Fix panel" icon={CloudUpload} size="sm"
        footer={<>
          <DSButton variant="outline" data-testid="fix-cancel" onClick={() => setModal(null)}>Close</DSButton>
          <DSButton variant="primary" data-testid="fix-confirm" loading={busy} icon={busy ? undefined : Wrench} onClick={() => run("/ops/fix")}>Continue fix</DSButton>
        </>}
      >
        Repairing the panel resolves various unexpected issues by reinstalling the current release.
        <span className="mt-2 block text-[var(--ds-muted)]">Current version: <span className="font-mono text-[var(--ds-text)]">v{version || "—"}</span></span>
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
