import { forwardRef, useEffect, useImperativeHandle, useRef } from "react";
import { Terminal as XTerm } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import "@xterm/xterm/css/xterm.css";

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
    termRef.current = term;
    fitRef.current = fit;

    let started = false;
    let disposed = false;
    let onDataDisp = null;

    const hasSize = () => {
      const el = containerRef.current;
      return !!el && el.offsetWidth > 0 && el.offsetHeight > 0;
    };

    const sendResize = () => {
      const ws = wsRef.current;
      if (ws && ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ type: "resize", cols: term.cols, rows: term.rows }));
      }
    };

    const write = (data) => {
      if (!disposed && started) term.write(data);
    };

    const connect = () => {
      const token = localStorage.getItem("panel_token");
      const wsBase = (process.env.REACT_APP_BACKEND_URL || "").replace(/^http/, "ws");
      const path =
        session.type === "ssh"
          ? `/api/ws/terminal/ssh/${session.serverId}`
          : `/api/ws/terminal/local`;
      const ws = new WebSocket(`${wsBase}${path}?token=${token}`);
      ws.binaryType = "arraybuffer";
      wsRef.current = ws;

      ws.onopen = () => {
        onStatus?.("connected");
        if (hasSize()) { try { fit.fit(); } catch (e) {} }
        sendResize();
        term.focus();
      };
      ws.onmessage = (e) => {
        if (typeof e.data === "string") write(e.data);
        else write(new Uint8Array(e.data));
      };
      ws.onclose = () => {
        onStatus?.("disconnected");
        write("\r\n\x1b[90m[session closed]\x1b[0m\r\n");
      };
      ws.onerror = () => onStatus?.("error");

      onDataDisp = term.onData((d) => {
        if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ type: "input", data: d }));
      });
    };

    // Only open the terminal once its container actually has dimensions,
    // otherwise xterm's renderer throws "reading 'dimensions'" on the first write.
    const tryStart = () => {
      if (started || disposed || !hasSize()) return;
      started = true;
      term.open(containerRef.current);
      try { fit.fit(); } catch (e) {}
      connect();
    };

    const refit = () => {
      if (started && hasSize()) {
        try { fit.fit(); sendResize(); } catch (e) {}
      }
    };

    let roScheduled = false;
    const ro = new ResizeObserver(() => {
      // Coalesce into a single rAF to avoid the benign "ResizeObserver loop" warning,
      // which is amplified when two terminals refit at once in split mode.
      if (roScheduled) return;
      roScheduled = true;
      requestAnimationFrame(() => {
        roScheduled = false;
        if (!started) tryStart();
        else refit();
      });
    });
    ro.observe(containerRef.current);
    requestAnimationFrame(tryStart);

    fitRef.current.tryStart = tryStart;
    fitRef.current.refit = refit;

    return () => {
      disposed = true;
      onDataDisp?.dispose?.();
      ro.disconnect();
      try { wsRef.current?.close(); } catch (e) {}
      term.dispose();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // when this tab becomes active, start (if it was hidden at mount) and refit
  useEffect(() => {
    if (active && fitRef.current) {
      setTimeout(() => {
        fitRef.current?.tryStart?.();
        fitRef.current?.refit?.();
        termRef.current?.focus();
      }, 60);
    }
  }, [active]);

  return <div ref={containerRef} data-testid="xterm-container" className="h-full w-full" />;
});
