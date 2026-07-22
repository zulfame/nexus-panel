import { Container, Circle } from "lucide-react";

export function Footer({ panel }) {
  const year = new Date().getFullYear();
  return (
    <footer
      data-testid="app-footer"
      className="mt-auto flex flex-col items-center justify-between gap-2 border-t border-[var(--ds-border)] bg-[var(--ds-page)] px-4 py-3 text-[12px] text-[var(--ds-muted)] sm:flex-row sm:px-8"
    >
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <span>© {year} <span className="font-semibold tracking-wide text-[var(--ds-text-secondary)]">NEXUS.PANEL</span></span>
        {panel?.version && <span className="font-mono">v{panel.version}</span>}
        {panel?.build && <span className="hidden font-mono sm:inline">build {panel.build}</span>}
      </div>
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
        <span className="flex items-center gap-1.5">
          <Circle className="h-2 w-2 fill-[var(--ds-success)] text-[var(--ds-success)]" />
          System Operational
        </span>
        <span className="flex items-center gap-1.5">
          <Container className="h-3.5 w-3.5" />
          Docker <span className={panel?.docker ? "text-[var(--ds-success)]" : "text-[var(--ds-muted)]"}>{panel?.docker ? "Running" : "Off"}</span>
        </span>
      </div>
    </footer>
  );
}
