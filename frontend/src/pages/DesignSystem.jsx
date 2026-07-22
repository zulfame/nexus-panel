import { useState } from "react";
import { Layout } from "@/components/Layout";
import "@/styles/design-system.css";
import {
  DSButton, DSIconButton, DSBadge, DSCard, DSStatCard, DSDangerCard,
  DSInput, DSTextarea, DSSelect, DSCheckbox, DSRadio, DSToggle,
  DSTable, DSAlert, DSProgressBar, DSSkeleton, DSSpinner, DSEmptyState,
  DSPanel, DSModal, DSLabel,
} from "@/components/ds";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from "@/components/ui/dialog";
import notify from "@/lib/notify";
import {
  RefreshCw, Settings2, TerminalSquare, MoreHorizontal, Boxes, Trash2,
  ArrowUpRight, Layers, Zap, MousePointerClick, PanelLeft, Rocket,
} from "lucide-react";

const BRAND = [
  { name: "Primary", hex: "#3B82F6", v: "--ds-primary" },
  { name: "Accent", hex: "#00D084", v: "--ds-accent" },
];
const SEMANTIC = [
  { name: "Success", hex: "#22C55E" },
  { name: "Warning", hex: "#F59E0B" },
  { name: "Danger", hex: "#EF4444" },
  { name: "Info", hex: "#3B82F6" },
  { name: "Purple", hex: "#8B5CF6" },
];
const NEUTRAL = [
  { name: "Page", hex: "#09090B" },
  { name: "Sidebar", hex: "#0F1115" },
  { name: "Card", hex: "#111317" },
  { name: "Hover", hex: "#171A20" },
  { name: "Border", hex: "#262B36" },
  { name: "Muted", hex: "#9CA3AF" },
  { name: "Text Sec.", hex: "#CBD5E1" },
];
const TYPE = [
  { style: "Display", size: "48px", weight: 700, lh: "56px", cls: "text-[48px] font-bold leading-[56px]" },
  { style: "Heading 1", size: "32px", weight: 700, lh: "40px", cls: "text-[32px] font-bold leading-[40px]" },
  { style: "Heading 2", size: "24px", weight: 600, lh: "32px", cls: "text-[24px] font-semibold leading-[32px]" },
  { style: "Heading 3", size: "20px", weight: 600, lh: "28px", cls: "text-[20px] font-semibold leading-[28px]" },
  { style: "Heading 4", size: "18px", weight: 600, lh: "26px", cls: "text-[18px] font-semibold leading-[26px]" },
  { style: "Body Large", size: "16px", weight: 500, lh: "24px", cls: "text-[16px] font-medium leading-[24px]" },
  { style: "Body Base", size: "14px", weight: 400, lh: "20px", cls: "text-[14px] leading-[20px]" },
  { style: "Body Small", size: "13px", weight: 400, lh: "18px", cls: "text-[13px] leading-[18px]" },
  { style: "Caption", size: "12px", weight: 400, lh: "16px", cls: "text-[12px] leading-[16px]" },
];
const SPACING = [4, 8, 12, 16, 24, 32, 40, 48, 64];
const RADII = [
  { label: "4px", r: "4px" }, { label: "8px", r: "8px" }, { label: "12px", r: "12px" },
  { label: "20px", r: "20px" }, { label: "24px", r: "24px" }, { label: "Full", r: "9999px" },
];
const MOTION = [
  { name: "Hover", spec: "background / border / transform · 120–180ms · ease-out" },
  { name: "Focus", spec: "2px ring · instant · box-shadow" },
  { name: "Open Modal", spec: "fade + translateY(8px) + scale(0.98→1) · 200ms" },
  { name: "Dropdown", spec: "fade + slide 4px · 150ms · ease-out" },
  { name: "Sidebar", spec: "translateX(-100% → 0) · 200ms · ease-out" },
];

