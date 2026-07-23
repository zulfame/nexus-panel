import { Button } from "@/components/ui/button";
import { DSPanel, DSButton } from "@/components/ds";
import { Layers, KeyRound, ScanSearch, Loader2, AlertTriangle, Check, Plus, ShieldAlert } from "lucide-react";
import { useProjectCtx } from "./context";

export function EnvironmentTab() {
  const {
    applyStandardEnv, generateSecret, scanEnv, scanning, saving, save,
    envScan, classifyEnv, addMissingVar, envText, setEnvText,
  } = useProjectCtx();

  return (
    <DSPanel
      title={<span className="flex items-center gap-2"><Layers className="h-4 w-4 text-[var(--ds-primary)]" /> Environment Variables</span>}
      headerRight={
        <div className="flex flex-wrap items-center gap-2">
          <Button data-testid="apply-standard-env-btn" size="sm" variant="outline" onClick={applyStandardEnv} className="h-8 border-[var(--ds-border)] bg-transparent text-xs">
            <Layers className="mr-1.5 h-3.5 w-3.5" /> Apply Standard Env
          </Button>
          <Button data-testid="generate-secret-btn" size="sm" variant="outline" onClick={generateSecret} className="h-8 border-[var(--ds-border)] bg-transparent text-xs">
            <KeyRound className="mr-1.5 h-3.5 w-3.5" /> Generate JWT Secret
          </Button>
          <Button data-testid="scan-env-btn" size="sm" variant="outline" disabled={scanning} onClick={scanEnv} className="h-8 border-[var(--ds-border)] bg-transparent text-xs">
            {scanning ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <><ScanSearch className="mr-1.5 h-3.5 w-3.5" /> Scan Required Vars</>}
          </Button>
        </div>
      }
      footerAlign="end"
      footer={<DSButton data-testid="save-env-btn" variant="primary" loading={saving} onClick={save}>Save Environment</DSButton>}
    >
      <p className="mb-3 text-[12px] text-muted-foreground">Backend <code className="font-mono">.env</code> for this project. <code className="font-mono">MONGO_URL</code> &amp; <code className="font-mono">DB_NAME</code> are injected automatically.</p>

      {envScan && envScan.scanned && (
        <div data-testid="env-scan-result" className="mb-3 rounded-[var(--ds-radius-card)] border border-border bg-card p-3">
          {envScan.required.length === 0 ? (
            <p className="text-xs text-muted-foreground">No env vars referenced by the repo code.</p>
          ) : (
            <>
              {envScan.missing.length > 0 && (
                <div data-testid="env-missing-warning" className="mb-2 flex items-start gap-2 border border-amber-500/30 bg-amber-500/10 p-2 text-xs text-amber-400">
                  <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                  <span>{envScan.missing.length} required var(s) not set yet. Deploy will likely fail (e.g. 500 on login) until you add them.</span>
                </div>
              )}
              <div className="flex flex-wrap gap-1.5">
                {envScan.required.map((r) => (
                  <button
                    key={r.key}
                    data-testid={`env-req-${r.key}`}
                    type="button"
                    onClick={() => !r.provided && addMissingVar(r.key)}
                    title={r.provided ? "Already set" : classifyEnv(r.key).hint}
                    className={`inline-flex items-center gap-1.5 rounded-sm border px-2 py-1 text-[11px] ${
                      r.provided
                        ? "border-emerald-500/25 bg-emerald-500/10 text-emerald-400"
                        : "border-red-500/30 bg-red-500/10 text-red-400 hover:bg-red-500/20"
                    }`}
                  >
                    {r.provided ? <Check className="h-3 w-3" /> : <Plus className="h-3 w-3" />}
                    {r.key}
                    <span className="text-muted-foreground">·{r.source}</span>
                  </button>
                ))}
              </div>
            </>
          )}
          {envScan.secret_findings && envScan.secret_findings.length > 0 && (
            <div data-testid="secret-findings" className="mt-3 border-t border-border pt-3">
              <div className="mb-1.5 flex items-center gap-2 text-xs font-semibold text-red-400">
                <ShieldAlert className="h-3.5 w-3.5" />
                {envScan.secret_findings.length} possible secret(s) committed in the repo
              </div>
              <p className="mb-2 text-[11px] text-muted-foreground">
                Hard-coded credentials in the code are a security risk. Rotate them and move
                values into env vars / a secrets manager.
              </p>
              <div className="max-h-40 space-y-1 overflow-auto">
                {envScan.secret_findings.map((f, i) => (
                  <div key={i} className="flex items-center justify-between gap-2 rounded-sm border border-red-500/25 bg-red-500/10 px-2 py-1 text-[11px]">
                    <span className="font-mono text-red-300">{f.type}</span>
                    <span className="truncate text-muted-foreground" title={`${f.file}:${f.line}`}>{f.file}:{f.line}</span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
      {envScan && !envScan.scanned && (
        <p data-testid="env-scan-msg" className="mb-3 text-xs text-amber-400">{envScan.message}</p>
      )}

      <textarea data-testid="cfg-env" className="min-h-[280px] w-full rounded-[var(--ds-radius-input)] border border-[var(--ds-border)] bg-transparent p-3 font-mono text-sm focus:outline-none focus:ring-1 focus:ring-[var(--ds-primary)]" value={envText} onChange={(e) => setEnvText(e.target.value)} placeholder="KEY=VALUE per line" />
    </DSPanel>
  );
}
