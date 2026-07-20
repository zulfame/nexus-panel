import { NavLink, useNavigate } from "react-router-dom";
import { motion } from "framer-motion";
import { LayoutDashboard, Boxes, Settings, LogOut, Terminal, User, SquareTerminal, ScrollText } from "lucide-react";
import { useAuth } from "@/context/AuthContext";
import { useBranding, BrandName } from "@/context/BrandingContext";

const NAV = [
  { to: "/", label: "Dashboard", icon: LayoutDashboard, testid: "nav-dashboard", end: true },
  { to: "/projects", label: "Projects", icon: Boxes, testid: "nav-projects" },
  { to: "/terminal", label: "Terminal", icon: SquareTerminal, testid: "nav-terminal" },
  { to: "/activity", label: "Activity", icon: ScrollText, testid: "nav-activity" },
  { to: "/settings", label: "Settings", icon: Settings, testid: "nav-settings" },
];

export function Layout({ children }) {
  const { user, logout } = useAuth();
  const { branding } = useBranding();
  const navigate = useNavigate();

  return (
    <div className="flex min-h-screen bg-background text-foreground">
      <aside className="fixed inset-y-0 left-0 z-30 flex w-64 flex-col border-r border-border bg-background">
        <div className="flex h-16 items-center gap-2.5 border-b border-border px-5">
          {branding.logo ? (
            <img src={branding.logo} alt="logo" className="h-8 w-8 rounded-sm object-contain" />
          ) : (
            <div className="flex h-8 w-8 items-center justify-center rounded-sm border border-emerald-500/30 bg-emerald-500/10">
              <Terminal className="h-4 w-4 text-emerald-400" strokeWidth={1.5} />
            </div>
          )}
          <div className="leading-tight">
            <div className="text-sm font-bold tracking-tight"><BrandName name={branding.system_name} /></div>
            <div className="text-[10px] uppercase tracking-[0.2em] text-muted-foreground">{branding.tagline || "deploy control"}</div>
          </div>
        </div>

        <nav className="flex-1 px-3 py-4">
          <div className="mb-2 px-3 text-[10px] font-bold uppercase tracking-[0.2em] text-muted-foreground/60">
            Menu
          </div>
          {NAV.map((n) => (
            <NavLink
              key={n.to}
              to={n.to}
              end={n.end}
              data-testid={n.testid}
              className={({ isActive }) =>
                `group relative mb-1 flex items-center gap-3 rounded-sm px-3 py-2 text-sm transition-colors ${
                  isActive
                    ? "bg-white/5 text-foreground before:absolute before:left-0 before:top-2 before:bottom-2 before:w-[2px] before:rounded-r-full before:bg-emerald-400"
                    : "text-muted-foreground hover:bg-white/5 hover:text-foreground"
                }`
              }
            >
              <n.icon className="h-4 w-4" strokeWidth={1.5} />
              {n.label}
            </NavLink>
          ))}
        </nav>

        <div className="border-t border-border p-3">
          <div className="mb-2 flex items-center gap-2.5 rounded-sm border border-border/60 bg-card px-3 py-2">
            <div className="flex h-7 w-7 items-center justify-center rounded-sm bg-white/5">
              <User className="h-3.5 w-3.5 text-muted-foreground" strokeWidth={1.5} />
            </div>
            <div className="min-w-0 leading-tight">
              <div className="truncate text-xs font-medium">{user?.username || "admin"}</div>
              <div className="truncate text-[10px] text-muted-foreground">{user?.email || "administrator"}</div>
            </div>
          </div>
          <button
            data-testid="logout-btn"
            onClick={() => {
              logout();
              navigate("/login");
            }}
            className="flex w-full items-center gap-3 rounded-sm px-3 py-2 text-sm text-muted-foreground transition-colors hover:bg-red-500/10 hover:text-red-400"
          >
            <LogOut className="h-4 w-4" strokeWidth={1.5} />
            Sign out
          </button>
        </div>
      </aside>

      <main className="ml-64 flex-1">
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ duration: 0.25, ease: "easeOut" }}
        >
          {children}
        </motion.div>
      </main>
    </div>
  );
}

export function PageHeader({ title, subtitle, actions }) {
  return (
    <header className="sticky top-0 z-20 flex items-center justify-between border-b border-border bg-background/80 px-8 py-4 backdrop-blur-xl">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">{title}</h1>
        {subtitle && <p className="mt-0.5 text-sm text-muted-foreground">{subtitle}</p>}
      </div>
      <div className="flex items-center gap-2">{actions}</div>
    </header>
  );
}
