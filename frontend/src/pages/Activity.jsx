import { useCallback, useEffect, useState } from "react";
import { ScrollText, Search, Loader2, RefreshCw } from "lucide-react";
import api from "@/lib/api";
import { Layout, PageHeader } from "@/components/Layout";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";

const ACTION_COLORS = {
  "auth.login": "text-sky-400 border-sky-500/30 bg-sky-500/10",
  "project.create": "text-emerald-400 border-emerald-500/30 bg-emerald-500/10",
  "project.deploy": "text-emerald-400 border-emerald-500/30 bg-emerald-500/10",
  "project.delete": "text-red-400 border-red-500/30 bg-red-500/10",
  "user.create": "text-emerald-400 border-emerald-500/30 bg-emerald-500/10",
  "user.delete": "text-red-400 border-red-500/30 bg-red-500/10",
};
const badge = (a) => ACTION_COLORS[a] || "text-zinc-300 border-white/15 bg-white/5";

export default function Activity() {
  const [logs, setLogs] = useState([]);
  const [q, setQ] = useState("");
  const [loading, setLoading] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const { data } = await api.get(`/audit?limit=200${q ? `&q=${encodeURIComponent(q)}` : ""}`);
      setLogs(data);
    } catch (e) {
      setLogs([]);
    } finally {
      setLoading(false);
    }
  }, [q]);

  useEffect(() => { load(); }, [load]);

  return (
    <Layout>
      <PageHeader title="Activity" subtitle="Audit log of every action across the panel" />
      <div className="p-8">
        <div className="mb-4 flex items-center gap-2">
          <div className="relative flex-1 max-w-md">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Filter by actor, action or target…"
              className="border-white/20 bg-transparent pl-9 focus-visible:ring-1 focus-visible:ring-white"
              data-testid="audit-search"
            />
          </div>
          <Button variant="outline" onClick={load} disabled={loading} className="h-9 border-white/15 bg-transparent" data-testid="audit-refresh">
            {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
          </Button>
        </div>

        <div className="overflow-hidden rounded-sm border border-border bg-card">
          <table className="w-full text-left text-sm">
            <thead className="border-b border-border text-xs uppercase tracking-wider text-muted-foreground">
              <tr>
                <th className="px-5 py-3 font-medium">Time</th>
                <th className="px-5 py-3 font-medium">Actor</th>
                <th className="px-5 py-3 font-medium">Action</th>
                <th className="px-5 py-3 font-medium">Target</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border/60" data-testid="audit-table">
              {logs.length === 0 ? (
                <tr><td colSpan={4} className="px-5 py-10 text-center text-muted-foreground">No activity yet.</td></tr>
              ) : (
                logs.map((l, i) => (
                  <tr key={i} className="hover:bg-white/[0.02]" data-testid="audit-row">
                    <td className="whitespace-nowrap px-5 py-3 font-mono text-xs text-muted-foreground">{new Date(l.ts).toLocaleString()}</td>
                    <td className="px-5 py-3 font-mono text-xs">{l.actor}</td>
                    <td className="px-5 py-3">
                      <span className={`rounded-sm border px-2 py-0.5 font-mono text-[11px] ${badge(l.action)}`}>{l.action}</span>
                    </td>
                    <td className="px-5 py-3 font-mono text-xs text-muted-foreground">{l.target || "—"}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
    </Layout>
  );
}
