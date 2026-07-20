import { forwardRef, useEffect, useImperativeHandle, useRef } from "react";
import { Terminal as XTerm } from "xterm";
import { FitAddon } from "xterm-addon-fit";
import "xterm/css/xterm.css";

const THEME = {
  background: "#050505",
  foreground: "#d4d4d4",
  cursor: "#10B981",
  selectionBackground: "#264f78",
  black: "#000000",
  green: "#10B981",
  brightGreen: "#34d399",
  red: "#EF4444",
  yellow: "#F59E0B",
  blue: "#3B82F6",
  cyan: "#22d3ee",
  white: "#e5e5e5",
};

/**
 * A single xterm terminal bound to a WebSocket PTY/SSH session.
 * props: session = { type: "local" } | { type: "ssh", serverId }, active (bool), onStatus(fn)
 * ref methods: sendText(text), runCommand(cmd), focus()
 */
export const TerminalView = forwardRef(function TerminalView({ session, active, onStatus }, ref) {
  const containerRef = useRef(null);
  const termRef = useRef(null);
  const fitRef = useRef(null);
  const wsRef = useRef(null);

  useImperativeHandle(ref, () => ({
    sendText: (text) => {
      if (wsRef.current?.readyState === WebSocket.OPEN) {
        wsRef.current.send(JSON.stringify({ type: "input", data: text }));
      }
    },
    runCommand: (cmd) => {
      if (wsRef.current?.readyState === WebSocket.OPEN) {
        wsRef.current.send(JSON.stringify({ type: "input", data: cmd + "\n" }));
      }
    },
    focus: () => termRef.current?.focus(),
  }));

  useEffect(() => {
    const term = new XTerm({
      cursorBlink: true,
      fontFamily: '"JetBrains Mono", ui-monospace, monospace',
      fontSize: 13,
      theme: THEME,
      scrollback: 5000,
    });
    const fit = new FitAddon();
    term.loadAddon(fit);
    term.open(containerRef.current);
    termRef.current = term;
    fitRef.current = fit;

    const safeFit = () => {
      const el = containerRef.current;
      if (!el || el.offsetWidth === 0 || el.offsetHeight === 0) return false;
      try {
        fit.fit();
        return true;
      } catch (e) {
        return false;
      }
    };
    safeFit();

    const token = localStorage.getItem("panel_token");
    const wsBase = (process.env.REACT_APP_BACKEND_URL || "").replace(/^http/, "ws");
    const path =
      session.type === "ssh"
        ? `/api/ws/terminal/ssh/${session.serverId}`
        : `/api/ws/terminal/local`;
    const ws = new WebSocket(`${wsBase}${path}?token=${token}`);
    ws.binaryType = "arraybuffer";
    wsRef.current = ws;

    const sendResize = () => {
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ type: "resize", cols: term.cols, rows: term.rows }));
      }
    };

    ws.onopen = () => {
      onStatus?.("connected");
      safeFit();
      sendResize();
      term.focus();
    };
    ws.onmessage = (e) => {
      if (typeof e.data === "string") term.write(e.data);
      else term.write(new Uint8Array(e.data));
    };
    ws.onclose = () => {
      onStatus?.("disconnected");
      term.write("\r\n\x1b[90m[session closed]\x1b[0m\r\n");
    };
    ws.onerror = () => onStatus?.("error");

    const onData = term.onData((d) => {
      if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ type: "input", data: d }));
    });

    const ro = new ResizeObserver(() => {
      if (safeFit()) sendResize();
    });
    ro.observe(containerRef.current);
    fitRef.current.safeFit = safeFit;

    return () => {
      onData.dispose();
      ro.disconnect();
      try { ws.close(); } catch (e) {}
      term.dispose();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // refit when this tab becomes active (container was hidden before)
  useEffect(() => {
    if (active && fitRef.current) {
      setTimeout(() => {
        if (!termRef.current || !fitRef.current) return;
        const ok = fitRef.current.safeFit ? fitRef.current.safeFit() : false;
        const ws = wsRef.current;
        if (ok && ws?.readyState === WebSocket.OPEN) {
          ws.send(JSON.stringify({ type: "resize", cols: termRef.current.cols, rows: termRef.current.rows }));
        }
        termRef.current?.focus();
      }, 60);
    }
  }, [active]);

  return <div ref={containerRef} data-testid="xterm-container" className="h-full w-full" />;
});
