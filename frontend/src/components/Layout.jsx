import { useEffect, useRef, useState } from "react";
import { NavLink, useNavigate } from "react-router-dom";
import { motion } from "framer-motion";
import { LayoutGrid, Boxes, Settings, LogOut, Terminal, User, SquareTerminal, ScrollText, Menu, X, Sun, Moon, Container, Server as ServerIcon } from "lucide-react";
import { useAuth } from "@/context/AuthContext";
import { useBranding, BrandName } from "@/context/BrandingContext";
import { useDsTheme } from "@/lib/dsTheme";
import { PanelActions } from "@/components/PanelActions";
import { Footer } from "@/components/Footer";
import api from "@/lib/api";
import "@/styles/design-system.css";

const NAV = [
  { to: "/", label: "Overview", icon: LayoutGrid, testid: "nav-dashboard", end: true },
  { to: "/projects", label: "Projects", icon: Boxes, testid: "nav-projects" },
  { to: "/terminal", label: "Terminal", icon: SquareTerminal, testid: "nav-terminal" },
  { to: "/activity", label: "Activity", icon: ScrollText, testid: "nav-activity" },
  { to: "/settings", label: "Settings", icon: Settings, testid: "nav-settings" },
];

export function Layout({ children }) {
  const { user, logout } = useAuth();
  const { branding } = useBranding();
  const navigate = useNavigate();
  const [mobileOpen, setMobileOpen] = useState(false);
  const { isLight, toggle: toggleTheme } = useDsTheme();
  const touchRef = useRef(null);
  const [panel, setPanel] = useState(null);

  useEffect(() => {
    api.get("/system/panel-info").then(({ data }) => setPanel(data)).catch(() => {});
  }, []);

  const onTouchStart = (e) => {
    const t = e.touches[0];
    touchRef.current = { x: t.clientX, y: t.clientY };
  };
  const onTouchEnd = (e) => {
    const start = touchRef.current;
    touchRef.current = null;
    if (!start) return;
    const t = e.changedTouches[0];
    const dx = t.clientX - start.x;
    const dy = t.clientY - start.y;
    if (Math.abs(dx) < 60 || Math.abs(dy) > 45) return; // horizontal swipe only
    if (dx > 0 && !mobileOpen && start.x < 40) setMobileOpen(true); // open from left edge
    else if (dx < 0 && mobileOpen) setMobileOpen(false); // swipe left to close
  };

  const BrandLogo = () =>
    branding.logo ? (
      <img src={branding.logo} alt="logo" className="h-8 w-8 rounded-sm object-contain" />
    ) : (
      <div className="flex h-8 w-8 items-center justify-center rounded-sm border border-[var(--ds-primary)]/30 bg-[var(--ds-primary)]/10">
        <Terminal className="h-4 w-4 text-[var(--ds-primary)]" strokeWidth={1.5} />
      </div>
    );

  return (
    <div className="ds-root flex min-h-screen bg-background text-foreground" onTouchStart={onTouchStart} onTouchEnd={onTouchEnd}>
      {/* Mobile backdrop */}
      {mobileOpen && (
        <div
          data-testid="sidebar-backdrop"
          onClick={() => setMobileOpen(false)}
          className="fixed inset-0 z-40 bg-black/60 backdrop-blur-sm lg:hidden"
        />
      )}

      <aside
        data-testid="sidebar"
        className={`fixed inset-y-0 left-0 z-50 flex w-64 flex-col border-r border-border bg-background transition-transform duration-200 ease-out lg:translate-x-0 ${
          mobileOpen ? "translate-x-0" : "-translate-x-full"
        }`}
      >
        <div className="flex h-16 items-center justify-between gap-2.5 border-b border-border px-5">
          <div className="flex items-center gap-2.5">
            <BrandLogo />
            <div className="leading-tight">
              <div className="text-sm font-bold tracking-tight"><BrandName name={branding.system_name} /></div>
              <div className="text-[10px] uppercase tracking-[0.2em] text-muted-foreground">{branding.tagline || "deploy control"}</div>
            </div>
          </div>
          <button
            data-testid="sidebar-close-btn"
            onClick={() => setMobileOpen(false)}
            className="text-muted-foreground hover:text-foreground lg:hidden"
          >
            <X className="h-5 w-5" />
          </button>
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
              onClick={() => setMobileOpen(false)}
              className={({ isActive }) =>
                `group relative mb-1 flex items-center gap-3 rounded-sm px-3 py-2 text-sm transition-colors ${
                  isActive
                    ? "bg-[var(--ds-hover)] text-foreground before:absolute before:left-0 before:top-2 before:bottom-2 before:w-[2px] before:rounded-r-full before:bg-[var(--ds-primary)]"
                    : "text-muted-foreground hover:bg-[var(--ds-hover)] hover:text-foreground"
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
            <div className="flex h-7 w-7 items-center justify-center rounded-sm bg-[var(--ds-hover)]">
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

      <main className="flex min-w-0 flex-1 flex-col lg:ml-64">
        {/* Global sticky navbar */}
        <header
          data-testid="app-navbar"
          className="sticky top-0 z-30 flex h-14 items-center justify-between gap-3 border-b border-border bg-background/95 px-4 backdrop-blur-xl sm:px-6"
        >
          <div className="flex min-w-0 items-center gap-3">
            <button
              data-testid="sidebar-open-btn"
              onClick={() => setMobileOpen(true)}
              className="text-muted-foreground hover:text-foreground lg:hidden"
            >
              <Menu className="h-5 w-5" />
            </button>
            <div className="flex min-w-0 items-center gap-2 lg:hidden">
              <BrandLogo />
              <span className="min-w-0 truncate text-sm font-bold tracking-tight"><BrandName name={branding.system_name} /></span>
            </div>
            <div className="hidden min-w-0 items-center gap-4 lg:flex" data-testid="navbar-system-info">
              <span className="flex items-center gap-1.5 text-[13px] text-muted-foreground">
                <ServerIcon className="h-4 w-4" strokeWidth={1.5} />
                <span className="max-w-[220px] truncate" title={panel?.server_os}>{panel?.server_os || "—"}</span>
              </span>
              <span className="h-4 w-px bg-border" />
              <span className="flex items-center gap-1.5 text-[13px] text-[var(--ds-success)]">
                <span className="h-1.5 w-1.5 rounded-full bg-[var(--ds-success)]" /> Operational
              </span>
              <span className="flex items-center gap-1.5 text-[13px]">
                <Container className="h-4 w-4 text-muted-foreground" strokeWidth={1.5} />
                <span className={panel?.docker ? "text-[var(--ds-success)]" : "text-muted-foreground"}>{panel?.docker ? "Docker Running" : "Docker Off"}</span>
              </span>
            </div>
          </div>
          <div className="flex shrink-0 items-center gap-1">
            <button
              data-testid="theme-toggle-btn"
              onClick={toggleTheme}
              className="ds-transition flex items-center rounded-[var(--ds-radius-btn)] p-2 text-muted-foreground hover:bg-[var(--ds-hover)] hover:text-foreground"
              title={isLight ? "Dark mode" : "Light mode"}
            >
              {isLight ? <Moon className="h-4 w-4" strokeWidth={1.75} /> : <Sun className="h-4 w-4" strokeWidth={1.75} />}
            </button>
            <span className="h-4 w-px bg-border" />
            <PanelActions version={panel?.version} />
          </div>
        </header>

        <motion.div
          className="flex min-w-0 flex-1 flex-col"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ duration: 0.25, ease: "easeOut" }}
        >
          <div className="flex-1">{children}</div>
          <Footer panel={panel} />
        </motion.div>
      </main>
    </div>
  );
}

export function PageHeader({ title, subtitle, actions }) {
  return (
    <header className="sticky top-14 z-20 flex flex-wrap items-center justify-between gap-3 border-b border-border bg-background/80 px-4 py-4 backdrop-blur-xl sm:px-8 lg:top-14">
      <div className="min-w-0">
        <h1 className="truncate text-xl font-bold tracking-tight sm:text-2xl">{title}</h1>
        {subtitle && <p className="mt-0.5 text-sm text-muted-foreground">{subtitle}</p>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </header>
  );
}
