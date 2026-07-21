import { forwardRef, useEffect, useImperativeHandle, useRef } from "react";
import { Terminal as XTerm } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import "@xterm/xterm/css/xterm.css";

export const TERMINAL_THEMES = {
  default: {
    label: "JetBrains Dark", background: "#050505", foreground: "#d4d4d4", cursor: "#10B981",
    selectionBackground: "#264f78", black: "#000000", green: "#10B981", brightGreen: "#34d399",
    red: "#EF4444", yellow: "#F59E0B", blue: "#3B82F6", cyan: "#22d3ee", white: "#e5e5e5",
  },
  dracula: {
    label: "Dracula", background: "#282a36", foreground: "#f8f8f2", cursor: "#f8f8f0",
    selectionBackground: "#44475a", black: "#21222c", green: "#50fa7b", brightGreen: "#69ff94",
    red: "#ff5555", yellow: "#f1fa8c", blue: "#bd93f9", magenta: "#ff79c6", cyan: "#8be9fd", white: "#f8f8f2",
  },
  solarized: {
    label: "Solarized Dark", background: "#002b36", foreground: "#93a1a1", cursor: "#93a1a1",
    selectionBackground: "#073642", black: "#073642", green: "#859900", brightGreen: "#93a1a1",
    red: "#dc322f", yellow: "#b58900", blue: "#268bd2", magenta: "#d33682", cyan: "#2aa198", white: "#eee8d5",
  },
};
const THEME = TERMINAL_THEMES.default;

/**
 * A single xterm terminal bound to a WebSocket PTY/SSH session.
 * props: session, active, onStatus, themeKey ("default"|"dracula"|"solarized"), fontSize
 * ref methods: sendText(text), runCommand(cmd), focus()
 */
export const TerminalView = forwardRef(function TerminalView({ session, active, onStatus, themeKey = "default", fontSize = 13 }, ref) {
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
      fontSize,
      theme: TERMINAL_THEMES[themeKey] || THEME,
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
      // xterm caches glyph widths from the fallback font if it renders before
      // "JetBrains Mono" finishes loading. Re-measure once the web font is ready.
      if (document.fonts && document.fonts.load) {
        document.fonts.load('13px "JetBrains Mono"').then(() => {
          if (disposed) return;
          try {
            term.options.fontFamily = "monospace";
            term.options.fontFamily = '"JetBrains Mono", ui-monospace, monospace';
            fit.fit();
            term.refresh(0, term.rows - 1);
          } catch (e) {}
        }).catch(() => {});
      }
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

  // live-apply theme & font size changes without recreating the terminal
  useEffect(() => {
    const term = termRef.current;
    if (!term) return;
    try {
      term.options.theme = TERMINAL_THEMES[themeKey] || THEME;
      term.options.fontSize = fontSize;
      fitRef.current?.refit?.();
      term.refresh(0, term.rows - 1);
    } catch (e) {}
  }, [themeKey, fontSize]);

  return <div ref={containerRef} data-testid="xterm-container" className="h-full w-full" />;
});
