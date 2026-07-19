import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { toast } from "sonner";
import { Github, Settings2, Globe, Rocket, ChevronLeft, ChevronRight, Loader2 } from "lucide-react";
import api, { apiError } from "@/lib/api";
import { Layout, PageHeader } from "@/components/Layout";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

const STEPS = [
  { id: 0, label: "Repository", icon: Github },
  { id: 1, label: "Build Config", icon: Settings2 },
  { id: 2, label: "Domain & SSL", icon: Globe },
  { id: 3, label: "Review", icon: Rocket },
];

const field = "border-white/20 bg-transparent font-mono focus-visible:ring-1 focus-visible:ring-white";
const lbl = "font-mono text-xs uppercase tracking-wider text-muted-foreground";

export default function AddProject() {
  const navigate = useNavigate();
  const [step, setStep] = useState(0);
  const [saving, setSaving] = useState(false);
  const [f, setF] = useState({
    name: "",
    repo_url: "",
    branch: "main",
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
      toast.success("Project created");
      navigate(`/projects/${data.id}`);
    } catch (e) {
      toast.error(apiError(e));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Layout>
      <PageHeader title="New Project" subtitle="Pull from GitHub and configure deployment" />
      <div className="max-w-3xl p-8">
        {/* stepper */}
        <div className="mb-8 flex items-center">
          {STEPS.map((s, i) => (
            <div key={s.id} className="flex flex-1 items-center">
              <div className="flex items-center gap-2">
                <div
                  className={`flex h-8 w-8 items-center justify-center border ${
                    i <= step ? "border-status-running bg-status-running/10 text-status-running" : "border-border text-muted-foreground"
                  }`}
                >
                  <s.icon className="h-4 w-4" />
                </div>
                <span className={`hidden font-mono text-xs sm:block ${i <= step ? "text-foreground" : "text-muted-foreground"}`}>
                  {s.label}
                </span>
              </div>
              {i < STEPS.length - 1 && <div className={`mx-3 h-px flex-1 ${i < step ? "bg-status-running" : "bg-border"}`} />}
            </div>
          ))}
        </div>

        <div className="border border-border bg-card p-6">
          {step === 0 && (
            <div className="space-y-5">
              <div className="space-y-2">
                <Label className={lbl}>Project Name</Label>
                <Input data-testid="wizard-name-input" className={field} value={f.name} onChange={(e) => set("name", e.target.value)} placeholder="My App One" />
              </div>
              <div className="space-y-2">
                <Label className={lbl}>GitHub Repository URL</Label>
                <Input data-testid="wizard-repo-input" className={field} value={f.repo_url} onChange={(e) => set("repo_url", e.target.value)} placeholder="https://github.com/user/repo.git" />
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label className={lbl}>Branch</Label>
                  <Input data-testid="wizard-branch-input" className={field} value={f.branch} onChange={(e) => set("branch", e.target.value)} />
                </div>
                <div className="space-y-2">
                  <Label className={lbl}>Personal Access Token (private repo)</Label>
                  <Input data-testid="wizard-token-input" type="password" className={field} value={f.github_token} onChange={(e) => set("github_token", e.target.value)} placeholder="ghp_…" />
                </div>
              </div>
            </div>
          )}

          {step === 1 && (
            <div className="space-y-5">
              <div className="space-y-2">
                <Label className={lbl}>Database Name (MongoDB)</Label>
                <Input data-testid="wizard-db-input" className={field} value={f.db_name} onChange={(e) => set("db_name", e.target.value)} placeholder="auto: <slug>_db" />
              </div>
              <div className="space-y-2">
                <Label className={lbl}>Backend Environment Variables (KEY=VALUE per line)</Label>
                <textarea
                  data-testid="wizard-env-input"
                  className="min-h-[160px] w-full border border-white/20 bg-transparent p-3 font-mono text-sm focus:outline-none focus:ring-1 focus:ring-white"
                  value={f.env_text}
                  onChange={(e) => set("env_text", e.target.value)}
                  placeholder={"STRIPE_KEY=sk_live_xxx\nOPENAI_KEY=sk-xxx"}
                />
                <p className="font-mono text-[11px] text-muted-foreground">
                  Ports are auto-assigned. MONGO_URL & DB_NAME are injected automatically.
                </p>
              </div>
            </div>
          )}

          {step === 2 && (
            <div className="space-y-5">
              <div className="space-y-2">
                <Label className={lbl}>Domain / Subdomain</Label>
                <Input data-testid="wizard-domain-input" className={field} value={f.domain} onChange={(e) => set("domain", e.target.value)} placeholder="app1.yourdomain.com" />
              </div>
              <div className="space-y-2">
                <Label className={lbl}>SSL Mode</Label>
                <Select value={f.ssl_mode} onValueChange={(v) => set("ssl_mode", v)}>
                  <SelectTrigger data-testid="wizard-ssl-select" className={field}><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="letsencrypt">Let's Encrypt (auto)</SelectItem>
                    <SelectItem value="custom">Custom certificate (wildcard)</SelectItem>
                    <SelectItem value="none">None (HTTP only)</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              {f.ssl_mode === "letsencrypt" && (
                <div className="space-y-2">
                  <Label className={lbl}>Email (for Let's Encrypt)</Label>
                  <Input data-testid="wizard-ssl-email-input" className={field} value={f.ssl_email} onChange={(e) => set("ssl_email", e.target.value)} placeholder="you@example.com" />
                </div>
              )}
              {f.ssl_mode === "custom" && (
                <div className="grid grid-cols-1 gap-4">
                  <div className="space-y-2">
                    <Label className={lbl}>Certificate Path (fullchain)</Label>
                    <Input data-testid="wizard-cert-input" className={field} value={f.ssl_cert_path} onChange={(e) => set("ssl_cert_path", e.target.value)} placeholder="/etc/ssl/wildcard/fullchain.pem" />
                  </div>
                  <div className="space-y-2">
                    <Label className={lbl}>Private Key Path</Label>
                    <Input data-testid="wizard-key-input" className={field} value={f.ssl_key_path} onChange={(e) => set("ssl_key_path", e.target.value)} placeholder="/etc/ssl/wildcard/privkey.pem" />
                  </div>
                </div>
              )}
            </div>
          )}

          {step === 3 && (
            <div className="space-y-3 font-mono text-sm">
              {[
                ["Name", f.name],
                ["Repository", f.repo_url],
                ["Branch", f.branch],
                ["Token", f.github_token ? "configured" : "none"],
                ["Database", f.db_name || "auto"],
                ["Domain", f.domain || "none"],
                ["SSL", f.ssl_mode],
                ["Env vars", `${parseEnv().length} defined`],
              ].map(([k, v]) => (
                <div key={k} className="flex justify-between border-b border-border/60 py-2">
                  <span className="text-muted-foreground">{k}</span>
                  <span className="max-w-[60%] truncate text-right">{v}</span>
                </div>
              ))}
              <p className="pt-2 text-xs text-muted-foreground">
                The project will be created. You can deploy it from the project page.
              </p>
            </div>
          )}
        </div>

        <div className="mt-6 flex justify-between">
          <Button
            variant="outline"
            data-testid="wizard-back-btn"
            className="border-white/20 bg-transparent"
            onClick={() => (step === 0 ? navigate("/projects") : setStep(step - 1))}
          >
            <ChevronLeft className="mr-1 h-4 w-4" /> {step === 0 ? "Cancel" : "Back"}
          </Button>
          {step < 3 ? (
            <Button data-testid="wizard-next-btn" disabled={!canNext()} className="bg-white text-black hover:bg-white/85" onClick={() => setStep(step + 1)}>
              Next <ChevronRight className="ml-1 h-4 w-4" />
            </Button>
          ) : (
            <Button data-testid="wizard-create-btn" disabled={saving} className="bg-status-running text-black hover:bg-status-running/85" onClick={submit}>
              {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <><Rocket className="mr-1.5 h-4 w-4" /> Create Project</>}
            </Button>
          )}
        </div>
      </div>
    </Layout>
  );
}
