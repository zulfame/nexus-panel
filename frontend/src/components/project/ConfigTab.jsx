import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { DSPanel, DSButton } from "@/components/ds";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Loader2, Globe } from "lucide-react";
import { useProjectCtx, field, lbl } from "./context";

export function ConfigTab() {
  const { saving, save, form, setF, p, checkingDns, checkDns, dns } = useProjectCtx();

  return (
    <DSPanel footerAlign="end" footer={<DSButton data-testid="save-config-btn" variant="primary" loading={saving} onClick={save}>Save Configuration</DSButton>}>
      <div className="grid grid-cols-1 gap-5 md:grid-cols-2">
        <div className="space-y-2"><Label className={lbl}>Name</Label><Input data-testid="cfg-name" className={field} value={form.name} onChange={(e) => setF("name", e.target.value)} /></div>
        <div className="space-y-2"><Label className={lbl}>Branch</Label><Input data-testid="cfg-branch" className={field} value={form.branch} onChange={(e) => setF("branch", e.target.value)} /></div>
        <div className="space-y-2 md:col-span-2">
          <Label className={lbl}>Environment</Label>
          <Input data-testid="cfg-environment" list="cfg-env-presets" className={field} value={form.environment} onChange={(e) => setF("environment", e.target.value)} placeholder="e.g. production, staging, demo…" />
          <datalist id="cfg-env-presets">
            <option value="production" /><option value="staging" /><option value="demo" /><option value="development" /><option value="testing" />
          </datalist>
        </div>
        <div className="space-y-2 md:col-span-2"><Label className={lbl}>Repository URL</Label><Input data-testid="cfg-repo" className={field} value={form.repo_url} onChange={(e) => setF("repo_url", e.target.value)} /></div>
        <div className="space-y-2"><Label className={lbl}>GitHub Token {p.has_github_token && <span className="text-status-running">(set)</span>}</Label><Input data-testid="cfg-token" type="password" className={field} value={form.github_token} onChange={(e) => setF("github_token", e.target.value)} placeholder={p.has_github_token ? "•••• leave blank to keep" : "ghp_…"} /></div>
        <div className="space-y-2"><Label className={lbl}>Database Name</Label><Input data-testid="cfg-db" className={field} value={form.db_name} onChange={(e) => setF("db_name", e.target.value)} /></div>
        <div className="space-y-2"><Label className={lbl}>Frontend Port</Label><Input data-testid="cfg-fe-port" type="number" className={field} value={form.frontend_port ?? ""} onChange={(e) => setF("frontend_port", parseInt(e.target.value) || 0)} /></div>
        <div className="space-y-2"><Label className={lbl}>Backend Port</Label><Input data-testid="cfg-be-port" type="number" className={field} value={form.backend_port ?? ""} onChange={(e) => setF("backend_port", parseInt(e.target.value) || 0)} /></div>
      </div>

      <div className="mt-6 border-t border-border pt-6">
        <div className="mb-4 flex items-center justify-between">
          <h3 className="font-heading text-sm font-bold uppercase tracking-wider text-muted-foreground">Domain & SSL</h3>
          {form.domain && (
            <Button data-testid="check-dns-btn" variant="outline" disabled={checkingDns} onClick={checkDns} className="h-8 border-[var(--ds-border)] bg-transparent text-xs">
              {checkingDns ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <><Globe className="mr-1.5 h-3.5 w-3.5" /> Check DNS</>}
            </Button>
          )}
        </div>
        {dns && (
          <div data-testid="dns-result" className={`mb-4 border p-3 text-xs ${dns.matches ? "border-emerald-500/30 bg-emerald-500/5 text-emerald-400" : "border-amber-500/30 bg-amber-500/5 text-amber-400"}`}>
            <div>domain: {dns.domain || "—"} → {dns.resolved_ips?.length ? dns.resolved_ips.join(", ") : "not resolving"}</div>
            <div>server ip: {dns.server_ip || "unknown"}</div>
            <div className="mt-1 font-bold">{dns.matches ? "✓ Domain points to this server — ready for SSL" : "✗ Domain does not point here yet — update the DNS A record"}</div>
          </div>
        )}
        <div className="grid grid-cols-1 gap-5 md:grid-cols-2">
          <div className="space-y-2"><Label className={lbl}>Domain</Label><Input data-testid="cfg-domain" className={field} value={form.domain} onChange={(e) => setF("domain", e.target.value)} /></div>
          <div className="space-y-2">
            <Label className={lbl}>SSL Mode</Label>
            <Select value={form.ssl_mode} onValueChange={(v) => setF("ssl_mode", v)}>
              <SelectTrigger data-testid="cfg-ssl-mode" className={field}><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="letsencrypt">Let's Encrypt (auto)</SelectItem>
                <SelectItem value="custom">Custom certificate</SelectItem>
                <SelectItem value="none">None</SelectItem>
              </SelectContent>
            </Select>
          </div>
          {form.ssl_mode === "letsencrypt" && (
            <div className="space-y-2 md:col-span-2"><Label className={lbl}>Let's Encrypt Email</Label><Input data-testid="cfg-ssl-email" className={field} value={form.ssl_email} onChange={(e) => setF("ssl_email", e.target.value)} /></div>
          )}
          {form.ssl_mode === "custom" && (
            <>
              <div className="space-y-2"><Label className={lbl}>Cert Path</Label><Input data-testid="cfg-cert" className={field} value={form.ssl_cert_path} onChange={(e) => setF("ssl_cert_path", e.target.value)} /></div>
              <div className="space-y-2"><Label className={lbl}>Key Path</Label><Input data-testid="cfg-key" className={field} value={form.ssl_key_path} onChange={(e) => setF("ssl_key_path", e.target.value)} /></div>
            </>
          )}
        </div>
      </div>
    </DSPanel>
  );
}
