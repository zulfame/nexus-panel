import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { Terminal, Loader2, Eye, EyeOff, User, Lock, Rocket, ShieldCheck, Activity, ArrowRight, Check } from "lucide-react";
import { useAuth } from "@/context/AuthContext";
import { useBranding, BrandName } from "@/context/BrandingContext";
import "@/styles/design-system.css";

const FEATURES = [
  { icon: Rocket, title: "One-click deploys", desc: "Pull from GitHub, auto-configure ports & rebuild." },
  { icon: ShieldCheck, title: "Nginx + SSL, automated", desc: "Reverse proxy and Let's Encrypt out of the box." },
  { icon: Activity, title: "Live logs & metrics", desc: "Stream build logs, watch CPU/RAM, open a web terminal." },
];

export default function Login() {
  const { login } = useAuth();
  const { branding } = useBranding();
  const navigate = useNavigate();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [showPass, setShowPass] = useState(false);
  const [remember, setRemember] = useState(true);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  const submit = async (e) => {
    e.preventDefault();
    setError("");
    setLoading(true);
    const res = await login(username, password, remember);
    setLoading(false);
    if (res.ok) navigate("/");
    else setError(res.error);
  };

  const Logo = ({ size = "h-10 w-10" }) =>
    branding.logo ? (
      <img src={branding.logo} alt="logo" className={`${size} rounded-lg object-contain`} />
    ) : (
      <div className={`flex ${size} items-center justify-center rounded-lg border border-[var(--ds-primary)]/30 bg-[var(--ds-primary)]/15`}>
        <Terminal className="h-1/2 w-1/2 text-[var(--ds-primary)]" strokeWidth={1.5} />
      </div>
    );

  return (
    <div className="ds-root grid min-h-screen grid-cols-1 bg-[var(--ds-page)] text-[var(--ds-text)] lg:grid-cols-2">
      {/* ---- Left: brand / marketing ---- */}
      <div className="relative hidden overflow-hidden lg:flex lg:flex-col lg:justify-between lg:p-12"
        style={{ background: "linear-gradient(150deg, color-mix(in srgb, var(--ds-primary) 22%, #0a0b0e) 0%, #08090c 55%, #06070a 100%)" }}>
        {/* decorative glows + grid */}
        <div className="pointer-events-none absolute -left-32 -top-32 h-96 w-96 rounded-full opacity-40 blur-[120px]" style={{ background: "var(--ds-primary)" }} />
        <div className="pointer-events-none absolute -bottom-40 -right-24 h-96 w-96 rounded-full opacity-25 blur-[130px]" style={{ background: "var(--ds-accent, #00d084)" }} />
        <div className="pointer-events-none absolute inset-0 opacity-[0.06]"
          style={{ backgroundImage: "linear-gradient(#fff 1px, transparent 1px), linear-gradient(90deg, #fff 1px, transparent 1px)", backgroundSize: "44px 44px" }} />

        <div className="relative z-10 flex items-center gap-3">
          <Logo />
          <div>
            <div className="text-lg font-bold tracking-tight text-white"><BrandName name={branding.system_name} /></div>
            <div className="text-[11px] uppercase tracking-[0.25em] text-white/45">{branding.tagline || "deploy control"}</div>
          </div>
        </div>

        <div className="relative z-10 max-w-md">
          <h1 className="text-4xl font-bold leading-tight tracking-tight text-white">
            Ship your stack,<br />own your server.
          </h1>
          <p className="mt-4 text-[15px] leading-relaxed text-white/55">
            A self-hosted mini-PaaS for FastAPI · MongoDB · React — deploys, SSL, and monitoring on your own VPS.
          </p>
          <div className="mt-10 space-y-5">
            {FEATURES.map((f) => (
              <div key={f.title} className="flex items-start gap-3.5">
                <div className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-white/10 bg-white/5">
                  <f.icon className="h-4 w-4 text-[var(--ds-primary)]" strokeWidth={1.75} />
                </div>
                <div>
                  <div className="text-sm font-semibold text-white">{f.title}</div>
                  <div className="text-[13px] text-white/45">{f.desc}</div>
                </div>
              </div>
            ))}
          </div>
        </div>

        <div className="relative z-10 text-[12px] text-white/35">
          © {new Date().getFullYear()} <BrandName name={branding.system_name} /> · Secure control panel
        </div>
      </div>

      {/* ---- Right: form ---- */}
      <div className="relative flex items-center justify-center px-6 py-12 sm:px-10">
        <div className="w-full max-w-sm animate-fade-up">
          {/* compact brand on mobile */}
          <div className="mb-8 flex items-center gap-3 lg:hidden">
            <Logo size="h-9 w-9" />
            <div>
              <div className="text-base font-bold tracking-tight"><BrandName name={branding.system_name} /></div>
              <div className="text-[10px] uppercase tracking-[0.25em] text-[var(--ds-muted)]">{branding.tagline || "deploy control"}</div>
            </div>
          </div>

          <div className="mb-7">
            <h2 className="text-2xl font-bold tracking-tight">Welcome back</h2>
            <p className="mt-1 text-[14px] text-[var(--ds-muted)]">Sign in to your control panel to continue.</p>
          </div>

          <form onSubmit={submit} className="space-y-4">
            <div className="space-y-1.5">
              <label htmlFor="username" className="text-[12px] font-medium uppercase tracking-wider text-[var(--ds-muted)]">Username</label>
              <div className="relative">
                <User className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[var(--ds-muted)]" strokeWidth={1.75} />
                <input
                  id="username"
                  data-testid="login-username-input"
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                  autoComplete="username"
                  placeholder="superadmin"
                  className="ds-field ds-transition h-11 w-full rounded-[var(--ds-radius-input)] border border-[var(--ds-border)] bg-[var(--ds-card)] pl-10 pr-3 text-[14px] text-[var(--ds-text)] outline-none placeholder:text-[var(--ds-muted)]/60 focus:border-[var(--ds-primary)] focus:ring-2 focus:ring-[var(--ds-primary)]/25"
                />
              </div>
            </div>

            <div className="space-y-1.5">
              <label htmlFor="password" className="text-[12px] font-medium uppercase tracking-wider text-[var(--ds-muted)]">Password</label>
              <div className="relative">
                <Lock className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[var(--ds-muted)]" strokeWidth={1.75} />
                <input
                  id="password"
                  data-testid="login-password-input"
                  type={showPass ? "text" : "password"}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  autoComplete="current-password"
                  placeholder="••••••••"
                  className="ds-field ds-transition h-11 w-full rounded-[var(--ds-radius-input)] border border-[var(--ds-border)] bg-[var(--ds-card)] pl-10 pr-11 text-[14px] text-[var(--ds-text)] outline-none placeholder:text-[var(--ds-muted)]/60 focus:border-[var(--ds-primary)] focus:ring-2 focus:ring-[var(--ds-primary)]/25"
                />
                <button
                  type="button"
                  data-testid="toggle-password-btn"
                  onClick={() => setShowPass((s) => !s)}
                  aria-label={showPass ? "Hide password" : "Show password"}
                  className="ds-transition absolute right-1.5 top-1/2 flex h-8 w-8 -translate-y-1/2 items-center justify-center rounded-md text-[var(--ds-muted)] hover:bg-[var(--ds-hover)] hover:text-[var(--ds-text)]"
                >
                  {showPass ? <EyeOff className="h-4 w-4" strokeWidth={1.75} /> : <Eye className="h-4 w-4" strokeWidth={1.75} />}
                </button>
              </div>
            </div>

            {error && (
              <div data-testid="login-error" className="rounded-[var(--ds-radius-input)] border border-[var(--ds-danger)]/40 bg-[var(--ds-danger)]/10 px-3 py-2 text-[13px] text-[var(--ds-danger)]">
                {error}
              </div>
            )}

            <label className="flex cursor-pointer select-none items-center gap-2.5 text-[13px] text-[var(--ds-muted)]" data-testid="remember-me-label">
              <button
                type="button"
                role="checkbox"
                aria-checked={remember}
                data-testid="remember-me-checkbox"
                onClick={() => setRemember((v) => !v)}
                className={`ds-transition flex h-4.5 w-4.5 shrink-0 items-center justify-center rounded-[5px] border ${remember ? "border-[var(--ds-primary)] bg-[var(--ds-primary)]" : "border-[var(--ds-border)] bg-transparent"}`}
                style={{ height: 18, width: 18 }}
              >
                {remember && <Check className="h-3 w-3 text-white" strokeWidth={3} />}
              </button>
              Keep me signed in for 30 days
            </label>

            <button
              type="submit"
              data-testid="login-submit-btn"
              disabled={loading}
              className="ds-transition group flex h-11 w-full items-center justify-center gap-2 rounded-[var(--ds-radius-btn)] bg-[var(--ds-primary)] text-[14px] font-semibold text-white hover:bg-[var(--ds-primary-hover)] disabled:opacity-60"
            >
              {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <>Sign in <ArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-0.5" /></>}
            </button>
          </form>

          <p className="mt-8 text-center text-[12px] text-[var(--ds-muted)]">
            managing FastAPI · MongoDB · React deployments
          </p>
        </div>
      </div>
    </div>
  );
}