const Section = ({ n, title, subtitle, children, className = "" }) => (
  <DSCard className={`p-6 ${className}`}>
    <div className="mb-5">
      <h2 className="text-[13px] font-bold uppercase tracking-[0.15em] text-[var(--ds-text)]">
        <span className="text-[var(--ds-muted)]">{n}.</span> {title}
      </h2>
      {subtitle && <p className="mt-1 text-[13px] text-[var(--ds-muted)]">{subtitle}</p>}
    </div>
    {children}
  </DSCard>
);

const Sub = ({ children }) => (
  <div className="mb-2 text-[11px] font-semibold uppercase tracking-[0.12em] text-[var(--ds-muted)]">{children}</div>
);

const Swatch = ({ name, hex }) => (
  <div className="min-w-0">
    <div className="ds-transition h-14 w-full rounded-[8px] border border-white/5 hover:scale-[1.03]" style={{ background: hex }} />
    <div className="mt-1.5 truncate text-[12px] font-medium text-[var(--ds-text)]">{name}</div>
    <div className="text-[11px] font-mono text-[var(--ds-muted)]">{hex}</div>
  </div>
);

export default function DesignSystem() {
  const [modal, setModal] = useState(null);
  const [chk, setChk] = useState([true, false, false]);
  const [radio, setRadio] = useState(0);
  const [toggle, setToggle] = useState(true);
  const [delText, setDelText] = useState("");

  const rows = [
    { name: "My Application", status: "running", env: "Production", updated: "2m ago" },
    { name: "Website Company", status: "running", env: "Production", updated: "10m ago" },
    { name: "Staging App", status: "deploying", env: "Staging", updated: "15m ago" },
    { name: "Old Project", status: "stopped", env: "Development", updated: "2h ago" },
    { name: "Failed Build", status: "failed", env: "Production", updated: "1d ago" },
  ];

  return (
    <Layout>
      <div className="ds-root min-h-screen">
        <header className="sticky top-14 z-20 flex flex-wrap items-center justify-between gap-3 border-b border-[var(--ds-border)] bg-[var(--ds-page)]/85 px-5 py-5 backdrop-blur-xl sm:px-8 lg:top-14">
          <div>
            <div className="flex items-center gap-2">
              <h1 className="text-[24px] font-bold tracking-tight">Design System</h1>
              <span className="rounded-full bg-[var(--ds-accent)]/15 px-2 py-0.5 text-[11px] font-semibold text-[var(--ds-accent)]">v1.0</span>
            </div>
            <p className="mt-0.5 text-[13px] text-[var(--ds-muted)]">The reusable foundation for every Nexus Panel page — tokens, components & motion.</p>
          </div>
          <DSBadge status="running">Live tokens</DSBadge>
        </header>

        <div className="space-y-6 p-5 sm:p-8">
          {/* Row 1: Colors / Typography */}
          <div className="grid gap-6 lg:grid-cols-3">
            <Section n="01" title="Colors" subtitle="Brand & semantic tokens." className="lg:col-span-2">
              <Sub>Brand</Sub>
              <div className="mb-5 grid grid-cols-4 gap-3 sm:grid-cols-6">
                {BRAND.map((c) => <Swatch key={c.name} {...c} />)}
              </div>
              <Sub>Semantic</Sub>
              <div className="mb-5 grid grid-cols-3 gap-3 sm:grid-cols-5">
                {SEMANTIC.map((c) => <Swatch key={c.name} {...c} />)}
              </div>
              <Sub>Neutral / Background</Sub>
              <div className="grid grid-cols-4 gap-3 sm:grid-cols-7">
                {NEUTRAL.map((c) => <Swatch key={c.name} {...c} />)}
              </div>
            </Section>

            <Section n="02" title="Typography" subtitle="Geist (primary) · Inter (fallback)">
              <div className="mb-4 flex items-end gap-4">
                <div className="text-[64px] font-bold leading-none">Aa</div>
                <p className="pb-1 text-[13px] text-[var(--ds-muted)]">Clean, modern & easy to read for developers.</p>
              </div>
              <div className="space-y-2.5">
                {TYPE.map((t) => (
                  <div key={t.style} className="flex items-baseline justify-between gap-3 border-b border-[var(--ds-border)]/50 pb-2">
                    <span className={`${t.cls} min-w-0 truncate`}>{t.style}</span>
                    <span className="shrink-0 whitespace-nowrap font-mono text-[10px] text-[var(--ds-muted)]">{t.size} · {t.weight}</span>
                  </div>
                ))}
              </div>
            </Section>
          </div>

          {/* Row 2: Spacing / Radius+Shadow */}
          <div className="grid gap-6 lg:grid-cols-2">
            <Section n="03" title="Spacing" subtitle="8px grid system — multiples of 8.">
              <div className="flex flex-wrap items-end gap-4">
                {SPACING.map((s) => (
                  <div key={s} className="text-center">
                    <div className="mx-auto rounded-[4px] bg-[var(--ds-accent)]" style={{ width: s, height: s }} />
                    <div className="mt-2 font-mono text-[11px] text-[var(--ds-muted)]">{s}</div>
                  </div>
                ))}
              </div>
            </Section>

            <Section n="04" title="Radius & Shadow" subtitle="Corners & elevation tokens.">
              <Sub>Radius</Sub>
              <div className="mb-5 flex flex-wrap gap-3">
                {RADII.map((r) => (
                  <div key={r.label} className="text-center">
                    <div className="h-16 w-16 border border-[var(--ds-border)] bg-[var(--ds-hover)]" style={{ borderRadius: r.r }} />
                    <div className="mt-1.5 font-mono text-[11px] text-[var(--ds-muted)]">{r.label}</div>
                  </div>
                ))}
              </div>
              <Sub>Shadow</Sub>
              <div className="grid grid-cols-2 gap-3">
                <div className="rounded-[10px] border border-[var(--ds-border)] bg-[var(--ds-hover)] p-4" style={{ boxShadow: "var(--ds-shadow)" }}>
                  <div className="text-[12px] font-medium">Default</div>
                  <div className="font-mono text-[10px] text-[var(--ds-muted)]">0 8px 24px /.25</div>
                </div>
                <div className="rounded-[10px] border border-[var(--ds-border)] bg-[var(--ds-hover)] p-4" style={{ boxShadow: "var(--ds-shadow-hover)" }}>
                  <div className="text-[12px] font-medium">Hover</div>
                  <div className="font-mono text-[10px] text-[var(--ds-muted)]">0 16px 40px /.35</div>
                </div>
              </div>
            </Section>
          </div>

          {/* Row 3: Components grid */}
          <Section n="05" title="Components" subtitle="Core building blocks used across the app.">
            <div className="grid gap-6 md:grid-cols-2 xl:grid-cols-3">
              {/* Buttons */}
              <div>
                <Sub>Buttons</Sub>
                <div className="space-y-2.5">
                  {[
                    ["Primary", "primary", "Deploy", Rocket],
                    ["Secondary", "secondary", "Restart", RefreshCw],
                    ["Ghost", "ghost", "Logs", null],
                    ["Outline", "outline", "Configure", Settings2],
                    ["Success", "success", "Publish", null],
                    ["Danger", "danger", "Delete", Trash2],
                  ].map(([label, v, txt, Icon]) => (
                    <div key={label} className="flex items-center justify-between">
                      <span className="text-[13px] text-[var(--ds-muted)]">{label}</span>
                      <DSButton variant={v} size="sm" icon={Icon}>{txt}</DSButton>
                    </div>
                  ))}
                  <div className="flex items-center justify-between pt-1">
                    <span className="text-[13px] text-[var(--ds-muted)]">Icon</span>
                    <div className="flex gap-2">
                      <DSIconButton icon={RefreshCw} />
                      <DSIconButton icon={Settings2} />
                      <DSIconButton icon={TerminalSquare} />
                      <DSIconButton icon={MoreHorizontal} />
                    </div>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-[13px] text-[var(--ds-muted)]">Disabled</span>
                    <DSButton variant="primary" size="sm" disabled>Deploy</DSButton>
                  </div>
                </div>
              </div>

              {/* Badges */}
              <div>
                <Sub>Badges (status)</Sub>
                <div className="space-y-3">
                  <DSBadge status="running" />
                  <DSBadge status="deploying" pulse />
                  <DSBadge status="building" pulse />
                  <DSBadge status="stopped" />
                  <DSBadge status="failed" />
                  <DSBadge status="pending" />
                </div>
              </div>

              {/* Inputs */}
              <div>
                <Sub>Inputs</Sub>
                <div className="space-y-3">
                  <DSInput placeholder="Enter text…" />
                  <DSSelect defaultValue=""><option value="" disabled>Select option</option><option>Production</option><option>Staging</option></DSSelect>
                  <DSTextarea placeholder="Write your message…" />
                </div>
              </div>

              {/* Checkbox & radio */}
              <div>
                <Sub>Checkbox & Radio</Sub>
                <div className="space-y-2.5">
                  {chk.map((c, i) => (
                    <DSCheckbox key={i} id={`chk${i}`} label={`Checkbox label`} checked={c} onChange={(v) => setChk((p) => p.map((x, j) => (j === i ? v : x)))} />
                  ))}
                  <div className="pt-2" />
                  {[0, 1].map((i) => (
                    <DSRadio key={i} label="Radio option" checked={radio === i} onChange={() => setRadio(i)} />
                  ))}
                  <div className="pt-2"><DSToggle checked={toggle} onChange={setToggle} label="Enable feature" /></div>
                </div>
              </div>

              {/* Cards */}
              <div>
                <Sub>Cards</Sub>
                <div className="space-y-3">
                  <DSCard hover className="p-4">
                    <div className="text-[11px] uppercase tracking-wider text-[var(--ds-muted)]">Project Card</div>
                    <div className="mt-1 font-semibold">My Application</div>
                    <p className="mt-1 text-[13px] text-[var(--ds-text-secondary)]">A sample card with brief info.</p>
                    <button className="ds-transition mt-3 inline-flex items-center gap-1 text-[13px] text-[var(--ds-primary)] hover:gap-1.5">Action <ArrowUpRight className="h-3.5 w-3.5" /></button>
                  </DSCard>
                  <DSStatCard label="Total Deployments" value="24" delta="12.5%" icon={Layers} />
                  <DSDangerCard>This action cannot be undone.</DSDangerCard>
                </div>
              </div>

              {/* Table */}
              <div className="md:col-span-2 xl:col-span-1">
                <Sub>Table</Sub>
                <DSTable
                  columns={[{ key: "name", label: "Name" }, { key: "status", label: "Status" }, { key: "updated", label: "Updated" }]}
                  rows={rows}
                  renderCell={(k, r) => k === "status" ? <DSBadge status={r.status} /> : r[k]}
                  pagination={{ label: "1–5 of 12", controls: (
                    <>
                      <DSIconButton icon={PanelLeft} className="h-7 w-7" />
                      <span className="flex h-7 w-7 items-center justify-center rounded-[6px] bg-[var(--ds-primary)] text-[12px] text-white">1</span>
                      <DSIconButton icon={MoreHorizontal} className="h-7 w-7" />
                    </>
                  ) }}
                />
              </div>
            </div>
          </Section>

          {/* Row 4: Progress / Alerts / Modal / Empty / Toast */}
          <div className="grid gap-6 lg:grid-cols-2 xl:grid-cols-3">
            <Section n="06" title="Progress">
              <Sub>Progress bar</Sub>
              <div className="mb-1 flex justify-between text-[12px] text-[var(--ds-muted)]"><span>Deploying</span><span>78%</span></div>
              <DSProgressBar value={78} />
              <div className="mt-5"><Sub>Skeleton</Sub>
                <div className="space-y-2"><DSSkeleton className="h-4 w-3/4" /><DSSkeleton className="h-4 w-full" /><DSSkeleton className="h-4 w-2/3" /></div>
              </div>
              <div className="mt-5 flex items-center gap-2"><DSSpinner className="h-5 w-5" /><span className="text-[13px] text-[var(--ds-muted)]">Loading…</span></div>
            </Section>

            <Section n="07" title="Alerts">
              <div className="space-y-2.5">
                <DSAlert variant="success" title="Success" onClose={() => {}}>Deployment started successfully.</DSAlert>
                <DSAlert variant="info" title="Info" onClose={() => {}}>Configuration has been updated.</DSAlert>
                <DSAlert variant="warning" title="Warning" onClose={() => {}}>Disk usage is getting high.</DSAlert>
                <DSAlert variant="error" title="Error" onClose={() => {}}>Deployment failed. Check the logs.</DSAlert>
              </div>
            </Section>

            <Section n="08" title="Modal" subtitle="Header · Body · Footer structure.">
              <div className="flex flex-wrap gap-2">
                <DSButton variant="primary" size="sm" onClick={() => setModal("ds")}>Open modal</DSButton>
                <DSButton variant="danger" size="sm" onClick={() => setModal("delete")}>Delete</DSButton>
              </div>
              <p className="mt-3 text-[13px] text-[var(--ds-muted)]">Sticky header &amp; footer, scrollable body, fade + scale entrance.</p>
              <DSModal
                open={modal === "ds"} onOpenChange={(o) => !o && setModal(null)}
                title="Modal title"
                footer={<>
                  <DSButton variant="outline" onClick={() => setModal(null)}>Close</DSButton>
                  <DSButton variant="primary" onClick={() => setModal(null)}>Save changes</DSButton>
                </>}
              >
                Lorem ipsum dolor sit amet, consectetur adipisicing elit. Adipisci animi beatae delectus deleniti dolorem eveniet facere fuga iste nemo nesciunt nihil odio perspiciatis, quia quis reprehenderit sit tempora totam unde.
              </DSModal>
            </Section>

            <Section n="12" title="Panel" subtitle="Form card — Header · Body · Footer.">
              <DSPanel
                title="Basic form"
                footer={<>
                  <DSButton variant="outline">Close</DSButton>
                  <DSButton variant="primary">Save changes</DSButton>
                </>}
              >
                <div className="space-y-1.5">
                  <DSLabel required>Email address</DSLabel>
                  <DSInput placeholder="Enter email" type="email" />
                </div>
              </DSPanel>
            </Section>

            <Section n="13" title="Panel + Table" subtitle="List card — action in header, table in body." className="lg:col-span-2">
              <DSPanel
                title="Team members"
                headerRight={<DSButton size="sm" variant="primary" icon={Boxes}>Add member</DSButton>}
                footer={<span className="text-[12px] text-[var(--ds-muted)]">3 members · everyone has full access</span>}
                bodyClassName="p-0"
              >
                <DSTable
                  columns={[{ key: "name", label: "Name" }, { key: "status", label: "Status" }, { key: "updated", label: "Updated" }]}
                  rows={rows}
                  renderCell={(k, r) => k === "status" ? <DSBadge status={r.status} /> : r[k]}
                />
              </DSPanel>
            </Section>

            <Section n="09" title="Empty State">
              <DSEmptyState
                icon={Boxes}
                title="No projects yet"
                description="You haven't created any project. Create one to get started."
                action={<DSButton variant="primary" size="sm" icon={Boxes}>New Project</DSButton>}
              />
            </Section>

            <Section n="10" title="Toast">
              <div className="flex flex-wrap gap-2">
                <DSButton variant="success" size="sm" onClick={() => notify.success("Project deployed successfully")}>Success</DSButton>
                <DSButton variant="secondary" size="sm" onClick={() => notify.info("Settings updated")}>Info</DSButton>
                <DSButton variant="outline" size="sm" onClick={() => notify.warning("Backup running soon")}>Warning</DSButton>
                <DSButton variant="danger" size="sm" onClick={() => notify.error("Something went wrong")}>Error</DSButton>
              </div>
            </Section>

            <Section n="11" title="Motion" subtitle="Transition specification.">
              <div className="space-y-2.5">
                {MOTION.map((m) => (
                  <div key={m.name} className="flex items-start gap-3">
                    <span className="mt-0.5 flex h-6 w-6 items-center justify-center rounded-[6px] bg-[var(--ds-hover)]"><MousePointerClick className="h-3.5 w-3.5 text-[var(--ds-primary)]" /></span>
                    <div>
                      <div className="text-[13px] font-medium text-[var(--ds-text)]">{m.name}</div>
                      <div className="font-mono text-[11px] text-[var(--ds-muted)]">{m.spec}</div>
                    </div>
                  </div>
                ))}
              </div>
            </Section>
          </div>

          <p className="flex items-center gap-2 border-t border-[var(--ds-border)] pt-5 text-[13px] text-[var(--ds-muted)]">
            <Zap className="h-4 w-4 text-[var(--ds-accent)]" /> This design system keeps every Nexus Panel page consistent, premium & efficient to build.
          </p>
        </div>

        {/* Modals */}
        <Dialog open={!!modal} onOpenChange={(o) => !o && (setModal(null), setDelText(""))}>
          <DialogContent className="ds-root max-w-md border-[var(--ds-border)] bg-[var(--ds-card)]" style={{ animation: "ds-modal-in 200ms var(--ds-ease)" }}>
            {modal === "confirm" && (
              <>
                <DialogHeader><DialogTitle>Restart project?</DialogTitle></DialogHeader>
                <p className="text-[13px] text-[var(--ds-text-secondary)]">The container will restart and be briefly unavailable.</p>
                <DialogFooter>
                  <DSButton variant="ghost" size="sm" onClick={() => setModal(null)}>Cancel</DSButton>
                  <DSButton variant="primary" size="sm" onClick={() => { notify.success("Restarting…"); setModal(null); }}>Restart</DSButton>
                </DialogFooter>
              </>
            )}
            {modal === "delete" && (
              <>
                <DialogHeader><DialogTitle className="flex items-center gap-2 text-[var(--ds-danger)]"><Trash2 className="h-4 w-4" /> Delete Project</DialogTitle></DialogHeader>
                <p className="text-[13px] text-[var(--ds-text-secondary)]">This permanently removes the project. Type <span className="font-mono text-[var(--ds-text)]">delete</span> to confirm.</p>
                <DSInput value={delText} onChange={(e) => setDelText(e.target.value)} placeholder="delete" />
                <DialogFooter>
                  <DSButton variant="ghost" size="sm" onClick={() => { setModal(null); setDelText(""); }}>Cancel</DSButton>
                  <DSButton variant="danger" size="sm" disabled={delText !== "delete"} onClick={() => { notify.success("Deleted"); setModal(null); setDelText(""); }}>Delete Project</DSButton>
                </DialogFooter>
              </>
            )}
            {modal === "info" && (
              <>
                <DialogHeader><DialogTitle>Deployment info</DialogTitle></DialogHeader>
                <p className="text-[13px] text-[var(--ds-text-secondary)]">Your project is running on the latest commit with SSL enabled.</p>
                <DialogFooter><DSButton variant="primary" size="sm" onClick={() => setModal(null)}>Got it</DSButton></DialogFooter>
              </>
            )}
          </DialogContent>
        </Dialog>
      </div>
    </Layout>
  );
}
