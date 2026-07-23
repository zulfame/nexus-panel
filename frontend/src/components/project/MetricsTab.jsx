import { DSPanel } from "@/components/ds";
import { MetricsChart } from "@/components/MetricsChart";
import { TrendingUp } from "lucide-react";
import { useProjectCtx } from "./context";

export function MetricsTab() {
  const { id } = useProjectCtx();
  return (
    <DSPanel title={<span className="flex items-center gap-2"><TrendingUp className="h-4 w-4 text-[var(--ds-primary)]" /> Resource Metrics</span>}>
      <MetricsChart projectId={id} />
    </DSPanel>
  );
}
