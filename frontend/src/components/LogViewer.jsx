import { useEffect, useRef, useState } from "react";
import { Search, Download, X } from "lucide-react";
import { cn } from "@/lib/utils";

const STREAM_COLORS = {
  info: "text-blue-400",
  error: "text-red-400",
  success: "text-emerald-400",
  stderr: "text-amber-400",
  stdout: "text-zinc-300",
};

const lineText = (l) => (typeof l === "string" ? l : l.text);
const lineStream = (l) => (typeof l === "string" ? "stdout" : l.stream);

export function LogViewer({
  lines = [],
  emptyText = "No output yet.",
  testid = "log-viewer",
  title = "output",
  live = false,
  filterable = false,
  downloadable = false,
  filename = "logs.txt",
}) {
  const endRef = useRef(null);
  const [query, setQuery] = useState("");

  const filtered = query
    ? lines.filter((l) => lineText(l).toLowerCase().includes(query.toLowerCase()))
    : lines;

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [filtered.length]);

  const download = () => {
    const text = lines.map(lineText).join("\n");
    const blob = new Blob([text], { type: "text/plain" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  return (
    <div className="flex flex-col overflow-hidden rounded-sm border border-border bg-[#050505] shadow-inner">
      {/* terminal chrome */}
      <div className="flex h-11 items-center justify-between gap-3 border-b border-border bg-[#0a0a0a] px-4">
        <div className="flex shrink-0 items-center gap-2">
          <span className="h-2.5 w-2.5 rounded-full bg-[#EF4444]/70" />
          <span className="h-2.5 w-2.5 rounded-full bg-[#F59E0B]/70" />
          <span className="h-2.5 w-2.5 rounded-full bg-[#10B981]/70" />
          <span className="ml-3 hidden text-[11px] text-muted-foreground sm:inline">{title}</span>
        </div>

        <div className="flex flex-1 items-center justify-end gap-2">
          {filterable && (
            <div className="relative w-full max-w-[220px]">
              <Search className="pointer-events-none absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
              <input
                data-testid={`${testid}-search`}
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="filter…"
                className="h-7 w-full border border-white/15 bg-transparent pl-7 pr-6 font-mono text-[11px] text-zinc-200 placeholder:text-muted-foreground/60 focus:border-white/40 focus:outline-none"
              />
              {query && (
                <button
                  data-testid={`${testid}-clear-search`}
                  onClick={() => setQuery("")}
                  className="absolute right-1.5 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-zinc-200"
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              )}
            </div>
          )}
          {downloadable && (
            <button
              data-testid={`${testid}-download`}
              onClick={download}
              disabled={lines.length === 0}
              title="Download logs"
              className="flex h-7 items-center gap-1.5 border border-white/15 bg-transparent px-2 font-mono text-[11px] text-zinc-300 hover:border-white/40 disabled:opacity-40"
            >
              <Download className="h-3.5 w-3.5" /> <span className="hidden sm:inline">download</span>
            </button>
          )}
          {live && (
            <span className="flex shrink-0 items-center gap-1.5 text-[10px] uppercase tracking-wider text-emerald-400">
              <span className="relative flex h-1.5 w-1.5">
                <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-500 opacity-75" />
                <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-emerald-500" />
              </span>
              live
            </span>
          )}
        </div>
      </div>

      <div
        data-testid={testid}
        className="max-h-[460px] min-h-[300px] overflow-y-auto p-4 text-[11px] leading-relaxed sm:text-xs"
      >
        {filtered.length === 0 ? (
          <div className="text-muted-foreground/60">{query ? `No lines match "${query}".` : emptyText}</div>
        ) : (
          filtered.map((l, i) => (
            <div key={i} className="flex hover:bg-white/[0.03]">
              <span className="mr-3 w-8 shrink-0 select-none border-r border-white/5 pr-3 text-right text-muted-foreground/30 tabular-nums">
                {i + 1}
              </span>
              <span className={cn("break-all", STREAM_COLORS[lineStream(l)] || "text-zinc-300")}>{lineText(l)}</span>
            </div>
          ))
        )}
        <div ref={endRef} />
      </div>
    </div>
  );
}
