import { useState } from "react";
import { useNavigate } from "react-router-dom";
import notify from "@/lib/notify";
import { Github, Settings2, Globe, Rocket, ChevronLeft, ChevronRight } from "lucide-react";
import api, { apiError } from "@/lib/api";
import { Layout } from "@/components/Layout";
import "@/styles/design-system.css";
import { DSButton, DSCard, DSInput, DSTextarea, DSSelect } from "@/components/ds";

const STEPS = [
  { id: 0, label: "Repository", icon: Github },
  { id: 1, label: "Build Config", icon: Settings2 },
  { id: 2, label: "Domain & SSL", icon: Globe },
  { id: 3, label: "Review", icon: Rocket },
];

const lbl = "block text-[12px] font-medium uppercase tracking-wider text-[var(--ds-muted)]";

export default function AddProject() {
  const navigate = useNavigate();
  const [step, setStep] = useState(0);
  const [saving, setSaving] = useState(false);
  const [f, setF] = useState({
    name: "",
    repo_url: "",
    branch: "main",
    environment: "",
    github_token: "",
    db_name: "",
    env_text: "",
    domain: "",
    ssl_mode: "letsencrypt",
    ssl_email: "",
    ssl_cert_path: "",
    ssl_key_path: "",
  });
  const set = (k, v) => setF((p) => ({ ...p, [k]: v }));

  const canNext = () => {
    if (step === 0) return f.name.trim() && f.repo_url.trim();
    return true;
  };

  const parseEnv = () =>
    f.env_text
      .split("\n")
      .map((l) => l.trim())
      .filter((l) => l && l.includes("="))
      .map((l) => {
        const i = l.indexOf("=");
        return { key: l.slice(0, i).trim(), value: l.slice(i + 1).trim() };
      });

  const submit = async () => {
    setSaving(true);
    try {
      const payload = {
        name: f.name,
        repo_url: f.repo_url,
        branch: f.branch || "main",
        environment: f.environment.trim() || undefined,
        github_token: f.github_token || undefined,
        db_name: f.db_name || undefined,
        domain: f.domain || undefined,
        ssl_mode: f.ssl_mode,
        ssl_email: f.ssl_email || undefined,
        ssl_cert_path: f.ssl_cert_path || undefined,
        ssl_key_path: f.ssl_key_path || undefined,
        env_vars: parseEnv(),
      };
      const { data } = await api.post("/projects", payload);
      notify.success("Project created");
      navigate(`/projects/${data.id}`);
    } catch (e) {
      notify.error(apiError(e));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Layout>
      <div className="min-h-screen">
        <header className="sticky top-14 z-20 flex flex-wrap items-center justify-between gap-3 border-b border-[var(--ds-border)] bg-[var(--ds-page)]/85 px-4 py-5 backdrop-blur-xl sm:px-8 lg:top-14">
          <div>
            <h1 className="text-[24px] font-bold tracking-tight text-[var(--ds-text)]">New Project</h1>
            <p className="mt-0.5 text-[13px] text-[var(--ds-muted)]">Pull from GitHub and configure deployment</p>
          </div>
        </header>

        <div className="p-4 sm:p-6 lg:p-8">
          {/* stepper */}
          <div className="mb-8 flex items-center">
            {STEPS.map((s, i) => (
              <div key={s.id} className="flex flex-1 items-center">
                <div className="flex items-center gap-2">
                  <div
                    className={`ds-transition flex h-9 w-9 items-center justify-center rounded-[var(--ds-radius-btn)] border ${
                      i <= step
                        ? "border-[var(--ds-primary)] bg-[var(--ds-primary)]/10 text-[var(--ds-primary)]"
                        : "border-[var(--ds-border)] text-[var(--ds-muted)]"
                    }`}
                  >
                    <s.icon className="h-4 w-4" />
                  </div>
                  <span className={`hidden text-[13px] font-medium sm:block ${i <= step ? "text-[var(--ds-text)]" : "text-[var(--ds-muted)]"}`}>
                    {s.label}
                  </span>
                </div>
                {i < STEPS.length - 1 && (
                  <div className={`ds-transition mx-3 h-px flex-1 ${i < step ? "bg-[var(--ds-primary)]" : "bg-[var(--ds-border)]"}`} />
                )}
              </div>
            ))}
          </div>

          <DSCard className="p-6">
            {step === 0 && (
              <div className="grid grid-cols-1 gap-x-6 gap-y-5 lg:grid-cols-2">
                <div className="space-y-2 lg:col-span-2">
                  <label className={lbl}>Project Name</label>
                  <DSInput data-testid="wizard-name-input" value={f.name} onChange={(e) => set("name", e.target.value)} placeholder="My App One" />
                </div>
                <div className="space-y-2 lg:col-span-2">
                  <label className={lbl}>GitHub Repository URL</label>
                  <DSInput data-testid="wizard-repo-input" value={f.repo_url} onChange={(e) => set("repo_url", e.target.value)} placeholder="https://github.com/user/repo.git" />
                </div>
                <div className="space-y-2">
                  <label className={lbl}>Branch</label>
                  <DSInput data-testid="wizard-branch-input" value={f.branch} onChange={(e) => set("branch", e.target.value)} />
                </div>
                <div className="space-y-2">
                  <label className={lbl}>Personal Access Token (private repo)</label>
                  <DSInput data-testid="wizard-token-input" type="password" value={f.github_token} onChange={(e) => set("github_token", e.target.value)} placeholder="ghp_…" />
                </div>
              </div>
            )}

            {step === 1 && (
              <div className="space-y-5">
                <div className="space-y-2">
                  <label className={lbl}>Database Name (MongoDB)</label>
                  <DSInput data-testid="wizard-db-input" value={f.db_name} onChange={(e) => set("db_name", e.target.value)} placeholder="auto: <slug>_db" />
                </div>
                <div className="space-y-2">
                  <label className={lbl}>Environment</label>
                  <DSInput
                    data-testid="wizard-environment-input"
                    list="env-presets"
                    value={f.environment}
                    onChange={(e) => set("environment", e.target.value)}
                    placeholder="e.g. production, staging, demo…"
                  />
                  <datalist id="env-presets">
                    <option value="production" />
                    <option value="staging" />
                    <option value="demo" />
                    <option value="development" />
                    <option value="testing" />
                  </datalist>
                  <p className="text-[12px] text-[var(--ds-muted)]">
                    Free-form tag to mark this deployment (production, staging, demo, or anything you like).
                  </p>
                </div>
                <div className="space-y-2">
                  <label className={lbl}>Backend Environment Variables (KEY=VALUE per line)</label>
                  <DSTextarea
                    data-testid="wizard-env-input"
                    className="min-h-[200px] font-mono text-[13px]"
                    value={f.env_text}
                    onChange={(e) => set("env_text", e.target.value)}
                    placeholder={"STRIPE_KEY=sk_live_xxx\nOPENAI_KEY=sk-xxx"}
                  />
                  <p className="text-[12px] text-[var(--ds-muted)]">
                    Ports are auto-assigned. MONGO_URL &amp; DB_NAME are injected automatically.
                  </p>
                </div>
              </div>
            )}

            {step === 2 && (
              <div className="grid grid-cols-1 gap-x-6 gap-y-5 lg:grid-cols-2">
                <div className="space-y-2">
                  <label className={lbl}>Domain / Subdomain</label>
                  <DSInput data-testid="wizard-domain-input" value={f.domain} onChange={(e) => set("domain", e.target.value)} placeholder="app1.yourdomain.com" />
                </div>
                <div className="space-y-2">
                  <label className={lbl}>SSL Mode</label>
                  <DSSelect data-testid="wizard-ssl-select" value={f.ssl_mode} onChange={(e) => set("ssl_mode", e.target.value)}>
                    <option value="letsencrypt">Let's Encrypt (auto)</option>
                    <option value="custom">Custom certificate (wildcard)</option>
                    <option value="none">None (HTTP only)</option>
                  </DSSelect>
                </div>
                {f.ssl_mode === "letsencrypt" && (
                  <div className="space-y-2 lg:col-span-2">
                    <label className={lbl}>Email (for Let's Encrypt)</label>
                    <DSInput data-testid="wizard-ssl-email-input" value={f.ssl_email} onChange={(e) => set("ssl_email", e.target.value)} placeholder="you@example.com" />
                  </div>
                )}
                {f.ssl_mode === "custom" && (
                  <>
                    <div className="space-y-2 lg:col-span-2">
                      <label className={lbl}>Certificate Path (fullchain)</label>
                      <DSInput data-testid="wizard-cert-input" value={f.ssl_cert_path} onChange={(e) => set("ssl_cert_path", e.target.value)} placeholder="/etc/ssl/wildcard/fullchain.pem" />
                    </div>
                    <div className="space-y-2 lg:col-span-2">
                      <label className={lbl}>Private Key Path</label>
                      <DSInput data-testid="wizard-key-input" value={f.ssl_key_path} onChange={(e) => set("ssl_key_path", e.target.value)} placeholder="/etc/ssl/wildcard/privkey.pem" />
                    </div>
                  </>
                )}
              </div>
            )}

            {step === 3 && (
              <div className="grid grid-cols-1 gap-x-6 gap-y-1 text-sm sm:grid-cols-2">
                {[
                  ["Name", f.name],
                  ["Repository", f.repo_url],
                  ["Branch", f.branch],
                  ["Environment", f.environment || "none"],
                  ["Token", f.github_token ? "configured" : "none"],
                  ["Database", f.db_name || "auto"],
                  ["Domain", f.domain || "none"],
                  ["SSL", f.ssl_mode],
                  ["Env vars", `${parseEnv().length} defined`],
                ].map(([k, v]) => (
                  <div key={k} className="flex justify-between gap-4 border-b border-[var(--ds-border)]/60 py-2.5">
                    <span className="text-[var(--ds-muted)]">{k}</span>
                    <span className="max-w-[60%] truncate text-right text-[var(--ds-text)]">{v}</span>
                  </div>
                ))}
                <p className="pt-2 text-[13px] text-[var(--ds-muted)] sm:col-span-2">
                  The project will be created. You can deploy it from the project page.
                </p>
              </div>
            )}
          </DSCard>

          <div className="mt-6 flex justify-between">
            <DSButton
              variant="outline"
              data-testid="wizard-back-btn"
              icon={ChevronLeft}
              onClick={() => (step === 0 ? navigate("/projects") : setStep(step - 1))}
            >
              {step === 0 ? "Cancel" : "Back"}
            </DSButton>
            {step < 3 ? (
              <DSButton data-testid="wizard-next-btn" variant="primary" disabled={!canNext()} onClick={() => setStep(step + 1)}>
                Next <ChevronRight className="ml-1 h-4 w-4" />
              </DSButton>
            ) : (
              <DSButton data-testid="wizard-create-btn" variant="success" loading={saving} icon={saving ? undefined : Rocket} onClick={submit}>
                Create Project
              </DSButton>
            )}
          </div>
        </div>
      </div>
    </Layout>
  );
}
