import { useCallback, useEffect, useState } from "react";
import { Search, RefreshCw, ChevronLeft, ChevronRight, ScrollText, ShieldCheck, Download } from "lucide-react";
import api from "@/lib/api";
import notify from "@/lib/notify";
import { Layout } from "@/components/Layout";
import "@/styles/design-system.css";
import { DSCard, DSButton, DSInput, DSIconButton, DSEmptyState } from "@/components/ds";

const PAGE_SIZE = 50;

const ACTION_COLORS = {
  "auth.login": "text-sky-400 border-sky-500/30 bg-sky-500/10",
  "project.create": "text-emerald-400 border-emerald-500/30 bg-emerald-500/10",
  "project.deploy": "text-emerald-400 border-emerald-500/30 bg-emerald-500/10",
  "project.rollback": "text-sky-400 border-sky-500/30 bg-sky-500/10",
  "project.delete": "text-red-400 border-red-500/30 bg-red-500/10",
  "user.create": "text-emerald-400 border-emerald-500/30 bg-emerald-500/10",
  "user.delete": "text-red-400 border-red-500/30 bg-red-500/10",
};
const badge = (a) => ACTION_COLORS[a] || "text-[var(--ds-text-secondary)] border-[var(--ds-border)] bg-[var(--ds-hover)]";

export default function Activity() {
  const [logs, setLogs] = useState([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(0);
  const [q, setQ] = useState("");
  const [loading, setLoading] = useState(false);

  const load = useCallback(async (pageArg = page) => {
    setLoading(true);
    try {
      const { data } = await api.get(
        `/audit?limit=${PAGE_SIZE}&skip=${pageArg * PAGE_SIZE}${q ? `&q=${encodeURIComponent(q)}` : ""}`
      );
      setLogs(data.items || []);
      setTotal(data.total || 0);
    } catch (e) {
      setLogs([]);
      setTotal(0);
    } finally {
      setLoading(false);
    }
  }, [q, page]);

  useEffect(() => { setPage(0); }, [q]);
  useEffect(() => { load(page); }, [load, page]);

  const [verifying, setVerifying] = useState(false);
  const verify = async () => {
    setVerifying(true);
    try {
      const { data } = await api.get("/audit/verify");
      if (data.ok) notify.success("Audit log verified", `Hash chain intact across ${data.checked} record(s).`);
      else notify.error("Tampering detected", `Chain broke at record #${data.broken_at}.`);
    } catch (e) {
      notify.error("Verification failed", "Could not verify the audit chain.");
    } finally {
      setVerifying(false);
    }
  };
  const exportLog = async (format) => {
    try {
      const { data } = await api.get(`/audit/export?format=${format}${q ? `&q=${encodeURIComponent(q)}` : ""}`, { responseType: "blob" });
      const url = URL.createObjectURL(new Blob([data]));
      const a = document.createElement("a");
      a.href = url;
      a.download = `audit-${new Date().toISOString().slice(0, 19).replace(/[:T]/g, "")}.${format}`;
      a.click();
      URL.revokeObjectURL(url);
      notify.success("Export started", `Downloading audit log as ${format.toUpperCase()}.`);
    } catch (e) {
      notify.error("Export failed", "Could not export the audit log.");
    }
  };

  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const from = total === 0 ? 0 : page * PAGE_SIZE + 1;
  const to = Math.min(total, (page + 1) * PAGE_SIZE);

  return (
    <Layout>
      <div className="min-h-screen">
        <header className="sticky top-14 z-20 flex flex-wrap items-center justify-between gap-3 border-b border-[var(--ds-border)] bg-[var(--ds-page)]/85 px-4 py-5 backdrop-blur-xl sm:px-8 lg:top-14">
          <div>
            <h1 className="text-[24px] font-bold tracking-tight text-[var(--ds-text)]">Activity</h1>
            <p className="mt-0.5 text-[13px] text-[var(--ds-muted)]">Audit log of every action across the panel</p>
          </div>
        </header>

        <div className="p-4 sm:p-6 lg:p-8">
          <div className="mb-4 flex items-center gap-2">
            <div className="relative max-w-md flex-1">
              <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[var(--ds-muted)]" />
              <DSInput
                value={q}
                onChange={(e) => setQ(e.target.value)}
                placeholder="Filter by actor, action or target…"
                className="pl-9"
                data-testid="audit-search"
              />
            </div>
            <DSIconButton icon={RefreshCw} onClick={() => load(page)} disabled={loading} data-testid="audit-refresh" />
            <DSButton variant="outline" size="sm" icon={ShieldCheck} loading={verifying} onClick={verify} data-testid="audit-verify">Verify</DSButton>
            <DSButton variant="outline" size="sm" icon={Download} onClick={() => exportLog("csv")} data-testid="audit-export-csv">CSV</DSButton>
            <DSButton variant="outline" size="sm" icon={Download} onClick={() => exportLog("json")} data-testid="audit-export-json">JSON</DSButton>
          </div>

          <DSCard>
            <div className="max-h-[calc(100vh-320px)] overflow-auto">
              <table className="w-full min-w-[560px] text-left text-sm">
                <thead className="sticky top-0 z-10 border-b border-[var(--ds-border)] bg-[var(--ds-card)] text-[12px] uppercase tracking-wider text-[var(--ds-muted)]">
                  <tr>
                    <th className="px-5 py-3 font-medium">Time</th>
                    <th className="px-5 py-3 font-medium">Actor</th>
                    <th className="px-5 py-3 font-medium">Action</th>
                    <th className="px-5 py-3 font-medium">Target</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[var(--ds-border)]/60" data-testid="audit-table">
                  {logs.length === 0 ? (
                    <tr><td colSpan={4} className="p-0">
                      <DSEmptyState icon={ScrollText} title="No activity yet" description="Actions across the panel will appear here." />
                    </td></tr>
                  ) : (
                    logs.map((l, i) => (
                      <tr key={i} className="ds-transition hover:bg-[var(--ds-hover)]" data-testid="audit-row">
                        <td className="whitespace-nowrap px-5 py-3 text-xs text-[var(--ds-muted)]">{new Date(l.ts).toLocaleString()}</td>
                        <td className="px-5 py-3 text-xs text-[var(--ds-text)]">{l.actor}</td>
                        <td className="px-5 py-3">
                          <span className={`rounded-md border px-2 py-0.5 font-mono text-[11px] ${badge(l.action)}`}>{l.action}</span>
                        </td>
                        <td className="px-5 py-3 text-xs text-[var(--ds-muted)]">{l.target || "—"}</td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </DSCard>

          <div className="mt-4 flex items-center justify-between text-[13px] text-[var(--ds-muted)]" data-testid="audit-pagination">
            <div data-testid="audit-range">{total === 0 ? "No records" : `Showing ${from}–${to} of ${total}`}</div>
            <div className="flex items-center gap-2">
              <DSButton variant="outline" size="sm" icon={ChevronLeft} disabled={page === 0 || loading} onClick={() => setPage((p) => Math.max(0, p - 1))} data-testid="audit-prev">Prev</DSButton>
              <span className="px-1" data-testid="audit-page-indicator">{page + 1} / {totalPages}</span>
              <DSButton variant="outline" size="sm" disabled={page + 1 >= totalPages || loading} onClick={() => setPage((p) => p + 1)} data-testid="audit-next">
                Next <ChevronRight className="h-3.5 w-3.5" />
              </DSButton>
            </div>
          </div>
        </div>
      </div>
    </Layout>
  );
}
