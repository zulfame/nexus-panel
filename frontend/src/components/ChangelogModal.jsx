import { useEffect, useMemo, useState } from "react";
import { Plus, Wrench, SlidersHorizontal, Search, Loader2, GitCommitVertical } from "lucide-react";
import api from "@/lib/api";
import { DSInput, DSSelect, DSModal } from "@/components/ds";

const SECTION_META = {
  Added: { icon: Plus, color: "var(--ds-success)" },
  Changed: { icon: SlidersHorizontal, color: "var(--ds-info)" },
  Optimized: { icon: SlidersHorizontal, color: "var(--ds-info)" },
  Fixed: { icon: Wrench, color: "var(--ds-warning)" },
};

export function ChangelogModal({ open, onOpenChange }) {
  const [releases, setReleases] = useState([]);
  const [loading, setLoading] = useState(false);
  const [q, setQ] = useState("");
  const [cat, setCat] = useState("ALL");

  useEffect(() => {
    if (!open || releases.length) return;
    setLoading(true);
    api.get("/system/changelog")
      .then(({ data }) => setReleases(data.releases || []))
      .catch(() => setReleases([]))
      .finally(() => setLoading(false));
  }, [open, releases.length]);

  const categories = useMemo(() => {
    const set = new Set();
    releases.forEach((r) => r.sections.forEach((s) => set.add(s.type)));
    return ["ALL", ...Array.from(set)];
  }, [releases]);

  const filtered = useMemo(() => {
    const term = q.trim().toLowerCase();
    return releases
      .map((r) => {
        const sections = r.sections
          .filter((s) => cat === "ALL" || s.type === cat)
          .map((s) => ({ ...s, items: term ? s.items.filter((i) => i.toLowerCase().includes(term)) : s.items }))
          .filter((s) => s.items.length > 0);
        return { ...r, sections };
      })
      .filter((r) => r.sections.length > 0 || (term && r.version.toLowerCase().includes(term)));
  }, [releases, q, cat]);

  return (
    <DSModal
      open={open} onOpenChange={onOpenChange}
      title="Change Logs" icon={GitCommitVertical} size="lg"
      data-testid="changelog-modal"
    >
        <div className="space-y-4">
          <p className="text-[13px] text-[var(--ds-muted)]">Everything added, optimized and fixed in Nexus Panel.</p>
          <div className="flex flex-col gap-2 sm:flex-row">
            <div className="relative flex-1">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[var(--ds-muted)]" />
              <DSInput data-testid="changelog-search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search updates…" className="pl-9" />
            </div>
            <DSSelect data-testid="changelog-filter" value={cat} onChange={(e) => setCat(e.target.value)} className="sm:w-40">
              {categories.map((c) => <option key={c} value={c}>{c === "ALL" ? "All" : c}</option>)}
            </DSSelect>
          </div>

          {loading ? (
            <div className="flex items-center justify-center py-12 text-[var(--ds-muted)]"><Loader2 className="h-5 w-5 animate-spin" /></div>
          ) : filtered.length === 0 ? (
            <div className="py-12 text-center text-[13px] text-[var(--ds-muted)]" data-testid="changelog-empty">No matching updates.</div>
          ) : (
            <div className="relative space-y-6 pl-6">
              <span className="absolute left-[5px] top-2 bottom-2 w-px bg-[var(--ds-border)]" aria-hidden />
              {filtered.map((r, idx) => (
                <div key={r.version} className="relative" data-testid={`changelog-release-${r.version}`}>
                  <span
                    className="absolute -left-6 top-1.5 h-3 w-3 rounded-full border-2"
                    style={{ borderColor: idx === 0 ? "var(--ds-success)" : "var(--ds-border)", background: "var(--ds-card)" }}
                    aria-hidden
                  />
                  <div className="rounded-[var(--ds-radius-card)] border border-[var(--ds-border)] bg-[var(--ds-card)] p-4">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="text-[15px] font-bold text-[var(--ds-text)]">v{r.version}</span>
                      {idx === 0 && (
                        <span className="rounded-full bg-[var(--ds-success)]/15 px-2 py-0.5 text-[11px] font-medium text-[var(--ds-success)]">New Version</span>
                      )}
                    </div>
                    <div className="mt-0.5 text-[12px] text-[var(--ds-muted)]">{r.date}{r.title ? ` · ${r.title}` : ""}</div>

                    {r.sections.map((s) => {
                      const meta = SECTION_META[s.type] || { icon: Plus, color: "var(--ds-muted)" };
                      const Icon = meta.icon;
                      return (
                        <div key={s.type} className="mt-4">
                          <div className="mb-2 flex items-center gap-2 text-[13px] font-semibold text-[var(--ds-text)]">
                            <span className="flex h-5 w-5 items-center justify-center rounded-md" style={{ background: `${meta.color}22`, color: meta.color }}>
                              <Icon className="h-3 w-3" />
                            </span>
                            {s.type}
                          </div>
                          <ul className="space-y-1.5">
                            {s.items.map((it, i) => (
                              <li key={i} className="flex gap-2 text-[13px] leading-relaxed text-[var(--ds-muted)]">
                                <span className="mt-1.5 h-1 w-1 shrink-0 rounded-full bg-[var(--ds-muted)]" />
                                <span>{it}</span>
                              </li>
                            ))}
                          </ul>
                        </div>
                      );
                    })}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
    </DSModal>
  );
}
