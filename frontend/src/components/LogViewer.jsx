import { useEffect, useRef } from "react";

const STREAM_COLORS = {
  info: "#8AB4F8",
  error: "#FF6B60",
  success: "#00E676",
  stderr: "#FFB74D",
  stdout: "#D4D4D4",
};

export function LogViewer({ lines = [], emptyText = "No output yet.", testid = "log-viewer" }) {
  const endRef = useRef(null);
  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [lines]);

  return (
    <div
      data-testid={testid}
      className="h-[420px] overflow-y-auto border border-border bg-black p-4 font-mono text-xs leading-relaxed"
    >
      {lines.length === 0 ? (
        <div className="text-muted-foreground">{emptyText}</div>
      ) : (
        lines.map((l, i) => {
          const text = typeof l === "string" ? l : l.text;
          const stream = typeof l === "string" ? "stdout" : l.stream;
          return (
            <div key={i} className="whitespace-pre-wrap break-all">
              <span className="mr-2 select-none text-[#3a3a3a]">
                {String(i + 1).padStart(3, "0")}
              </span>
              <span style={{ color: STREAM_COLORS[stream] || "#D4D4D4" }}>{text}</span>
            </div>
          );
        })
      )}
      <div ref={endRef} />
    </div>
  );
}
