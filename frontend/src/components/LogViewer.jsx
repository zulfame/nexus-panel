import { useEffect, useRef } from "react";
import { cn } from "@/lib/utils";

const STREAM_COLORS = {
  info: "text-blue-400",
  error: "text-red-400",
  success: "text-emerald-400",
  stderr: "text-amber-400",
  stdout: "text-zinc-300",
};

export function LogViewer({
  lines = [],
  emptyText = "No output yet.",
  testid = "log-viewer",
  title = "output",
  live = false,
}) {
  const endRef = useRef(null);
  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [lines]);

  return (
    <div className="flex flex-col overflow-hidden rounded-sm border border-border bg-[#050505] shadow-inner">
      {/* terminal chrome */}
      <div className="flex h-10 items-center justify-between border-b border-border bg-[#0a0a0a] px-4">
        <div className="flex items-center gap-2">
          <span className="h-2.5 w-2.5 rounded-full bg-[#EF4444]/70" />
          <span className="h-2.5 w-2.5 rounded-full bg-[#F59E0B]/70" />
          <span className="h-2.5 w-2.5 rounded-full bg-[#10B981]/70" />
          <span className="ml-3 text-[11px] text-muted-foreground">{title}</span>
        </div>
        {live && (
          <span className="flex items-center gap-1.5 text-[10px] uppercase tracking-wider text-emerald-400">
            <span className="relative flex h-1.5 w-1.5">
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-500 opacity-75" />
              <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-emerald-500" />
            </span>
            live
          </span>
        )}
      </div>

      <div
        data-testid={testid}
        className="max-h-[460px] min-h-[300px] overflow-y-auto p-4 text-[11px] leading-relaxed sm:text-xs"
      >
        {lines.length === 0 ? (
          <div className="text-muted-foreground/60">{emptyText}</div>
        ) : (
          lines.map((l, i) => {
            const text = typeof l === "string" ? l : l.text;
            const stream = typeof l === "string" ? "stdout" : l.stream;
            return (
              <div key={i} className="flex hover:bg-white/[0.03]">
                <span className="mr-3 w-8 shrink-0 select-none border-r border-white/5 pr-3 text-right text-muted-foreground/30 tabular-nums">
                  {i + 1}
                </span>
                <span className={cn("break-all", STREAM_COLORS[stream] || "text-zinc-300")}>{text}</span>
              </div>
            );
          })
        )}
        <div ref={endRef} />
      </div>
    </div>
  );
}
