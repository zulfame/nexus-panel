import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { Terminal, Loader2 } from "lucide-react";
import { useAuth } from "@/context/AuthContext";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

const BG =
  "https://images.pexels.com/photos/37730211/pexels-photo-37730211.jpeg?auto=compress&cs=tinysrgb&dpr=2&h=650&w=940";

export default function Login() {
  const { login } = useAuth();
  const navigate = useNavigate();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  const submit = async (e) => {
    e.preventDefault();
    setError("");
    setLoading(true);
    const res = await login(username, password);
    setLoading(false);
    if (res.ok) navigate("/");
    else setError(res.error);
  };

  return (
    <div className="relative flex min-h-screen items-center justify-center overflow-hidden bg-black">
      <div
        className="absolute inset-0 bg-cover bg-center"
        style={{ backgroundImage: `url(${BG})` }}
      />
      <div className="absolute inset-0 bg-black/85" />
      <div className="noise-overlay absolute inset-0" />

      <div className="relative z-10 w-full max-w-md animate-fade-up px-6">
        <div className="border border-white/10 bg-[#0a0a0a]/90 p-8 backdrop-blur-xl">
          <div className="mb-8 flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center border border-status-running/50 bg-status-running/10">
              <Terminal className="h-5 w-5 text-status-running" />
            </div>
            <div>
              <div className="font-heading text-lg font-bold tracking-tight">DEPLOY PANEL</div>
              <div className="font-mono text-[11px] text-muted-foreground">
                self-hosted control panel
              </div>
            </div>
          </div>

          <form onSubmit={submit} className="space-y-5">
            <div className="space-y-2">
              <Label htmlFor="username" className="font-mono text-xs uppercase tracking-wider text-muted-foreground">
                Username
              </Label>
              <Input
                id="username"
                data-testid="login-username-input"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                autoComplete="username"
                className="border-white/20 bg-transparent font-mono focus-visible:ring-1 focus-visible:ring-white"
                placeholder="superadmin"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="password" className="font-mono text-xs uppercase tracking-wider text-muted-foreground">
                Password
              </Label>
              <Input
                id="password"
                data-testid="login-password-input"
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                autoComplete="current-password"
                className="border-white/20 bg-transparent font-mono focus-visible:ring-1 focus-visible:ring-white"
                placeholder="••••••••"
              />
            </div>

            {error && (
              <div data-testid="login-error" className="border border-status-error/40 bg-status-error/10 px-3 py-2 font-mono text-xs text-status-error">
                {error}
              </div>
            )}

            <Button
              type="submit"
              data-testid="login-submit-btn"
              disabled={loading}
              className="w-full bg-white text-black hover:bg-white/85"
            >
              {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : "Sign in"}
            </Button>
          </form>
        </div>
        <p className="mt-4 text-center font-mono text-[11px] text-muted-foreground">
          managing FastAPI · MongoDB · React deployments
        </p>
      </div>
    </div>
  );
}
