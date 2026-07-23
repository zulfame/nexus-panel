import { DSPanel } from "@/components/ds";
import { LogViewer } from "@/components/LogViewer";
import { Terminal } from "lucide-react";
import { useProjectCtx } from "./context";

export function LogsTab() {
  const { wsConnected, liveStatus, wsLines, p } = useProjectCtx();
  return (
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
  );
}
