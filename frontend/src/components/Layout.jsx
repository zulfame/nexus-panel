import { NavLink, useNavigate } from "react-router-dom";
import { LayoutDashboard, Boxes, Settings, LogOut, Terminal, Server } from "lucide-react";
import { useAuth } from "@/context/AuthContext";

const NAV = [
  { to: "/", label: "Dashboard", icon: LayoutDashboard, testid: "nav-dashboard", end: true },
  { to: "/projects", label: "Projects", icon: Boxes, testid: "nav-projects" },
  { to: "/settings", label: "Settings", icon: Settings, testid: "nav-settings" },
];

export function Layout({ children }) {
  const { user, logout } = useAuth();
  const navigate = useNavigate();

  return (
    <div className="flex min-h-screen bg-background text-foreground">
      <aside className="fixed inset-y-0 left-0 z-30 flex w-[260px] flex-col border-r border-border bg-[#080808]">
        <div className="flex items-center gap-2.5 border-b border-border px-5 py-5">
          <div className="flex h-8 w-8 items-center justify-center border border-status-running/50 bg-status-running/10">
            <Terminal className="h-4 w-4 text-status-running" />
          </div>
          <div className="leading-tight">
            <div className="font-heading text-sm font-bold tracking-tight">DEPLOY PANEL</div>
            <div className="font-mono text-[10px] text-muted-foreground">emergent · vps</div>
          </div>
        </div>

        <nav className="flex-1 px-3 py-4">
          {NAV.map((n) => (
            <NavLink
              key={n.to}
              to={n.to}
              end={n.end}
              data-testid={n.testid}
              className={({ isActive }) =>
                `mb-1 flex items-center gap-3 px-3 py-2.5 text-sm transition-colors ${
                  isActive
                    ? "bg-white text-black font-medium"
                    : "text-muted-foreground hover:bg-white/5 hover:text-foreground"
                }`
              }
            >
              <n.icon className="h-4 w-4" />
              {n.label}
            </NavLink>
          ))}
        </nav>

        <div className="border-t border-border p-3">
          <div className="mb-2 flex items-center gap-2 px-2 py-1.5">
            <Server className="h-4 w-4 text-muted-foreground" />
            <span className="font-mono text-xs text-muted-foreground">
              {user?.username || "admin"}
            </span>
          </div>
          <button
            data-testid="logout-btn"
            onClick={() => {
              logout();
              navigate("/login");
            }}
            className="flex w-full items-center gap-3 px-3 py-2.5 text-sm text-muted-foreground transition-colors hover:bg-status-error/10 hover:text-status-error"
          >
            <LogOut className="h-4 w-4" />
            Sign out
          </button>
        </div>
      </aside>

      <main className="ml-[260px] flex-1">{children}</main>
    </div>
  );
}

export function PageHeader({ title, subtitle, actions }) {
  return (
    <header className="sticky top-0 z-20 flex items-center justify-between border-b border-border bg-background/95 px-8 py-5 backdrop-blur">
      <div>
        <h1 className="font-heading text-2xl font-bold tracking-tight">{title}</h1>
        {subtitle && <p className="mt-0.5 text-sm text-muted-foreground">{subtitle}</p>}
      </div>
      <div className="flex items-center gap-2">{actions}</div>
    </header>
  );
}
