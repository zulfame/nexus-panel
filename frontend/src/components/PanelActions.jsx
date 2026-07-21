import { useState } from "react";
import { toast } from "sonner";
import { RotateCcw, Wrench, Power, Server, Monitor, CloudUpload, Loader2 } from "lucide-react";
import api, { apiError } from "@/lib/api";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter,
} from "@/components/ui/dialog";
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
  const [busy, setBusy] = useState(false);

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
        onClick={() => setChangelogOpen(true)}
        className="ds-transition mr-1 hidden rounded-[var(--ds-radius-btn)] px-1.5 py-1 font-mono text-[12px] text-[var(--ds-muted)] hover:bg-[var(--ds-hover)] hover:text-[var(--ds-text)] sm:inline"
        title="View change logs"
      >
        v{version || "—"}
      </button>
      <span className="mr-1 hidden h-4 w-px bg-[var(--ds-border)] sm:inline-block" />
      <ActionButton testid="navbar-update-btn" icon={RotateCcw} label="Update" onClick={() => setModal("update")} />
      <ActionButton testid="navbar-fix-btn" icon={Wrench} label="Fix" onClick={() => setModal("fix")} />
      <ActionButton testid="navbar-restart-btn" icon={Power} label="Restart" onClick={() => setModal("restart")} />

      {/* Update */}
      <Dialog open={modal === "update"} onOpenChange={(o) => !o && setModal(null)}>
        <DialogContent className="ds-root max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2"><CloudUpload className="h-5 w-5 text-[var(--ds-primary)]" /> Update panel</DialogTitle>
            <DialogDescription>
              Pull the latest release from source and rebuild the panel. Existing projects are not affected. The panel will restart automatically.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <button data-testid="update-cancel" onClick={() => setModal(null)} className="ds-transition rounded-[var(--ds-radius-btn)] border border-[var(--ds-border)] px-4 py-2 text-[13px] text-[var(--ds-text)] hover:bg-[var(--ds-hover)]">Cancel</button>
            <button data-testid="update-confirm" disabled={busy} onClick={() => run("/ops/update")} className="ds-transition inline-flex items-center gap-2 rounded-[var(--ds-radius-btn)] bg-[var(--ds-primary)] px-4 py-2 text-[13px] font-medium text-white hover:bg-[var(--ds-primary-hover)] disabled:opacity-60">
              {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <RotateCcw className="h-4 w-4" />} Start update
            </button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Fix */}
      <Dialog open={modal === "fix"} onOpenChange={(o) => !o && setModal(null)}>
        <DialogContent className="ds-root max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2"><CloudUpload className="h-5 w-5 text-[var(--ds-primary)]" /> Fix panel</DialogTitle>
            <DialogDescription>
              Repairing the panel resolves various unexpected issues by reinstalling the current release.
              <span className="mt-2 block text-[var(--ds-muted)]">Current version: <span className="font-mono text-[var(--ds-text)]">v{version || "—"}</span></span>
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <button data-testid="fix-cancel" onClick={() => setModal(null)} className="ds-transition rounded-[var(--ds-radius-btn)] border border-[var(--ds-border)] px-4 py-2 text-[13px] text-[var(--ds-text)] hover:bg-[var(--ds-hover)]">Cancel</button>
            <button data-testid="fix-confirm" disabled={busy} onClick={() => run("/ops/fix")} className="ds-transition inline-flex items-center gap-2 rounded-[var(--ds-radius-btn)] bg-[var(--ds-primary)] px-4 py-2 text-[13px] font-medium text-white hover:bg-[var(--ds-primary-hover)] disabled:opacity-60">
              {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Wrench className="h-4 w-4" />} Continue fix
            </button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Restart */}
      <Dialog open={modal === "restart"} onOpenChange={(o) => !o && setModal(null)}>
        <DialogContent className="ds-root max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2"><Power className="h-5 w-5 text-[var(--ds-danger)]" /> Restart server or panel</DialogTitle>
            <DialogDescription>Choose what to restart. This may interrupt running deployments briefly.</DialogDescription>
          </DialogHeader>
          <div className="grid grid-cols-2 gap-3 py-2">
            <button data-testid="restart-server-btn" disabled={busy} onClick={() => run("/ops/restart", { target: "server" })}
              className="ds-transition flex flex-col items-center gap-2 rounded-[var(--ds-radius-card)] border border-[var(--ds-border)] p-5 text-[13px] font-medium text-[var(--ds-text)] hover:border-[var(--ds-danger)]/50 hover:bg-[var(--ds-hover)] disabled:opacity-60">
              <Server className="h-6 w-6 text-[var(--ds-danger)]" strokeWidth={1.5} /> Restart server
            </button>
            <button data-testid="restart-panel-btn" disabled={busy} onClick={() => run("/ops/restart", { target: "panel" })}
              className="ds-transition flex flex-col items-center gap-2 rounded-[var(--ds-radius-card)] border border-[var(--ds-border)] p-5 text-[13px] font-medium text-[var(--ds-text)] hover:border-[var(--ds-primary)]/50 hover:bg-[var(--ds-hover)] disabled:opacity-60">
              <Monitor className="h-6 w-6 text-[var(--ds-primary)]" strokeWidth={1.5} /> Restart panel
            </button>
          </div>
        </DialogContent>
      </Dialog>

      <ChangelogModal open={changelogOpen} onOpenChange={setChangelogOpen} />
    </div>
  );
}
