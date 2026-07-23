import { Button } from "@/components/ui/button";
import { DSPanel } from "@/components/ds";
import { DeployTimeline } from "@/components/DeployTimeline";
import { TrendingUp, History, RefreshCw, FileDiff, RotateCcw } from "lucide-react";
import { useProjectCtx } from "./context";

export function HistoryTab() {
  const { history, loadHistory, upd, busy, openDiff, setRollbackTarget } = useProjectCtx();

  return (
    <div className="space-y-5">
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
    </div>
  );
}
