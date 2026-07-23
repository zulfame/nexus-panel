import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { DSPanel } from "@/components/ds";
import { ContainerHealth } from "@/components/ContainerHealth";
import {
  GitCommit, RefreshCw, Loader2, ArrowUpCircle, Check, Zap, Copy, RotateCcw, Webhook, Activity, Layers, Pencil,
} from "lucide-react";
import { useProjectCtx, field } from "./context";

export function OverviewTab() {
  const {
    p, checkUpdates, checkingUpdates, upd, busy, action, deployNote, setDeployNote,
    webhook, savingAuto, toggleAutoDeploy, copyText, regenerateWebhook,
    loadWebhookEvents, webhookEvents, health, setActiveTab, envText,
  } = useProjectCtx();

  return (
    <div className="space-y-4">
      {/* overview: source updates + auto-deploy side by side */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <DSPanel
          data-testid="updates-panel" className="lg:order-2"
          title={<span className="flex items-center gap-2"><GitCommit className="h-4 w-4 text-[var(--ds-primary)]" /> Source Updates</span>}
          headerRight={
            <div className="flex items-center gap-2">
              <Button
                data-testid="check-updates-btn"
                variant="outline"
                size="sm"
                disabled={checkingUpdates}
                onClick={() => checkUpdates(false)}
                className="border-[var(--ds-border)] bg-transparent"
              >
                {checkingUpdates ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <><RefreshCw className="mr-1.5 h-3.5 w-3.5" /> Check for Updates</>}
              </Button>
              {upd.behind > 0 && (
                <Button
                  data-testid="update-now-btn"
                  size="sm"
                  disabled={busy}
                  onClick={() => action("deploy")}
                  className="bg-status-running text-black hover:bg-status-running/85"
                >
                  {busy === "deploy" ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <><ArrowUpCircle className="mr-1.5 h-3.5 w-3.5" /> Update Now</>}
                </Button>
              )}
            </div>
          }
        >
          <div className="flex flex-wrap items-center gap-3 text-xs">
            {upd.cloned === false ? (
              <span className="text-muted-foreground" data-testid="updates-not-deployed">Not deployed yet — run a deploy first.</span>
            ) : upd.behind > 0 ? (
              <span className="flex items-center gap-1.5 rounded-sm border border-amber-500/30 bg-amber-500/10 px-2 py-1 text-amber-400" data-testid="updates-available-badge">
                <ArrowUpCircle className="h-3.5 w-3.5" /> {upd.behind} update{upd.behind > 1 ? "s" : ""} available
              </span>
            ) : (
              <span className="flex items-center gap-1.5 rounded-sm border border-emerald-500/30 bg-emerald-500/10 px-2 py-1 text-emerald-400" data-testid="updates-uptodate-badge">
                <Check className="h-3.5 w-3.5" /> Up to date
              </span>
            )}
            {upd.current && (
              <span className="text-muted-foreground" data-testid="updates-current-commit">
                deployed: <span className="text-foreground">{upd.current.short}</span> · {upd.current.message}
              </span>
            )}
          </div>

          {upd.behind > 0 && (upd.commits || []).length > 0 && (
            <div className="mt-3 max-h-[180px] overflow-y-auto rounded-sm border border-border" data-testid="updates-commit-list">
              {(upd.commits || []).map((c) => (
                <div key={c.hash} className="flex items-baseline gap-3 border-b border-border/60 px-3 py-2 last:border-b-0">
                  <span className="text-[11px] text-amber-400">{c.short}</span>
                  <span className="flex-1 truncate text-xs">{c.message}</span>
                  <span className="whitespace-nowrap text-[10px] text-muted-foreground">{c.author} · {new Date(c.date).toLocaleDateString()}</span>
                </div>
              ))}
            </div>
          )}

          <div className="mt-4 flex flex-col gap-2 border-t border-border/60 pt-3 sm:flex-row sm:items-center">
            <Label className="whitespace-nowrap text-[10px] uppercase tracking-wider text-muted-foreground">Deploy note (optional)</Label>
            <Input
              data-testid="deploy-note-input"
              value={deployNote}
              onChange={(e) => setDeployNote(e.target.value)}
              placeholder="e.g. Hotfix: patch login bug — saved to history"
              maxLength={280}
              className={`${field} flex-1 text-xs`}
            />
          </div>
        </DSPanel>

        <DSPanel
          data-testid="auto-deploy-panel" className="lg:order-1"
          title={<span className="flex items-center gap-2"><Zap className="h-4 w-4 text-[var(--ds-primary)]" /> Auto-Deploy (GitHub Webhook)</span>}
          headerRight={
            <div className="flex items-center gap-2">
              <span className="text-xs text-muted-foreground">{webhook?.enabled ? "On" : "Off"}</span>
              <Switch
                data-testid="auto-deploy-toggle"
                checked={!!webhook?.enabled}
                disabled={savingAuto || !webhook}
                onCheckedChange={toggleAutoDeploy}
              />
            </div>
          }
        >
          <p className="text-xs text-muted-foreground">
            When enabled, a push to <span className="text-foreground">{webhook?.branch || p.branch}</span> on GitHub automatically pulls & rebuilds this project.
            {" "}A deploy is skipped (with a Telegram alert) if required env vars are missing.
          </p>

          {webhook?.enabled && (() => {
            const whUrl = webhook.path ? `${window.location.origin}${webhook.path}` : webhook.url;
            return (
            <div className="mt-4 space-y-3" data-testid="webhook-details">
              <div className="space-y-1">
                <Label className="text-[10px] uppercase tracking-wider text-muted-foreground">Payload URL</Label>
                <div className="flex items-center gap-2">
                  <Input data-testid="webhook-url" readOnly value={whUrl} className={`${field} text-xs`} />
                  <Button data-testid="copy-webhook-url" size="sm" variant="outline" onClick={() => copyText(whUrl, "URL")} className="h-9 shrink-0 border-[var(--ds-border)] bg-transparent"><Copy className="h-3.5 w-3.5" /></Button>
                </div>
              </div>
              <div className="space-y-1">
                <Label className="text-[10px] uppercase tracking-wider text-muted-foreground">Secret</Label>
                <div className="flex items-center gap-2">
                  <Input data-testid="webhook-secret" readOnly type="password" value={webhook.secret} className={`${field} text-xs`} />
                  <Button data-testid="copy-webhook-secret" size="sm" variant="outline" onClick={() => copyText(webhook.secret, "Secret")} className="h-9 shrink-0 border-[var(--ds-border)] bg-transparent"><Copy className="h-3.5 w-3.5" /></Button>
                  <Button data-testid="regenerate-webhook" size="sm" variant="outline" onClick={regenerateWebhook} className="h-9 shrink-0 border-[var(--ds-border)] bg-transparent"><RotateCcw className="mr-1.5 h-3.5 w-3.5" /> Rotate</Button>
                </div>
              </div>
              <div className="rounded-sm border border-border bg-background/50 p-3 text-[11px] text-muted-foreground" data-testid="webhook-setup-steps">
                <div className="mb-1 flex items-center gap-1.5 text-foreground"><Webhook className="h-3.5 w-3.5" /> GitHub setup</div>
                <div>1. Repo → Settings → Webhooks → <span className="text-foreground">Add webhook</span></div>
                <div>2. Payload URL = the URL above · Content type = <span className="text-foreground">application/json</span></div>
                <div>3. Secret = the secret above · Events = <span className="text-foreground">Just the push event</span></div>
                <div>4. Save, then push to <span className="text-foreground">{webhook.branch}</span> to trigger a deploy.</div>
              </div>
            </div>
            );
          })()}
        </DSPanel>
      </div>

      {/* webhook activity + container health, side by side */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2 lg:items-stretch">
        <DSPanel
          data-testid="webhook-activity-panel"
          title={<span className="flex items-center gap-2"><Webhook className="h-4 w-4 text-[var(--ds-primary)]" /> Recent Webhook Activity</span>}
          headerRight={<Button data-testid="refresh-webhook-events" size="sm" variant="ghost" onClick={loadWebhookEvents} className="h-7 px-2 text-[11px] text-muted-foreground hover:text-foreground"><RefreshCw className="mr-1 h-3 w-3" /> Refresh</Button>}
        >
          {webhookEvents.length === 0 ? (
            <div className="rounded-sm border border-border bg-background/50 px-3 py-3 text-[11px] text-muted-foreground" data-testid="webhook-events-empty">
              {webhook?.enabled ? `No webhook triggers yet. Push to ${webhook.branch} to see activity here.` : "Auto-Deploy webhook is off. Enable it above to receive push events."}
            </div>
          ) : (
            <div className="max-h-[240px] overflow-y-auto rounded-sm border border-border" data-testid="webhook-events-list">
              {webhookEvents.map((ev, i) => {
                const ok = ev.result === "deployed";
                const skip = (ev.result || "").startsWith("skipped");
                const cls = ok ? "text-emerald-400 border-emerald-500/30 bg-emerald-500/10"
                  : skip ? "text-amber-400 border-amber-500/30 bg-amber-500/10"
                  : ev.result === "deploying" ? "text-sky-400 border-sky-500/30 bg-sky-500/10"
                  : "text-red-400 border-red-500/30 bg-red-500/10";
                return (
                  <div key={i} className="flex flex-wrap items-center gap-2 border-b border-border/60 px-3 py-2 last:border-b-0" data-testid="webhook-event-row">
                    <span className="whitespace-nowrap text-[10px] text-muted-foreground">{new Date(ev.ts).toLocaleString()}</span>
                    {ev.commit?.short && <span className="text-[11px] text-amber-400">{ev.commit.short}</span>}
                    <span className="min-w-0 flex-1 truncate text-[11px]">{ev.commit?.message || "—"}</span>
                    {ev.pusher && <span className="text-[10px] text-muted-foreground">by {ev.pusher}</span>}
                    <span className={`rounded-sm border px-1.5 py-0.5 text-[10px] ${cls}`}>{ev.result}</span>
                  </div>
                );
              })}
            </div>
          )}
        </DSPanel>

        <DSPanel
          data-testid="container-health-panel"
          title={<span className="flex items-center gap-2"><Activity className="h-4 w-4 text-[var(--ds-primary)]" /> Container Health</span>}
        >
          <ContainerHealth containers={health} />
        </DSPanel>
      </div>

      {/* configuration summary (read-only) */}
      <DSPanel
        data-testid="config-summary"
        title={<span className="flex items-center gap-2"><Layers className="h-4 w-4 text-[var(--ds-primary)]" /> Configuration Summary</span>}
        headerRight={<Button data-testid="edit-config-btn" size="sm" variant="outline" onClick={() => setActiveTab("config")} className="h-8 border-[var(--ds-border)] bg-transparent text-xs"><Pencil className="mr-1.5 h-3.5 w-3.5" /> Edit Configuration</Button>}
      >
        <div className="grid grid-cols-2 gap-x-6 gap-y-4 lg:grid-cols-4">
          {[
            { label: "Repository", value: p.repo_url, mono: true },
            { label: "GitHub Token", value: p.has_github_token ? "•••••••• set" : "not set", mono: true },
            { label: "Database", value: p.db_name || "—", mono: true },
            { label: "Frontend Port", value: p.frontend_port || "—", mono: true },
            { label: "Backend Port", value: p.backend_port || "—", mono: true },
            { label: "Domain", value: p.domain || "—" },
            { label: "SSL Mode", value: p.ssl_mode === "letsencrypt" ? "Let's Encrypt" : p.ssl_mode === "custom" ? "Custom" : "None" },
            { label: "Environment", value: p.environment || "—" },
            { label: "Environment Vars", value: `${(envText.split("\n").filter((l) => l.includes("=")).length)} variables` },
          ].map((x) => (
            <div key={x.label} className="min-w-0">
              <div className="mb-1 text-[10px] uppercase tracking-wider text-muted-foreground">{x.label}</div>
              <div className={`truncate text-[13px] text-[var(--ds-text)] ${x.mono ? "font-mono" : ""}`} title={String(x.value)}>{x.value}</div>
            </div>
          ))}
        </div>
      </DSPanel>
    </div>
  );
}
