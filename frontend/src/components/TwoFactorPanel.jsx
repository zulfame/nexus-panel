import { useEffect, useState } from "react";
import { ShieldCheck, ShieldOff, Copy, Loader2 } from "lucide-react";
import api, { apiError } from "@/lib/api";
import notify from "@/lib/notify";
import { DSPanel, DSButton, DSModal } from "@/components/ds";
import { Input } from "@/components/ui/input";

export const TwoFactorPanel = () => {
  const [status, setStatus] = useState(null);
  const [busy, setBusy] = useState(false);
  const [setup, setSetup] = useState(null); // {qr, secret}
  const [code, setCode] = useState("");
  const [recovery, setRecovery] = useState(null);
  const [disableOpen, setDisableOpen] = useState(false);
  const [pw, setPw] = useState("");

  const load = () => api.get("/auth/2fa/status").then((r) => setStatus(r.data)).catch(() => {});
  useEffect(() => { load(); }, []);

  const startSetup = async () => {
    setBusy(true);
    try {
      setSetup((await api.post("/auth/2fa/setup")).data);
      setCode("");
    } catch (e) { notify.error("Could not start 2FA setup", apiError(e)); }
    finally { setBusy(false); }
  };

  const enable = async () => {
    setBusy(true);
    try {
      const { data } = await api.post("/auth/2fa/enable", { code });
      setRecovery(data.recovery_codes);
      setSetup(null);
      notify.success("Two-factor authentication enabled");
      load();
    } catch (e) { notify.error("Could not enable 2FA", apiError(e)); }
    finally { setBusy(false); }
  };

  const disable = async () => {
    setBusy(true);
    try {
      await api.post("/auth/2fa/disable", { password: pw });
      notify.success("Two-factor authentication disabled");
      setDisableOpen(false); setPw("");
      load();
    } catch (e) { notify.error("Could not disable 2FA", apiError(e)); }
    finally { setBusy(false); }
  };

  const enabled = status?.enabled;

  return (
    <>
      <DSPanel
        title={<span className="flex items-center gap-2">{enabled ? <ShieldCheck className="h-4 w-4 text-[var(--ds-success)]" /> : <ShieldOff className="h-4 w-4 text-[var(--ds-muted)]" />} Two-Factor Authentication</span>}
        footerAlign="between"
        footer={enabled
          ? <><span className="text-[12px] text-[var(--ds-success)]">Enabled · {status?.recovery_remaining ?? 0} recovery codes left</span>
              <DSButton variant="danger" icon={ShieldOff} onClick={() => setDisableOpen(true)} data-testid="twofa-disable-btn">Disable 2FA</DSButton></>
          : (!setup && <DSButton variant="primary" icon={ShieldCheck} loading={busy} onClick={startSetup} data-testid="twofa-setup-btn">Enable 2FA</DSButton>)}
      >
        {!enabled && !setup && (
          <p className="text-sm text-[var(--ds-muted)]">Add a second layer of security. You'll enter a code from an authenticator app (Google Authenticator, Authy, 1Password) each time you sign in.</p>
        )}
        {!enabled && setup && (
          <div className="flex flex-col gap-4 sm:flex-row sm:items-start" data-testid="twofa-setup-block">
            <img src={setup.qr} alt="2FA QR code" className="h-40 w-40 shrink-0 rounded-md bg-white p-2" data-testid="twofa-qr" />
            <div className="flex-1 space-y-3">
              <p className="text-sm text-[var(--ds-muted)]">Scan the QR with your authenticator app, or enter this key manually:</p>
              <div className="flex items-center gap-2">
                <code className="rounded-sm border border-[var(--ds-border)] bg-[var(--ds-card)] px-2 py-1 text-xs text-[var(--ds-text)]">{setup.secret}</code>
                <button onClick={() => { navigator.clipboard.writeText(setup.secret); notify.success("Secret copied"); }} className="text-[var(--ds-muted)] hover:text-[var(--ds-text)]"><Copy className="h-3.5 w-3.5" /></button>
              </div>
              <Input value={code} onChange={(e) => setCode(e.target.value)} placeholder="Enter 6-digit code to confirm" data-testid="twofa-confirm-input" className="max-w-[220px] tracking-widest" />
              <div className="flex gap-2">
                <DSButton variant="primary" loading={busy} disabled={!code} onClick={enable} data-testid="twofa-enable-btn">Verify & enable</DSButton>
                <DSButton variant="outline" onClick={() => setSetup(null)}>Cancel</DSButton>
              </div>
            </div>
          </div>
        )}
        {enabled && (
          <p className="text-sm text-[var(--ds-muted)]">Your account is protected with an authenticator app. Keep your recovery codes safe — each can be used once if you lose access to your device.</p>
        )}
      </DSPanel>

      {/* recovery codes (shown once, right after enabling) */}
      <DSModal open={!!recovery} onOpenChange={(o) => !o && setRecovery(null)} size="sm" title="Save your recovery codes" icon={ShieldCheck}
        footer={<DSButton variant="primary" onClick={() => setRecovery(null)}>I've saved them</DSButton>}>
        <div className="space-y-3">
          <p className="text-sm text-[var(--ds-muted)]">Store these somewhere safe. Each code works once if you can't use your authenticator. They won't be shown again.</p>
          <div className="grid grid-cols-2 gap-2" data-testid="twofa-recovery-codes">
            {(recovery || []).map((c) => <code key={c} className="rounded-sm border border-[var(--ds-border)] bg-[var(--ds-card)] px-2 py-1 text-center text-sm text-[var(--ds-text)]">{c}</code>)}
          </div>
          <DSButton variant="outline" icon={Copy} onClick={() => { navigator.clipboard.writeText((recovery || []).join("\n")); notify.success("Recovery codes copied"); }}>Copy all</DSButton>
        </div>
      </DSModal>

      {/* disable confirmation */}
      <DSModal open={disableOpen} onOpenChange={setDisableOpen} size="sm" title="Disable 2FA" icon={ShieldOff}
        footer={<><DSButton variant="outline" onClick={() => setDisableOpen(false)}>Cancel</DSButton>
          <DSButton variant="danger" loading={busy} disabled={!pw} onClick={disable} data-testid="twofa-disable-confirm">Disable</DSButton></>}>
        <div className="space-y-2">
          <p className="text-sm text-[var(--ds-muted)]">Enter your password to turn off two-factor authentication.</p>
          <Input type="password" value={pw} onChange={(e) => setPw(e.target.value)} placeholder="Password" data-testid="twofa-disable-password" />
        </div>
      </DSModal>
    </>
  );
};

export default TwoFactorPanel;
