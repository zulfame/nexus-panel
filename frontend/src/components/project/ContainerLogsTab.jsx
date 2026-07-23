import { Button } from "@/components/ui/button";
import { DSPanel } from "@/components/ds";
import { LogViewer } from "@/components/LogViewer";
import { Terminal, Radio, RefreshCw } from "lucide-react";
import { useProjectCtx } from "./context";

export function ContainerLogsTab() {
  const { liveContainer, toggleLiveContainer, loadContainerLogs, containerLogs, p } = useProjectCtx();
  return (
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
  );
}
