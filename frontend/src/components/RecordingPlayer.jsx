import { useEffect, useRef, useState } from "react";
import { Terminal as XTerm } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import "@xterm/xterm/css/xterm.css";
import { Play, Pause, RotateCcw } from "lucide-react";

const THEME = {
  background: "#050505", foreground: "#d4d4d4", cursor: "#10B981",
  green: "#10B981", brightGreen: "#34d399", red: "#EF4444", yellow: "#F59E0B",
  blue: "#3B82F6", cyan: "#22d3ee", white: "#e5e5e5",
};

const SPEEDS = [0.5, 1, 2, 4];

/** Replays a recorded terminal session (asciinema-style events [[t, text], ...]). */
export function RecordingPlayer({ events = [] }) {
  const containerRef = useRef(null);
  const termRef = useRef(null);
  const fitRef = useRef(null);
  const timerRef = useRef(null);
  const idxRef = useRef(0);
  const speedRef = useRef(1);

  const total = events.length ? events[events.length - 1][0] : 0;
  const [playing, setPlaying] = useState(false);
  const [speed, setSpeed] = useState(1);
  const [elapsed, setElapsed] = useState(0);

  useEffect(() => {
    const term = new XTerm({
      fontFamily: '"JetBrains Mono", monospace', fontSize: 13, theme: THEME,
      cursorBlink: false, disableStdin: true, scrollback: 5000, convertEol: false,
    });
    const fit = new FitAddon();
    term.loadAddon(fit);
    if (containerRef.current) {
      term.open(containerRef.current);
      setTimeout(() => { try { fit.fit(); } catch (e) {} }, 30);
      if (document.fonts && document.fonts.load) {
        document.fonts.load('13px "JetBrains Mono"').then(() => {
          try {
            term.options.fontFamily = "monospace";
            term.options.fontFamily = '"JetBrains Mono", monospace';
            fit.fit();
            term.refresh(0, term.rows - 1);
          } catch (e) {}
        }).catch(() => {});
      }
    }
    termRef.current = term;
    fitRef.current = fit;
    const onResize = () => { try { fit.fit(); } catch (e) {} };
    window.addEventListener("resize", onResize);
    // autoplay
    setTimeout(() => play(), 150);
    return () => {
      window.removeEventListener("resize", onResize);
      clearTimeout(timerRef.current);
      term.dispose();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const stopTimer = () => { clearTimeout(timerRef.current); timerRef.current = null; };

  const scheduleNext = () => {
    const i = idxRef.current;
    if (i >= events.length) { setPlaying(false); return; }
    const prevT = i > 0 ? events[i - 1][0] : 0;
    const delay = Math.max(0, ((events[i][0] - prevT) * 1000) / speedRef.current);
    timerRef.current = setTimeout(() => {
      termRef.current?.write(events[i][1]);
      setElapsed(events[i][0]);
      idxRef.current = i + 1;
      scheduleNext();
    }, Math.min(delay, 4000)); // cap idle gaps at 4s so replays never stall
  };

  const play = () => {
    if (idxRef.current >= events.length) restart(true);
    setPlaying(true);
    scheduleNext();
  };
  const pause = () => { stopTimer(); setPlaying(false); };

  const restart = (autoContinue = false) => {
    stopTimer();
    idxRef.current = 0;
    setElapsed(0);
    termRef.current?.reset();
    if (!autoContinue) setPlaying(false);
  };

  const seekTo = (targetT) => {
    stopTimer();
    termRef.current?.reset();
    let i = 0;
    while (i < events.length && events[i][0] <= targetT) {
      termRef.current?.write(events[i][1]);
      i++;
    }
    idxRef.current = i;
    setElapsed(targetT);
    if (playing) scheduleNext();
  };

  const changeSpeed = () => {
    const next = SPEEDS[(SPEEDS.indexOf(speed) + 1) % SPEEDS.length];
    setSpeed(next);
    speedRef.current = next;
  };

  const pct = total > 0 ? Math.min(100, (elapsed / total) * 100) : 0;
  const fmt = (s) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, "0")}`;

  return (
    <div className="flex flex-col gap-3">
      <div ref={containerRef} data-testid="recording-terminal" className="h-[380px] w-full overflow-hidden rounded-sm border border-[var(--ds-border)] bg-[#050505] p-2" />
      <div className="flex items-center gap-3">
        <button
          data-testid="rec-play-pause"
          onClick={() => (playing ? pause() : play())}
          className="flex h-9 w-9 items-center justify-center rounded-md bg-[var(--ds-primary)] text-white hover:bg-[var(--ds-primary-hover)]"
        >
          {playing ? <Pause className="h-4 w-4" /> : <Play className="h-4 w-4" />}
        </button>
        <button
          data-testid="rec-restart"
          onClick={() => restart(false)}
          className="flex h-9 w-9 items-center justify-center rounded-md border border-[var(--ds-border)] text-[var(--ds-text-secondary)] hover:bg-[var(--ds-hover)]"
        >
          <RotateCcw className="h-4 w-4" />
        </button>
        <div
          data-testid="rec-progress"
          onClick={(e) => {
            const rect = e.currentTarget.getBoundingClientRect();
            seekTo(((e.clientX - rect.left) / rect.width) * total);
          }}
          className="group relative h-2 flex-1 cursor-pointer overflow-hidden rounded-full bg-[var(--ds-border)]"
        >
          <div className="h-full rounded-full bg-[var(--ds-primary)]" style={{ width: `${pct}%` }} />
        </div>
        <span className="w-20 text-right font-mono text-xs text-[var(--ds-muted)]">{fmt(elapsed)} / {fmt(total)}</span>
        <button
          data-testid="rec-speed"
          onClick={changeSpeed}
          className="h-9 rounded-md border border-[var(--ds-border)] px-3 text-xs font-medium text-[var(--ds-text-secondary)] hover:bg-[var(--ds-hover)]"
        >
          {speed}x
        </button>
      </div>
    </div>
  );
}
