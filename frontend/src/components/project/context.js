import { createContext, useContext } from "react";

export const ProjectDetailContext = createContext(null);
export const useProjectCtx = () => useContext(ProjectDetailContext);

export const field = "ds-field bg-transparent focus-visible:ring-1 focus-visible:ring-[var(--ds-primary)]";
export const lbl = "text-xs uppercase tracking-wider text-muted-foreground";

export function timeAgo(dateStr) {
  if (!dateStr) return null;
  const d = new Date(dateStr);
  if (isNaN(d)) return null;
  const s = Math.floor((Date.now() - d.getTime()) / 1000);
  if (s < 60) return "just now";
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const days = Math.floor(h / 24);
  return `${days}d ago`;
}
