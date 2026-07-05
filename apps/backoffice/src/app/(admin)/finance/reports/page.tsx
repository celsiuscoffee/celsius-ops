"use client";

// Reports — three live financial statements (P&L, Balance Sheet, Cash Flow)
// + auditor pack export. Date pickers, drill down by clicking any P&L line.

import { useState, useMemo, Fragment, createContext, useContext, useEffect } from "react";
import { useFetch } from "@/lib/use-fetch";
import {
  Button,
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from "@celsius/ui";
import { Loader2, Download, FileText, AlertTriangle, ChevronRight, ChevronDown, ListTree, X } from "lucide-react";
import { DateRangePicker } from "@/components/date-range-picker";
import { OUTFLOW_CATEGORIES, INFLOW_CATEGORIES, categoryLabel, categoryChipLabel } from "@/lib/finance/cash-categories";

// Accounting format: negatives in parentheses, the convention every
// accounting package (Xero, QuickBooks, Bukku) uses on statements.
const RM = (n: number | null | undefined) => {
  if (n === null || n === undefined) return "—";
  const f = new Intl.NumberFormat("en-MY", { style: "currency", currency: "MYR" }).format(Math.abs(n));
  return n < 0 ? `(${f})` : f;
};

function csvEscape(v: string | number): string {
  const s = String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

function downloadCsv(filename: string, rows: Array<Array<string | number>>) {
  const blob = new Blob([rows.map((r) => r.map(csvEscape).join(",")).join("\n")], { type: "text/csv;charset=utf-8" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  a.click();
  URL.revokeObjectURL(a.href);
}

function ExportCsvButton({ onExport }: { onExport: () => void }) {
  return (
    <Button size="xs" variant="outline" onClick={onExport} title="Download this report as CSV">
      <Download className="h-3.5 w-3.5" /> CSV
    </Button>
  );
}

function thisMonthStart(): string {
  const myt = new Date(Date.now() + 8 * 60 * 60 * 1000);
  return `${myt.getUTCFullYear()}-${String(myt.getUTCMonth() + 1).padStart(2, "0")}-01`;
}

function todayMyt(): string {
  return new Date(Date.now() + 8 * 60 * 60 * 1000).toISOString().slice(0, 10);
}

// ─── Shared report controls (date range + outlet filter) ────────
// One control bar for the whole Reports page, persisted to localStorage: pick a
// preset once (or a custom range) and every statement tab uses it — the way Xero
// / QuickBooks put a single date filter above all reports instead of one per tab.

type Preset = "this_month" | "last_month" | "this_quarter" | "last_quarter" | "ytd" | "last_12m" | "custom";
const PRESETS: { id: Preset; label: string }[] = [
  { id: "this_month", label: "This month" },
  { id: "last_month", label: "Last month" },
  { id: "this_quarter", label: "This quarter" },
  { id: "last_quarter", label: "Last quarter" },
  { id: "ytd", label: "Year to date" },
  { id: "last_12m", label: "Last 12 months" },
  { id: "custom", label: "Custom range" },
];

function rangeForPreset(preset: Preset, customStart: string, customEnd: string): { start: string; end: string } {
  const now = new Date(Date.now() + 8 * 60 * 60 * 1000); // MYT
  const y = now.getUTCFullYear(), m = now.getUTCMonth();
  const first = (yy: number, mm: number) => new Date(Date.UTC(yy, mm, 1)).toISOString().slice(0, 10);
  const last = (yy: number, mm: number) => new Date(Date.UTC(yy, mm + 1, 0)).toISOString().slice(0, 10);
  const today = now.toISOString().slice(0, 10);
  switch (preset) {
    case "last_month": { const yy = m === 0 ? y - 1 : y, mm = m === 0 ? 11 : m - 1; return { start: first(yy, mm), end: last(yy, mm) }; }
    case "this_quarter": { const qm = Math.floor(m / 3) * 3; return { start: first(y, qm), end: today }; }
    case "last_quarter": { let qm = Math.floor(m / 3) * 3 - 3, yy = y; if (qm < 0) { qm += 12; yy -= 1; } return { start: first(yy, qm), end: last(yy, qm + 2) }; }
    case "ytd": return { start: first(y, 0), end: today };
    case "last_12m": return { start: first(y, m - 11), end: today };
    case "custom": return { start: customStart, end: customEnd };
    default: return { start: first(y, m), end: today };
  }
}

type Controls = { start: string; end: string; outletId: string; consolidated: boolean };
const ControlsCtx = createContext<Controls>({ start: "", end: "", outletId: "", consolidated: false });
const useControls = () => useContext(ControlsCtx);

const CONTROLS_KEY = "finance:reports:controls";

function useReportControlsState() {
  const [preset, setPreset] = useState<Preset>("this_month");
  const [customStart, setCustomStart] = useState(thisMonthStart());
  const [customEnd, setCustomEnd] = useState(todayMyt());
  const [outletId, setOutletId] = useState("");
  const [consolidated, setConsolidated] = useState(false);
  const [hydrated, setHydrated] = useState(false);

  // Remember the last-used range + filter across reloads.
  useEffect(() => {
    try {
      const raw = localStorage.getItem(CONTROLS_KEY);
      if (raw) {
        const s = JSON.parse(raw) as Partial<{ preset: Preset; customStart: string; customEnd: string; outletId: string; consolidated: boolean }>;
        if (s.preset) setPreset(s.preset);
        if (s.customStart) setCustomStart(s.customStart);
        if (s.customEnd) setCustomEnd(s.customEnd);
        if (s.outletId) setOutletId(s.outletId);
        if (s.consolidated) setConsolidated(true);
      }
    } catch { /* ignore */ }
    setHydrated(true);
  }, []);
  useEffect(() => {
    if (!hydrated) return;
    try { localStorage.setItem(CONTROLS_KEY, JSON.stringify({ preset, customStart, customEnd, outletId, consolidated })); } catch { /* ignore */ }
  }, [hydrated, preset, customStart, customEnd, outletId, consolidated]);

  const { start, end } = rangeForPreset(preset, customStart, customEnd);
  return { preset, setPreset, customStart, setCustomStart, customEnd, setCustomEnd, outletId, setOutletId, consolidated, setConsolidated, start, end };
}

type FinCompany = { id: string; name: string; outletIds: string[] };

function ReportControlsBar({ c, outletApplies }: { c: ReturnType<typeof useReportControlsState>; outletApplies: boolean }) {
  const { data: outlets } = useFetch<{ id: string; name: string }[]>("/api/settings/outlets");
  const { data: co } = useFetch<{ companies: FinCompany[]; activeCompanyId: string }>("/api/finance/companies");
  const [switching, setSwitching] = useState(false);

  // Every report is scoped to the ACTIVE COMPANY (a server-side cookie) — show
  // it and let it be switched here, and only offer that company's outlets.
  // Without this, picking an outlet of another company silently no-ops (the
  // API falls back to all company outlets) and the numbers mislead.
  const active = co?.companies.find((x) => x.id === co.activeCompanyId);
  const companyOutlets = active
    ? (outlets ?? []).filter((o) => active.outletIds.includes(o.id))
    : (outlets ?? []);

  useEffect(() => {
    if (active && c.outletId && !active.outletIds.includes(c.outletId)) c.setOutletId("");
    // eslint-disable-next-line react-hooks/exhaustive-deps -- clear a stale outlet filter when the company changes
  }, [active?.id, c.outletId]);

  async function switchCompany(companyId: string) {
    // "Consolidated" is a view, not a legal entity — a client-side flag the
    // P&L understands, with no cookie switch.
    if (companyId === "__consolidated__") {
      c.setConsolidated(true);
      c.setOutletId("");
      return;
    }
    setSwitching(true);
    try {
      if (c.consolidated) c.setConsolidated(false);
      await fetch("/api/finance/companies/switch", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ companyId }),
      });
      // The cookie drives every server-side report — hard reload so all tabs refetch.
      window.location.reload();
    } catch {
      setSwitching(false);
    }
  }

  return (
    <div className="flex flex-wrap items-center gap-2 rounded-lg border bg-card p-2">
      <select
        value={c.consolidated ? "__consolidated__" : (co?.activeCompanyId ?? "")}
        onChange={(e) => switchCompany(e.target.value)}
        disabled={!co || switching}
        className="h-8 rounded-md border bg-background px-2 text-sm font-semibold"
        title="Active company. Every report is scoped to this legal entity. Consolidated = all companies with inter-company legs eliminated (P&L, Balance Sheet and Cash Flow)."
      >
        {!co && <option value="">Company…</option>}
        {(co?.companies ?? []).map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}
        <option value="__consolidated__">Consolidated (all companies)</option>
      </select>
      <select
        value={c.preset}
        onChange={(e) => c.setPreset(e.target.value as Preset)}
        className="h-8 rounded-md border bg-background px-2 text-sm font-medium"
        title="Report period"
      >
        {PRESETS.map((p) => <option key={p.id} value={p.id}>{p.label}</option>)}
      </select>
      {c.preset === "custom" && (
        <DateRangePicker start={c.customStart} end={c.customEnd} onChange={(s, e) => { c.setCustomStart(s); c.setCustomEnd(e); }} />
      )}
      <span className="text-[11px] text-muted-foreground tabular-nums">{c.start} → {c.end}</span>
      <select
        value={outletApplies ? c.outletId : ""}
        onChange={(e) => c.setOutletId(e.target.value)}
        disabled={c.consolidated || !outletApplies}
        className="ml-auto h-8 rounded-md border bg-background px-2 text-sm disabled:opacity-50"
        title={c.consolidated
          ? "Consolidated view spans all outlets"
          : !outletApplies
            ? "Outlet filter applies to the P&L and Aged Payables. Ledger statements are entity-level; expenses are paid from the company account and cannot be split per outlet."
            : "Filter by outlet (outlets of the active company)"}
      >
        <option value="">{outletApplies ? "All outlets" : "All outlets (entity-level tab)"}</option>
        {companyOutlets.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}
      </select>
    </div>
  );
}

// ─── P&L tab ────────────────────────────────────────────────────

type PnlLine = { code: string; name: string; amount: number; parentCode: string | null };
type PnlSection = { total: number; lines: PnlLine[] };

type PnlReport = {
  companyId: string;
  start: string;
  end: string;
  income: PnlSection;
  cogs: PnlSection;
  grossProfit: number;
  expenses: PnlSection;
  netIncome: number;
  txnCount: number;
};

type MatchedInvoice = { invoiceNumber: string | null; vendor: string | null; amount: number };

type DrillLine = {
  transactionId: string;
  txnDate: string;
  description: string;
  amount: number;
  debit: number;
  credit: number;
  meta?: {
    reference?: string | null;
    category?: string | null;
    company?: string | null;
    account?: string | null;
    isInterCo?: boolean;
    classifiedBy?: string | null;
    ruleName?: string | null;
    // Bank-sourced rows: the line id behind the fix-in-place chips.
    bankLineId?: string;
    direction?: "DR" | "CR";
    apInvoiceId?: string | null;
    matchedInvoice?: MatchedInvoice | null;
    // Journal-backed rows: the posting agent ("bank" journals expand into
    // their source bank lines).
    glAgent?: string | null;
  };
};

// Common-size %: every P&L line expressed against total income — the standard
// way to read an F&B P&L (COGS ~35%, staff ~15%, net margin at a glance).
function pctOfIncome(amount: number, totalIncome: number): string {
  if (!totalIncome) return "";
  return `${((amount / totalIncome) * 100).toFixed(1)}%`;
}

// Period-over-period change vs the comparison column. Blank when there's
// nothing to compare against; "new" when this period has a value and the
// comparison was zero.
function pctChange(cur: number, prev: number | null | undefined): string {
  if (prev == null) return "";
  if (prev === 0) return cur === 0 ? "" : "new";
  const p = ((cur - prev) / Math.abs(prev)) * 100;
  return `${p >= 0 ? "+" : ""}${p.toFixed(0)}%`;
}

// Compare-period date helpers (plain YYYY-MM-DD, no TZ shift).
const addDaysStr = (s: string, n: number) => { const d = new Date(`${s}T00:00:00.000Z`); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
const addYearsStr = (s: string, n: number) => { const [y, m, d] = s.split("-"); return `${Number(y) + n}-${m}-${d}`; };
const daysBetween = (a: string, b: string) => Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86_400_000);
const round2 = (n: number) => Math.round(n * 100) / 100;

const MONTHS_SHORT = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const MONTHS_LONG = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

// "2026-04" to "Apr 2026" for month column headers and the trend chart.
function monthLabel(ym: string): string {
  const [y, m] = ym.split("-").map(Number);
  return `${MONTHS_SHORT[(m || 1) - 1]} ${y}`;
}

// "2026-04-01" to "1 April 2026" for the statement header period line.
function longDate(s: string): string {
  const [y, m, d] = s.split("-").map(Number);
  return `${d} ${MONTHS_LONG[(m || 1) - 1]} ${y}`;
}

// Compact RM labels for the chart axis ("50k", "1.2M").
function compactRm(n: number): string {
  const a = Math.abs(n);
  if (a >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (a >= 1_000) return `${Math.round(n / 1_000)}k`;
  return `${Math.round(n)}`;
}

// Centered statement header the way QuickBooks Modern View frames a report:
// company, statement title, period, and a muted prepared-on line.
function StatementHeader({ title, periodLine }: { title: string; periodLine: string }) {
  const { consolidated } = useControls();
  const { data: co } = useFetch<{ companies: FinCompany[]; activeCompanyId: string }>("/api/finance/companies");
  const company = consolidated
    ? "Consolidated, all companies"
    : co?.companies.find((x) => x.id === co.activeCompanyId)?.name ?? "";
  return (
    <div className="space-y-0.5 pt-1 text-center">
      <div className="text-sm font-medium">{company || " "}</div>
      <div className="text-lg font-semibold">{title}</div>
      <div className="text-sm text-muted-foreground tabular-nums">{periodLine}</div>
      <div className="text-[11px] text-muted-foreground">Prepared on {longDate(todayMyt())}</div>
    </div>
  );
}

// Headline tiles above the P&L, QuickBooks-style. Net Profit is signed:
// emerald when positive, rose when negative.
function KpiTile({ label, amount, prev, showCompare, signed }: { label: string; amount: number; prev?: number | null; showCompare?: boolean; signed?: boolean }) {
  const tone = signed ? (amount < 0 ? "text-rose-600 dark:text-rose-400" : "text-emerald-600 dark:text-emerald-400") : "";
  return (
    <div className="rounded-lg border bg-card p-3">
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className={`truncate text-xl font-semibold tabular-nums ${tone}`}>{RM(amount)}</div>
      {showCompare && prev != null && (
        <div className="mt-0.5 text-[11px] text-muted-foreground tabular-nums">
          vs {RM(prev)} {pctChange(amount, prev) && <span>({pctChange(amount, prev)})</span>}
        </div>
      )}
    </div>
  );
}

type TrendPoint = { month: string; income: number; expense: number; net: number };

// Hand-rolled SVG monthly trend: grouped Income and Expenses bars plus a Net
// line with dots. Sized via viewBox so it stays responsive; exact values sit
// in <title> elements for native hover. No chart library.
function TrendChart({ points }: { points: TrendPoint[] }) {
  if (points.length === 0) return null;
  const W = 760, H = 180, padL = 48, padR = 10, padT = 10, padB = 22;
  const innerW = W - padL - padR, innerH = H - padT - padB;
  const hi = Math.max(1, ...points.map((p) => Math.max(p.income, p.expense, p.net)));
  const lo = Math.min(0, ...points.map((p) => Math.min(p.net, 0)));
  const span = hi - lo || 1;
  const y = (v: number) => padT + innerH - ((v - lo) / span) * innerH;
  const group = innerW / points.length;
  const barW = Math.max(4, Math.min(26, group * 0.26));
  const cx = (i: number) => padL + group * i + group / 2;
  const ticks = [0, 1, 2, 3].map((i) => lo + (span * i) / 3);
  const bar = (v: number, x: number) => ({ x, y: Math.min(y(v), y(0)), h: Math.max(1, Math.abs(y(0) - y(v))) });
  return (
    <div className="rounded-lg border bg-card p-3">
      <div className="mb-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-muted-foreground">
        <span className="flex items-center gap-1"><span className="h-2 w-2 rounded-sm bg-emerald-500" /> Income</span>
        <span className="flex items-center gap-1"><span className="h-2 w-2 rounded-sm bg-rose-500" /> Expenses (COGS + opex)</span>
        <span className="flex items-center gap-1"><span className="h-0.5 w-3 rounded bg-foreground" /> Net</span>
      </div>
      <svg viewBox={`0 0 ${W} ${H}`} className="h-auto w-full" role="img" aria-label="Monthly income, expenses and net profit">
        {ticks.map((t, i) => (
          <g key={i}>
            <line x1={padL} x2={W - padR} y1={y(t)} y2={y(t)} stroke="currentColor" strokeWidth={0.5} className="text-border" />
            <text x={padL - 6} y={y(t) + 3} textAnchor="end" fontSize={9} fill="currentColor" className="text-muted-foreground tabular-nums">{compactRm(t)}</text>
          </g>
        ))}
        {lo < 0 && <line x1={padL} x2={W - padR} y1={y(0)} y2={y(0)} stroke="currentColor" strokeWidth={1} className="text-border" />}
        {points.map((p, i) => {
          const inc = bar(p.income, cx(i) - barW - 1);
          const exp = bar(p.expense, cx(i) + 1);
          return (
            <g key={p.month}>
              <rect x={inc.x} y={inc.y} width={barW} height={inc.h} rx={1} fill="currentColor" className="text-emerald-500">
                <title>{`Income ${monthLabel(p.month)}: ${RM(p.income)}`}</title>
              </rect>
              <rect x={exp.x} y={exp.y} width={barW} height={exp.h} rx={1} fill="currentColor" className="text-rose-500">
                <title>{`Expenses ${monthLabel(p.month)}: ${RM(p.expense)}`}</title>
              </rect>
              <text x={cx(i)} y={H - 8} textAnchor="middle" fontSize={9} fill="currentColor" className="text-muted-foreground">{monthLabel(p.month)}</text>
            </g>
          );
        })}
        <polyline fill="none" stroke="currentColor" strokeWidth={1.5} className="text-foreground" points={points.map((p, i) => `${cx(i)},${y(p.net)}`).join(" ")} />
        {points.map((p, i) => (
          <circle key={p.month} cx={cx(i)} cy={y(p.net)} r={2.5} fill="currentColor" className="text-foreground">
            <title>{`Net ${monthLabel(p.month)}: ${RM(p.net)}`}</title>
          </circle>
        ))}
      </svg>
    </div>
  );
}

// Row components live at module scope (not inside PnlTab) so their
// identity is stable across renders; ReportRow takes the drill-down
// callback as a prop instead of closing over PnlTab state.
// monthAmounts (by-month mode) renders one column per month before the Total;
// a month with no value for the line stays blank.
type MonthAmount = number | undefined;

function ReportRow({ line, totalIncome, onDrill, compareAmount, showCompare, showPct = true, monthAmounts, zebra }: { line: PnlLine; totalIncome: number; onDrill: (code: string) => void; compareAmount?: number | null; showCompare?: boolean; showPct?: boolean; monthAmounts?: MonthAmount[]; zebra?: boolean }) {
  return (
    <tr
      className={`group cursor-pointer border-t transition ${zebra ? "bg-muted/20" : ""} hover:bg-muted/30`}
      onClick={() => onDrill(line.code)}
      title="Click to drill into this line"
    >
      <td
        className="whitespace-nowrap px-3 py-1.5 text-xs tabular-nums text-muted-foreground"
        style={{ paddingLeft: line.parentCode ? 32 : 12 }}
      >
        {line.code}
      </td>
      <td className="px-3 py-1.5">{line.name}</td>
      {monthAmounts?.map((a, i) => (
        <td key={i} className="whitespace-nowrap px-3 py-1.5 text-right tabular-nums">{a == null ? "" : RM(a)}</td>
      ))}
      <td className={`whitespace-nowrap px-3 py-1.5 text-right tabular-nums ${monthAmounts ? "font-medium" : ""}`}>
        <span className="underline-offset-2 group-hover:underline">{RM(line.amount)}</span>
      </td>
      {showCompare && <td className="whitespace-nowrap px-3 py-1.5 text-right tabular-nums text-muted-foreground">{compareAmount == null ? "" : RM(compareAmount)}</td>}
      {showCompare && <td className="whitespace-nowrap px-3 py-1.5 text-right text-xs tabular-nums text-muted-foreground">{pctChange(line.amount, compareAmount)}</td>}
      {showPct && <td className="whitespace-nowrap px-3 py-1.5 text-right text-xs tabular-nums text-muted-foreground">{pctOfIncome(line.amount, totalIncome)}</td>}
      <td className="w-6 py-1.5 pr-2">
        <ChevronRight className="h-3.5 w-3.5 text-muted-foreground opacity-0 transition group-hover:opacity-100" />
      </td>
    </tr>
  );
}

function TotalRow({ label, amount, totalIncome, bold = true, compareAmount, showCompare, showPct = true, monthAmounts, signed }: { label: string; amount: number; totalIncome: number; bold?: boolean; compareAmount?: number | null; showCompare?: boolean; showPct?: boolean; monthAmounts?: MonthAmount[]; signed?: boolean }) {
  const f = bold ? "font-semibold" : "";
  const tone = signed ? (amount < 0 ? "text-rose-600 dark:text-rose-400" : "text-emerald-600 dark:text-emerald-400") : "";
  return (
    <tr className="border-t bg-muted/30">
      <td colSpan={2} className={`px-3 py-2 ${f}`}>{label}</td>
      {monthAmounts?.map((a, i) => (
        <td key={i} className={`whitespace-nowrap px-3 py-2 text-right tabular-nums ${f} ${tone}`}>{a == null ? "" : RM(a)}</td>
      ))}
      <td className={`whitespace-nowrap px-3 py-2 text-right tabular-nums ${f} ${tone}`}>{RM(amount)}</td>
      {showCompare && <td className={`whitespace-nowrap px-3 py-2 text-right tabular-nums text-muted-foreground ${f}`}>{compareAmount == null ? "" : RM(compareAmount)}</td>}
      {showCompare && <td className={`whitespace-nowrap px-3 py-2 text-right text-xs tabular-nums text-muted-foreground ${f}`}>{pctChange(amount, compareAmount)}</td>}
      {showPct && <td className={`whitespace-nowrap px-3 py-2 text-right text-xs tabular-nums text-muted-foreground ${f}`}>{pctOfIncome(amount, totalIncome)}</td>}
      <td className="w-6 py-2 pr-2" />
    </tr>
  );
}

function SectionHeader({ label, cols, collapsed, onToggle }: { label: string; cols: number; collapsed: boolean; onToggle: () => void }) {
  return (
    <tr>
      <td colSpan={cols} className="bg-muted/50 px-3 py-1.5 text-xs uppercase tracking-wide text-muted-foreground">
        <button type="button" onClick={onToggle} className="flex items-center gap-1 uppercase tracking-wide" title={collapsed ? "Expand section" : "Collapse section"}>
          <ChevronDown className={`h-3 w-3 transition-transform ${collapsed ? "-rotate-90" : ""}`} />
          {label}
        </button>
      </td>
    </tr>
  );
}

type CompareMode = "none" | "prev" | "year";
type ColumnsMode = "total" | "month";
type PnlMonths = { report: PnlReport; months: { month: string; report: PnlReport }[]; truncated?: boolean };

// Sticky header cell: opaque background so rows never bleed through while the
// table body scrolls underneath.
const TH = "sticky top-0 z-10 bg-muted px-3 py-2";

const PNL_CHART_KEY = "finance:reports:pnl-chart";
const PNL_SECTIONS = ["income", "cogs", "expenses"] as const;

function PnlTab() {
  const { start, end, outletId, consolidated } = useControls();
  const [compare, setCompare] = useState<CompareMode>("none");
  const [columns, setColumns] = useState<ColumnsMode>("total");
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});
  const [showChart, setShowChart] = useState(true);
  const [drillCode, setDrillCode] = useState<string | null>(null);

  // Chart visibility persists so hiding it sticks across visits.
  useEffect(() => {
    try { if (localStorage.getItem(PNL_CHART_KEY) === "0") setShowChart(false); } catch { /* ignore */ }
  }, []);
  const toggleChart = () => setShowChart((s) => {
    try { localStorage.setItem(PNL_CHART_KEY, s ? "0" : "1"); } catch { /* ignore */ }
    return !s;
  });

  const scope = consolidated ? "&companyId=consolidated" : outletId ? `&outletId=${outletId}` : "";
  const qs = useMemo(() => `start=${start}&end=${end}${scope}`, [start, end, scope]);
  const { data, error, isLoading, mutate } = useFetch<{ report: PnlReport }>(
    `/api/finance/reports/pnl?${qs}`
  );
  // By-month mode fetches the same report split into calendar months (one
  // column per month). The full-period report in the payload drives the row
  // list, so every line appears even if some months lack it.
  const byMonth = columns === "month";
  const { data: monthData, isLoading: monthsLoading, mutate: mutateMonths } = useFetch<PnlMonths>(
    byMonth ? `/api/finance/reports/pnl?${qs}&byMonth=1` : null
  );
  // Comparison period: the immediately-preceding equal-length window, or the
  // same dates a year earlier. Fetched only when a comparison is selected.
  const cmpRange = useMemo(() => {
    if (compare === "prev") { const cEnd = addDaysStr(start, -1); return { s: addDaysStr(cEnd, -daysBetween(start, end)), e: cEnd }; }
    if (compare === "year") return { s: addYearsStr(start, -1), e: addYearsStr(end, -1) };
    return null;
  }, [compare, start, end]);
  const { data: cmpData } = useFetch<{ report: PnlReport }>(
    cmpRange ? `/api/finance/reports/pnl?start=${cmpRange.s}&end=${cmpRange.e}${scope}` : null
  );
  const showCompare = compare !== "none" && !!cmpData;
  // Compare and % of income columns hide in by-month mode (the KPI tiles keep
  // showing the comparison); QuickBooks simplifies the combo the same way.
  const showCompareCols = showCompare && !byMonth;
  const showPct = !byMonth;
  const cmpByCode = useMemo(() => {
    const m = new Map<string, number>();
    const r = cmpData?.report;
    if (r) for (const l of [...r.income.lines, ...r.cogs.lines, ...r.expenses.lines]) m.set(l.code, l.amount);
    return m;
  }, [cmpData]);
  const cmp = cmpData?.report;

  const report = byMonth ? monthData?.report : data?.report;
  const months = useMemo(() => (byMonth ? monthData?.months ?? [] : []), [byMonth, monthData]);
  const amtByMonth = useMemo(() => months.map((m) => {
    const map = new Map<string, number>();
    for (const l of [...m.report.income.lines, ...m.report.cogs.lines, ...m.report.expenses.lines]) map.set(l.code, l.amount);
    return map;
  }), [months]);
  const rowMonths = (code: string): MonthAmount[] | undefined =>
    byMonth ? amtByMonth.map((m) => m.get(code)) : undefined;
  const totMonths = (f: (r: PnlReport) => number): MonthAmount[] | undefined =>
    byMonth ? months.map((m) => f(m.report)) : undefined;
  // In by-month mode the row list is the UNION of the full-period lines and
  // any line that only exists in individual months (a month with a usable
  // stock count breaks COGS into opening, purchases and closing while the
  // full period may fall back to the single purchases proxy). Row and
  // subtotal Totals are then derived by summing the month figures so the
  // table cross-foots in both directions.
  const secLines = useMemo(() => {
    const build = (sec: (typeof PNL_SECTIONS)[number]): PnlLine[] => {
      const base = report?.[sec].lines ?? [];
      if (!byMonth) return base;
      const monthTotal = (code: string) => round2(amtByMonth.reduce((s, m) => s + (m.get(code) ?? 0), 0));
      const seen = new Set(base.map((l) => l.code));
      const merged = base.map((l) => ({ ...l, amount: monthTotal(l.code) }));
      for (const m of months) {
        for (const l of m.report[sec].lines) {
          if (seen.has(l.code)) continue;
          seen.add(l.code);
          merged.push({ ...l, amount: monthTotal(l.code) });
        }
      }
      return merged;
    };
    return { income: build("income"), cogs: build("cogs"), expenses: build("expenses") };
  }, [report, byMonth, months, amtByMonth]);
  const monthSum = (f: (r: PnlReport) => number) => round2(months.reduce((s, m) => s + f(m.report), 0));
  // Displayed totals: month sums in by-month mode (so columns add up), the
  // official full-period figures otherwise.
  const totals = byMonth ? {
    income: monthSum((r) => r.income.total),
    cogs: monthSum((r) => r.cogs.total),
    expenses: monthSum((r) => r.expenses.total),
    grossProfit: monthSum((r) => r.grossProfit),
    netIncome: monthSum((r) => r.netIncome),
  } : {
    income: report?.income.total ?? 0,
    cogs: report?.cogs.total ?? 0,
    expenses: report?.expenses.total ?? 0,
    grossProfit: report?.grossProfit ?? 0,
    netIncome: report?.netIncome ?? 0,
  };
  // When month COGS methods differ from the full-period method the two nets
  // legitimately diverge; surface it instead of leaving a silent mismatch.
  const methodologyGap = byMonth && report ? round2(totals.netIncome - report.netIncome) : 0;
  const trend: TrendPoint[] = months.map((m) => ({
    month: m.month,
    income: m.report.income.total,
    expense: m.report.cogs.total + m.report.expenses.total,
    net: m.report.netIncome,
  }));

  const cols = 3 + months.length + (showCompareCols ? 2 : 0) + (showPct ? 1 : 0) + 1;
  const loading = !report && !error && (isLoading || monthsLoading || byMonth);
  const allCollapsed = PNL_SECTIONS.every((s) => collapsed[s]);
  const toggleSection = (s: string) => setCollapsed((c) => ({ ...c, [s]: !c[s] }));

  const exportCsv = () => {
    if (!report) return;
    const r = report;
    if (byMonth) {
      const rows: Array<Array<string | number>> = [
        ["Section", "Code", "Account", ...months.map((m) => monthLabel(m.month)), "Total"],
      ];
      const pushLines = (section: string, lines: PnlLine[]) => {
        for (const l of lines) rows.push([section, l.code, l.name, ...amtByMonth.map((m) => m.get(l.code) ?? ""), l.amount]);
      };
      const pushTotal = (section: string, label: string, amt: number, f: (x: PnlReport) => number) => {
        rows.push([section, "", label, ...months.map((m) => f(m.report)), amt]);
      };
      pushLines("Income", secLines.income);
      pushTotal("Income", "Total Income", totals.income, (x) => x.income.total);
      pushLines("Cost of Sales", secLines.cogs);
      pushTotal("Cost of Sales", "Total COGS", totals.cogs, (x) => x.cogs.total);
      pushTotal("", "Gross Profit", totals.grossProfit, (x) => x.grossProfit);
      pushLines("Expenses", secLines.expenses);
      pushTotal("Expenses", "Total Expenses", totals.expenses, (x) => x.expenses.total);
      pushTotal("", "Net Income", totals.netIncome, (x) => x.netIncome);
      downloadCsv(`pnl_${r.start}_${r.end}_by-month.csv`, rows);
      return;
    }
    const head = ["Section", "Code", "Account", "Amount", ...(showCompare ? ["Compare", "Change %"] : []), "% of income"];
    const rows: Array<Array<string | number>> = [head];
    const cell = (l: PnlLine) => [l.code, l.name, l.amount, ...(showCompare ? [cmpByCode.get(l.code) ?? "", pctChange(l.amount, cmpByCode.get(l.code))] : []), pctOfIncome(l.amount, r.income.total)];
    const tot = (label: string, amt: number, cAmt?: number | null) => ["", "", label, amt, ...(showCompare ? [cAmt ?? "", pctChange(amt, cAmt)] : []), pctOfIncome(amt, r.income.total)];
    const push = (section: string, lines: PnlLine[], total: number, totalLabel: string, cTotal?: number | null) => {
      for (const l of lines) rows.push([section, ...cell(l)]);
      rows.push([section, ...tot(totalLabel, total, cTotal).slice(2)]);
    };
    push("Income", r.income.lines, r.income.total, "Total Income", cmp?.income.total);
    push("Cost of Sales", r.cogs.lines, r.cogs.total, "Total COGS", cmp?.cogs.total);
    rows.push(tot("Gross Profit", r.grossProfit, cmp?.grossProfit));
    push("Expenses", r.expenses.lines, r.expenses.total, "Total Expenses", cmp?.expenses.total);
    rows.push(tot("Net Income", r.netIncome, cmp?.netIncome));
    downloadCsv(`pnl_${r.start}_${r.end}.csv`, rows);
  };

  return (
    <div className="space-y-4">
      <StatementHeader title="Profit and Loss" periodLine={`${longDate(start)} to ${longDate(end)}`} />
      {consolidated && (
        <p className="text-[11px] text-muted-foreground">
          Consolidated group P&amp;L: all companies summed with inter-company legs eliminated, so HQ-paid salary, Google Ads and management fees count once as group cost. Other tabs stay per-company; switch to a company to drill into a line.
        </p>
      )}
      {!consolidated && outletId && (
        <p className="text-[11px] text-amber-600">
          Per-outlet view: revenue + COGS + outlet-tagged costs only (contribution margin). Shared/HQ opex is paid from the entity account and can&apos;t be split per outlet.
        </p>
      )}

      {loading && <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />}
      {error && (
        <div className="rounded-lg border border-destructive/40 bg-destructive/5 p-3 text-sm text-destructive">
          Failed to load.
        </div>
      )}

      {report && (
        <>
        <div className="grid gap-3 sm:grid-cols-3">
          <KpiTile label="Income" amount={totals.income} prev={cmp?.income.total} showCompare={showCompare} />
          <KpiTile label="Expenses" amount={totals.cogs + totals.expenses} prev={cmp ? cmp.cogs.total + cmp.expenses.total : null} showCompare={showCompare} />
          <KpiTile label="Net Profit" amount={totals.netIncome} prev={cmp?.netIncome} showCompare={showCompare} signed />
        </div>
        {byMonth && monthData?.truncated && (
          <p className="text-[11px] text-amber-600">Range exceeds 12 months; showing the last 12.</p>
        )}
        {byMonth && Math.abs(methodologyGap) > 0.01 && (
          <p className="text-[11px] text-muted-foreground">
            Totals here sum the month columns. Months with a usable stock count use count-adjusted COGS, so they can differ from the full-period statement (net {RM(report.netIncome)} for this range in Total columns mode).
          </p>
        )}
        {byMonth && showChart && <TrendChart points={trend} />}
        <div className="flex flex-wrap items-center gap-2">
          <label className="flex items-center gap-1 text-[11px] text-muted-foreground">Columns
            <select value={columns} onChange={(e) => setColumns(e.target.value as ColumnsMode)}
              className="h-7 rounded-md border bg-background px-1.5 text-xs">
              <option value="total">Total</option>
              <option value="month">By month</option>
            </select>
          </label>
          <label className="flex items-center gap-1 text-[11px] text-muted-foreground">Compare
            <select value={compare} onChange={(e) => setCompare(e.target.value as CompareMode)}
              className="h-7 rounded-md border bg-background px-1.5 text-xs">
              <option value="none">off</option>
              <option value="prev">previous period</option>
              <option value="year">previous year</option>
            </select>
          </label>
          <button
            type="button"
            onClick={() => setCollapsed(allCollapsed ? {} : { income: true, cogs: true, expenses: true })}
            className="text-[11px] text-muted-foreground underline-offset-2 hover:text-foreground hover:underline"
          >
            {allCollapsed ? "Expand all" : "Collapse all"}
          </button>
          {showCompareCols && cmpRange && <span className="text-[10px] text-muted-foreground tabular-nums">vs {cmpRange.s} → {cmpRange.e}</span>}
          <div className="ml-auto flex items-center gap-2">
            {byMonth && (
              <button
                type="button"
                onClick={toggleChart}
                className={`h-7 rounded-full border px-2.5 text-xs transition ${showChart ? "bg-muted/50" : "text-muted-foreground hover:text-foreground"}`}
                title="Show or hide the monthly trend chart"
              >
                Chart
              </button>
            )}
            <ExportCsvButton onExport={exportCsv} />
          </div>
        </div>
        <div className="max-h-[75vh] overflow-auto rounded-lg border bg-card">
          <table className="w-full text-sm">
            <thead className="text-left text-xs uppercase tracking-wide text-muted-foreground">
              <tr>
                <th className={`${TH} whitespace-nowrap`}>Code</th>
                <th className={TH}>Account</th>
                {months.map((m) => <th key={m.month} className={`${TH} whitespace-nowrap text-right`}>{monthLabel(m.month)}</th>)}
                <th className={`${TH} whitespace-nowrap text-right`}>{byMonth ? "Total" : "Amount"}</th>
                {showCompareCols && <th className={`${TH} whitespace-nowrap text-right`}>{compare === "year" ? "Prev year" : "Prev period"}</th>}
                {showCompareCols && <th className={`${TH} whitespace-nowrap text-right`} title="Change vs comparison period">Δ</th>}
                {showPct && <th className={`${TH} whitespace-nowrap text-right`} title="Share of total income">% of income</th>}
                <th className={`${TH} w-6`} />
              </tr>
            </thead>
            <tbody>
              <SectionHeader label="Income" cols={cols} collapsed={!!collapsed.income} onToggle={() => toggleSection("income")} />
              {!collapsed.income && secLines.income.map((l, i) => <ReportRow key={l.code} line={l} totalIncome={totals.income} onDrill={setDrillCode} compareAmount={cmpByCode.get(l.code) ?? null} showCompare={showCompareCols} showPct={showPct} monthAmounts={rowMonths(l.code)} zebra={i % 2 === 1} />)}
              <TotalRow label="Total Income" amount={totals.income} totalIncome={totals.income} compareAmount={cmp?.income.total} showCompare={showCompareCols} showPct={showPct} monthAmounts={totMonths((x) => x.income.total)} />

              <SectionHeader label="Cost of Sales" cols={cols} collapsed={!!collapsed.cogs} onToggle={() => toggleSection("cogs")} />
              {!collapsed.cogs && secLines.cogs.map((l, i) => <ReportRow key={l.code} line={l} totalIncome={totals.income} onDrill={setDrillCode} compareAmount={cmpByCode.get(l.code) ?? null} showCompare={showCompareCols} showPct={showPct} monthAmounts={rowMonths(l.code)} zebra={i % 2 === 1} />)}
              <TotalRow label="Total COGS" amount={totals.cogs} totalIncome={totals.income} compareAmount={cmp?.cogs.total} showCompare={showCompareCols} showPct={showPct} monthAmounts={totMonths((x) => x.cogs.total)} />
              <TotalRow label="Gross Profit" amount={totals.grossProfit} totalIncome={totals.income} compareAmount={cmp?.grossProfit} showCompare={showCompareCols} showPct={showPct} monthAmounts={totMonths((x) => x.grossProfit)} />

              <SectionHeader label="Expenses" cols={cols} collapsed={!!collapsed.expenses} onToggle={() => toggleSection("expenses")} />
              {!collapsed.expenses && secLines.expenses.map((l, i) => <ReportRow key={l.code} line={l} totalIncome={totals.income} onDrill={setDrillCode} compareAmount={cmpByCode.get(l.code) ?? null} showCompare={showCompareCols} showPct={showPct} monthAmounts={rowMonths(l.code)} zebra={i % 2 === 1} />)}
              <TotalRow label="Total Expenses" amount={totals.expenses} totalIncome={totals.income} compareAmount={cmp?.expenses.total} showCompare={showCompareCols} showPct={showPct} monthAmounts={totMonths((x) => x.expenses.total)} />

              <TotalRow label="Net Income" amount={totals.netIncome} totalIncome={totals.income} compareAmount={cmp?.netIncome} showCompare={showCompareCols} showPct={showPct} monthAmounts={totMonths((x) => x.netIncome)} signed />
            </tbody>
          </table>
        </div>
        </>
      )}

      <Sheet open={!!drillCode} onOpenChange={(o) => !o && setDrillCode(null)}>
        <SheetContent side="right" className="w-full sm:max-w-3xl flex flex-col gap-0 p-0">
          <SheetHeader className="border-b px-4 py-4 sm:px-6">
            <SheetTitle>
              {(drillCode &&
                [...secLines.income, ...secLines.cogs, ...secLines.expenses]
                  .find((l) => l.code === drillCode)?.name) ?? drillCode}
            </SheetTitle>
            {report && (
              <p className="text-xs text-muted-foreground tabular-nums">
                {drillCode} · {report.start} → {report.end}
              </p>
            )}
          </SheetHeader>
          {drillCode && report && (
            <DrillDown code={drillCode} start={report.start} end={report.end} outletId={outletId || undefined} consolidated={consolidated} onChanged={() => { mutate(); if (byMonth) mutateMonths(); }} />
          )}
        </SheetContent>
      </Sheet>
    </div>
  );
}

// Inline "fix it where you found it" chip: the bank line's category. Clicking
// opens a compact select; booking a new category POSTs classify (the GL
// re-keys), then refreshes the view it sits in AND the parent report.
function CategoryChip({ bankLineId, category, direction, accountNames, onSaved }: {
  bankLineId: string;
  category: string | null;
  direction: "DR" | "CR";
  accountNames: Map<string, string>;
  onSaved: () => Promise<void> | void;
}) {
  const [editing, setEditing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function save(next: string) {
    setEditing(false);
    if (!next || next === category) return;
    setBusy(true); setErr(null);
    try {
      const res = await fetch("/api/finance/bank-lines/classify", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ bankLineId, category: next }),
      });
      const j = await res.json();
      if (!res.ok) setErr(j.error ?? `Failed (${res.status})`);
      else await onSaved();
    } catch (e) { setErr(e instanceof Error ? e.message : String(e)); }
    finally { setBusy(false); }
  }

  if (editing) {
    return (
      <select
        autoFocus
        defaultValue={category ?? ""}
        onChange={(e) => save(e.target.value)}
        onBlur={() => setEditing(false)}
        onKeyDown={(e) => { if (e.key === "Escape") setEditing(false); }}
        onClick={(e) => e.stopPropagation()}
        className="h-6 max-w-[260px] rounded border bg-background px-1 text-[11px]"
      >
        {!category && <option value="" disabled>unclassified…</option>}
        {(direction === "CR" ? INFLOW_CATEGORIES : OUTFLOW_CATEGORIES).map((c) => (
          <option key={c} value={c}>{categoryLabel(c, accountNames)}</option>
        ))}
      </select>
    );
  }
  return (
    <span className="inline-flex items-center gap-1">
      <button
        type="button"
        disabled={busy}
        onClick={(e) => { e.stopPropagation(); setEditing(true); }}
        title="Category this line is booked to. Click to recategorise."
        className="inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] text-muted-foreground transition hover:text-foreground hover:ring-1 hover:ring-ring disabled:opacity-60"
      >
        {busy && <Loader2 className="h-3 w-3 animate-spin" />}
        {categoryChipLabel(category)}
      </button>
      {err && <span className="text-[10px] text-rose-600">{err}</span>}
    </span>
  );
}

// AP-matched lines carry the invoice their match settled. The x unmatches
// (the invoice reverts to unpaid when this match is what paid it); the
// category chip can then rebook the freed line.
function MatchedChip({ bankLineId, invoice, onSaved }: {
  bankLineId: string;
  invoice: MatchedInvoice;
  onSaved: () => Promise<void> | void;
}) {
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const label = invoice.invoiceNumber ?? "invoice";

  async function unmatch() {
    if (!window.confirm(`Unmatch this line from ${label}? The invoice reverts to unpaid if this match paid it.`)) return;
    setBusy(true); setErr(null);
    try {
      const res = await fetch("/api/finance/bank-lines/unmatch", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ bankLineId }),
      });
      const j = await res.json();
      if (!res.ok) setErr(j.error ?? `Failed (${res.status})`);
      else await onSaved();
    } catch (e) { setErr(e instanceof Error ? e.message : String(e)); }
    finally { setBusy(false); }
  }

  return (
    <span className="inline-flex items-center gap-1">
      <span
        title={`Matched to ${label}${invoice.vendor ? ` from ${invoice.vendor}` : ""}, ${RM(invoice.amount)}`}
        className="inline-flex items-center gap-1 rounded-full border border-amber-500/40 bg-amber-500/10 px-2 py-0.5 text-[11px] text-amber-700 dark:text-amber-400"
      >
        Matched: {label}{invoice.vendor ? ` (${invoice.vendor})` : ""}
        <button
          type="button"
          disabled={busy}
          onClick={(e) => { e.stopPropagation(); unmatch(); }}
          title="Unmatch this line from the invoice"
          className="rounded-full transition hover:text-amber-900 disabled:opacity-60 dark:hover:text-amber-200"
        >
          {busy ? <Loader2 className="h-3 w-3 animate-spin" /> : <X className="h-3 w-3" />}
        </button>
      </span>
      {err && <span className="text-[10px] text-rose-600">{err}</span>}
    </span>
  );
}

type SourceLine = {
  id: string; txnDate: string; description: string; amount: number;
  direction: "DR" | "CR"; reference: string | null; category: string | null;
  isInterCo: boolean; classifiedBy: string | null; ruleName: string | null;
  apInvoiceId: string | null; matchedInvoice: MatchedInvoice | null;
};

// The bank statement lines a bank-agent journal was posted from, each with
// the same fix-in-place chips as the P&L drill. A fix re-keys the journal,
// so the parent view refetches via onChanged.
function GlSourceLines({ transactionId, accountNames, onChanged }: {
  transactionId: string;
  accountNames: Map<string, string>;
  onChanged: () => void;
}) {
  const { data, isLoading, mutate } = useFetch<{ lines: SourceLine[] }>(
    `/api/finance/gl-source-lines?transactionId=${encodeURIComponent(transactionId)}`
  );
  const refresh = async () => { await mutate(); onChanged(); };
  if (isLoading) return <div className="px-3 py-2"><Loader2 className="h-4 w-4 animate-spin text-muted-foreground" /></div>;
  const lines = data?.lines ?? [];
  if (lines.length === 0) {
    return <div className="px-3 py-2 text-[11px] text-muted-foreground">No bank lines reference this journal. It may have just been re-keyed; the poster rebuilds it on the next run.</div>;
  }
  return (
    <div className="space-y-1.5 px-3 py-2">
      <div className="text-[10px] uppercase tracking-wide text-muted-foreground">Source bank lines</div>
      {lines.map((l) => (
        <div key={l.id} className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs">
          <span className="whitespace-nowrap tabular-nums text-muted-foreground">{l.txnDate}</span>
          <span className="min-w-0 flex-1 break-words">{l.description}</span>
          <CategoryChip bankLineId={l.id} category={l.category} direction={l.direction} accountNames={accountNames} onSaved={refresh} />
          {l.matchedInvoice && <MatchedChip bankLineId={l.id} invoice={l.matchedInvoice} onSaved={refresh} />}
          <span className="whitespace-nowrap tabular-nums">{RM(l.amount)} <span className="text-[10px] text-muted-foreground">{l.direction}</span></span>
        </div>
      ))}
    </div>
  );
}

function DrillDown({ code, start, end, outletId, consolidated, onChanged }: { code: string; start: string; end: string; outletId?: string; consolidated?: boolean; onChanged?: () => void }) {
  const { data, isLoading, mutate } = useFetch<{ lines: DrillLine[] }>(
    `/api/finance/reports/drilldown?accountCode=${encodeURIComponent(code)}&start=${start}&end=${end}${consolidated ? "&companyId=consolidated" : outletId ? `&outletId=${outletId}` : ""}`
  );
  const { data: acctData } = useFetch<{ accounts: { code: string; name: string }[] }>("/api/finance/accounts");
  const accountNames = new Map((acctData?.accounts ?? []).map((a) => [a.code, a.name]));
  const [openRow, setOpenRow] = useState<string | null>(null);

  // Any fix (recategorise, unmatch) refreshes the drill AND the report behind
  // it, so the totals move without a page reload.
  const refresh = async () => { await mutate(); onChanged?.(); };
  if (isLoading) return <div className="p-6"><Loader2 className="h-5 w-5 animate-spin" /></div>;
  if (!data) return null;
  if (data.lines.length === 0) {
    return <div className="p-6 text-sm text-muted-foreground">No entries in this period.</div>;
  }

  const hasDebit = data.lines.some((l) => l.debit > 0);
  const hasCredit = data.lines.some((l) => l.credit > 0);
  const oneSided = !(hasDebit && hasCredit);
  const amountOf = (l: DrillLine) => (l.debit > 0 ? l.debit : l.credit > 0 ? l.credit : l.amount);
  const totalDebit = data.lines.reduce((s, l) => s + l.debit, 0);
  const totalCredit = data.lines.reduce((s, l) => s + l.credit, 0);
  // Multi-company drill (consolidated) → show which entity each line belongs to.
  const showCompany = consolidated && data.lines.some((l) => l.meta?.company);
  const cols = 2 + (showCompany ? 1 : 0) + (oneSided ? 1 : 2);

  const splitDesc = (d: string): [string, string | null] => {
    const parts = d.split(" · ");
    return parts.length > 1 ? [parts[0], parts.slice(1).join(" · ")] : [d, null];
  };

  return (
    <div className="min-h-0 flex-1 overflow-y-auto p-4 sm:p-6">
      <table className="w-full text-sm">
        <thead className="sticky top-0 bg-background text-left text-xs uppercase tracking-wide text-muted-foreground">
          <tr className="border-b">
            <th className="w-16 py-2 pr-2 font-medium">Date</th>
            <th className="py-2 pr-2 font-medium">Description</th>
            {showCompany && <th className="w-36 py-2 pr-2 font-medium">Company</th>}
            {oneSided
              ? <th className="w-28 py-2 text-right font-medium">Amount</th>
              : <>
                  <th className="w-24 py-2 text-right font-medium">Debit</th>
                  <th className="w-24 py-2 text-right font-medium">Credit</th>
                </>}
          </tr>
        </thead>
        <tbody className="divide-y">
          {data.lines.map((l, i) => {
            const [main, metaLine] = splitDesc(l.description);
            const key = `${l.transactionId}-${i}`;
            // Three flavors of expandable row: bank lines and assets show a
            // detail panel; bank-agent journals (Balance Sheet drill) expand
            // into their source bank lines with the same chips.
            const isBankRow = !!l.meta?.bankLineId;
            const isBankJournal = !isBankRow && l.meta?.glAgent === "bank";
            const hasDetail = !!l.meta && !l.meta.glAgent;
            const expandable = hasDetail || isBankJournal;
            const open = openRow === key;
            return (
              <Fragment key={key}>
              <tr className={`align-top ${expandable ? "cursor-pointer hover:bg-muted/30" : ""}`}
                  onClick={expandable ? () => setOpenRow(open ? null : key) : undefined}
                  title={expandable ? (isBankJournal ? "Click to see the source bank lines" : "Click to see the transaction detail") : undefined}>
                <td className="whitespace-nowrap py-2 pr-2 text-xs tabular-nums text-muted-foreground">{l.txnDate.slice(5)}</td>
                <td className="break-words py-2 pr-2">
                  <span className="flex items-start gap-1">
                    {expandable && <span className="mt-0.5 text-[10px] text-muted-foreground">{open ? "▾" : "▸"}</span>}
                    <span>
                      {main}{metaLine && <span className="block text-[11px] leading-snug text-muted-foreground">{metaLine}</span>}
                      {isBankRow && l.meta?.bankLineId && (
                        <span className="mt-1 flex flex-wrap items-center gap-1">
                          <CategoryChip
                            bankLineId={l.meta.bankLineId}
                            category={l.meta.category ?? null}
                            direction={l.meta.direction ?? (l.credit > 0 ? "CR" : "DR")}
                            accountNames={accountNames}
                            onSaved={refresh}
                          />
                          {l.meta.matchedInvoice && (
                            <MatchedChip bankLineId={l.meta.bankLineId} invoice={l.meta.matchedInvoice} onSaved={refresh} />
                          )}
                        </span>
                      )}
                    </span>
                  </span>
                </td>
                {showCompany && <td className="py-2 pr-2 text-xs text-muted-foreground">{l.meta?.company ?? "—"}</td>}
                {oneSided
                  ? <td className="whitespace-nowrap py-2 text-right tabular-nums">{RM(amountOf(l))}</td>
                  : <>
                      <td className="whitespace-nowrap py-2 text-right tabular-nums">{l.debit ? RM(l.debit) : ""}</td>
                      <td className="whitespace-nowrap py-2 text-right tabular-nums">{l.credit ? RM(l.credit) : ""}</td>
                    </>}
              </tr>
              {open && isBankJournal && (
                <tr className="bg-muted/20">
                  <td colSpan={cols} className="p-0" onClick={(e) => e.stopPropagation()}>
                    <GlSourceLines transactionId={l.transactionId} accountNames={accountNames} onChanged={refresh} />
                  </td>
                </tr>
              )}
              {open && hasDetail && l.meta && (
                <tr className="bg-muted/20">
                  <td colSpan={cols} className="px-3 py-2">
                    <dl className="grid grid-cols-[7rem_1fr] gap-x-3 gap-y-1 text-[11px]">
                      {l.meta.account && (<><dt className="text-muted-foreground">Bank account</dt><dd>{l.meta.account}</dd></>)}
                      {l.meta.reference && (<><dt className="text-muted-foreground">Reference</dt><dd className="break-words">{l.meta.reference}</dd></>)}
                      {l.meta.category !== undefined && (<><dt className="text-muted-foreground">Category</dt><dd>{l.meta.category ? l.meta.category.toLowerCase().replace(/_/g, " ") : "unclassified"}</dd></>)}
                      {l.meta.matchedInvoice && (<><dt className="text-muted-foreground">Matched invoice</dt><dd>{l.meta.matchedInvoice.invoiceNumber ?? "(no number)"}{l.meta.matchedInvoice.vendor ? ` · ${l.meta.matchedInvoice.vendor}` : ""} · {RM(l.meta.matchedInvoice.amount)}</dd></>)}
                      <><dt className="text-muted-foreground">Inter-company</dt><dd>{l.meta.isInterCo ? "yes" : "no"}</dd></>
                      {(l.meta.classifiedBy || l.meta.ruleName) && (<><dt className="text-muted-foreground">Classified</dt><dd>{l.meta.classifiedBy ?? "rule"}{l.meta.ruleName ? ` · ${l.meta.ruleName}` : ""}</dd></>)}
                    </dl>
                  </td>
                </tr>
              )}
              </Fragment>
            );
          })}
        </tbody>
        <tfoot>
          <tr className="border-t-2 font-semibold">
            <td className="py-2 pr-2" colSpan={showCompany ? 3 : 2}>Total · {data.lines.length} entries</td>
            {oneSided
              ? <td className="whitespace-nowrap py-2 text-right tabular-nums">{RM(totalDebit + totalCredit)}</td>
              : <>
                  <td className="whitespace-nowrap py-2 text-right tabular-nums">{RM(totalDebit)}</td>
                  <td className="whitespace-nowrap py-2 text-right tabular-nums">{RM(totalCredit)}</td>
                </>}
          </tr>
        </tfoot>
      </table>
    </div>
  );
}

// ─── Balance Sheet tab ──────────────────────────────────────────

type BsLine = { code: string; name: string; amount: number; parentCode: string | null };
type BsSection = { total: number; lines: BsLine[] };

type BsReport = {
  companyId: string;
  asOf: string;
  assets: BsSection;
  liabilities: BsSection;
  equity: BsSection;
  totalLiabilitiesAndEquity: number;
  imbalance: number;
  intercoResidual?: number;
};

function BsSectionTable({ title, total, lines, onDrill, cmpByCode, cmpTotal, showCompare, signed }: { title: string; total: number; lines: BsLine[]; onDrill: (code: string) => void; cmpByCode?: Map<string, number>; cmpTotal?: number | null; showCompare?: boolean; signed?: boolean }) {
  const tone = signed ? (total < 0 ? "text-rose-600 dark:text-rose-400" : "text-emerald-600 dark:text-emerald-400") : "";
  return (
    <div className="rounded-md border bg-card">
      <header className="sticky top-0 z-10 rounded-t-md bg-card">
        <div className="rounded-t-md border-b bg-muted/30 px-3 py-2 text-xs uppercase tracking-wide text-muted-foreground">
          {title}
        </div>
      </header>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <tbody>
            {lines.map((l, i) => {
              const c = cmpByCode?.get(l.code);
              return (
              <tr key={l.code} className={`group cursor-pointer border-t ${i % 2 === 1 ? "bg-muted/20" : ""} hover:bg-muted/30`} onClick={() => onDrill(l.code)} title="Show journal lines">
                <td
                  className="whitespace-nowrap px-3 py-1.5 text-xs tabular-nums text-muted-foreground"
                  style={{ paddingLeft: l.parentCode ? 32 : 12 }}
                >
                  {l.code}
                </td>
                <td className="px-3 py-1.5">{l.name}</td>
                <td className="whitespace-nowrap px-3 py-1.5 text-right tabular-nums">
                  <span className="underline-offset-2 group-hover:underline">{RM(l.amount)}</span>
                </td>
                {showCompare && <td className="whitespace-nowrap px-3 py-1.5 text-right tabular-nums text-muted-foreground">{c == null ? "" : RM(c)}</td>}
                {showCompare && <td className="whitespace-nowrap px-3 py-1.5 text-right text-xs tabular-nums text-muted-foreground">{pctChange(l.amount, c)}</td>}
              </tr>
            );})}
            <tr className="border-t bg-muted/30">
              <td colSpan={2} className="px-3 py-2 font-semibold">Total {title}</td>
              <td className={`whitespace-nowrap px-3 py-2 text-right tabular-nums font-semibold ${tone}`}>{RM(total)}</td>
              {showCompare && <td className="whitespace-nowrap px-3 py-2 text-right tabular-nums font-semibold text-muted-foreground">{cmpTotal == null ? "—" : RM(cmpTotal)}</td>}
              {showCompare && <td className="whitespace-nowrap px-3 py-2 text-right text-xs tabular-nums font-semibold text-muted-foreground">{pctChange(total, cmpTotal)}</td>}
            </tr>
          </tbody>
        </table>
      </div>
    </div>
  );
}

function BsTab() {
  const { start, end: asOf, consolidated } = useControls();
  const [compare, setCompare] = useState<CompareMode>("none");
  // Consolidation scope applies to the primary AND the comparison fetch, so a
  // group figure is never compared against a single-entity one.
  const scope = consolidated ? "&companyId=consolidated" : "";
  const { data, isLoading, error, mutate } = useFetch<{ report: BsReport }>(
    `/api/finance/reports/balance-sheet?asOf=${asOf}${scope}`
  );
  // A balance sheet compares as-OF dates: the prior period-end (the day before
  // the current period starts) or the same date a year earlier.
  const cmpAsOf = compare === "prev" ? addDaysStr(start, -1) : compare === "year" ? addYearsStr(asOf, -1) : null;
  const { data: cmpData } = useFetch<{ report: BsReport }>(
    cmpAsOf ? `/api/finance/reports/balance-sheet?asOf=${cmpAsOf}${scope}` : null
  );
  const showCompare = compare !== "none" && !!cmpData;
  const cmp = cmpData?.report;
  const cmpByCode = useMemo(() => {
    const m = new Map<string, number>();
    if (cmp) for (const l of [...cmp.assets.lines, ...cmp.liabilities.lines, ...cmp.equity.lines]) m.set(l.code, l.amount);
    return m;
  }, [cmp]);
  const [drillCode, setDrillCode] = useState<string | null>(null);

  return (
    <div className="space-y-4">
      <StatementHeader title="Balance Sheet" periodLine={`As of ${longDate(asOf)}`} />
      {consolidated && (
        <p className="text-[11px] text-muted-foreground">
          Consolidated group balance sheet: all companies summed, inter-company (3600) balances netted to one line.
        </p>
      )}
      <div className="flex flex-wrap items-center gap-2">
        <p className="text-xs text-muted-foreground">Balance as of <span className="tabular-nums">{asOf}</span> (the period end). Click any line to see its journal entries.</p>
        <label className="ml-auto flex items-center gap-1 text-[11px] text-muted-foreground">Compare
          <select value={compare} onChange={(e) => setCompare(e.target.value as CompareMode)} className="h-7 rounded-md border bg-background px-1.5 text-xs">
            <option value="none">off</option>
            <option value="prev">previous period-end</option>
            <option value="year">previous year</option>
          </select>
        </label>
        {showCompare && cmpAsOf && <span className="text-[10px] text-muted-foreground tabular-nums">vs {cmpAsOf}</span>}
      </div>
      {isLoading && <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />}
      {error && (
        <div className="rounded-lg border border-destructive/40 bg-destructive/5 p-3 text-sm text-destructive">
          Failed to load.
        </div>
      )}
      {data && (
        <>
          {data.report.imbalance !== 0 && (
            <div className="flex items-start gap-2 rounded-md border border-amber-500/40 bg-amber-500/5 p-3 text-sm">
              <AlertTriangle className="h-4 w-4 shrink-0 mt-0.5 text-amber-600 dark:text-amber-400" />
              <span>
                Imbalance of {RM(data.report.imbalance)}, likely an unposted period or malformed manual journal.
              </span>
            </div>
          )}
          {data.report.intercoResidual != null && Math.abs(data.report.intercoResidual) > 0.01 && (
            <div className="flex items-start gap-2 rounded-md border border-amber-500/40 bg-amber-500/5 p-3 text-sm">
              <AlertTriangle className="h-4 w-4 shrink-0 mt-0.5 text-amber-600 dark:text-amber-400" />
              <span>
                Inter-company balances do not fully offset: {RM(data.report.intercoResidual)} net remains. One entity is missing (or misbooking) its due-to or due-from leg.
              </span>
            </div>
          )}
          <div className="grid gap-3 lg:grid-cols-2">
            <BsSectionTable title="Assets" total={data.report.assets.total} lines={data.report.assets.lines} onDrill={setDrillCode} cmpByCode={cmpByCode} cmpTotal={cmp?.assets.total} showCompare={showCompare} />
            <div className="space-y-3">
              <BsSectionTable title="Liabilities" total={data.report.liabilities.total} lines={data.report.liabilities.lines} onDrill={setDrillCode} cmpByCode={cmpByCode} cmpTotal={cmp?.liabilities.total} showCompare={showCompare} />
              <BsSectionTable title="Equity" total={data.report.equity.total} lines={data.report.equity.lines} onDrill={setDrillCode} cmpByCode={cmpByCode} cmpTotal={cmp?.equity.total} showCompare={showCompare} signed />
              <div className="rounded-md border bg-muted/20 p-3 text-sm font-semibold">
                Liabilities + Equity:{" "}
                <span className={`tabular-nums ${data.report.totalLiabilitiesAndEquity < 0 ? "text-rose-600 dark:text-rose-400" : ""}`}>{RM(data.report.totalLiabilitiesAndEquity)}</span>
                {showCompare && cmp && <span className="ml-2 text-xs font-normal text-muted-foreground tabular-nums">vs {RM(cmp.totalLiabilitiesAndEquity)} ({pctChange(data.report.totalLiabilitiesAndEquity, cmp.totalLiabilitiesAndEquity)})</span>}
              </div>
            </div>
          </div>
        </>
      )}

      <Sheet open={!!drillCode} onOpenChange={(o) => !o && setDrillCode(null)}>
        <SheetContent side="right" className="w-full sm:max-w-3xl flex flex-col gap-0 p-0">
          <SheetHeader className="border-b px-4 py-4 sm:px-6">
            <SheetTitle>
              {(drillCode && data &&
                [...data.report.assets.lines, ...data.report.liabilities.lines, ...data.report.equity.lines]
                  .find((l) => l.code === drillCode)?.name) ?? drillCode}
            </SheetTitle>
            <p className="text-xs text-muted-foreground tabular-nums">{drillCode} · journal lines through {asOf}</p>
          </SheetHeader>
          {drillCode && <DrillDown code={drillCode} start="2020-01-01" end={asOf} consolidated={consolidated} onChanged={() => mutate()} />}
        </SheetContent>
      </Sheet>
    </div>
  );
}

// ─── Cash Flow tab ──────────────────────────────────────────────

type CfSection = { title: string; total: number; lines: Array<{ label: string; amount: number; code?: string }> };

type CfReport = {
  companyId: string;
  start: string;
  end: string;
  netIncome: number;
  operating: CfSection;
  investing: CfSection;
  financing: CfSection;
  netChangeInCash: number;
  cashAtStart: number;
  cashAtEnd: number;
  reconciliationGap: number;
};

function CfSectionTable({ s, cmp, showCompare }: { s: CfSection; cmp?: CfSection | null; showCompare?: boolean }) {
  // Match the comparison period's lines back to this period by label; a line
  // present now but absent then reads as "new", and vice-versa.
  const cmpByLabel = new Map((cmp?.lines ?? []).map((l) => [l.label, l.amount] as const));
  return (
    <div className="rounded-md border bg-card">
      <header className="sticky top-0 z-10 rounded-t-md bg-card">
        <div className="rounded-t-md border-b bg-muted/30 px-3 py-2 text-xs uppercase tracking-wide text-muted-foreground">
          {s.title}
        </div>
      </header>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <tbody>
            {s.lines.map((l, i) => {
              const prev = showCompare ? (cmpByLabel.has(l.label) ? cmpByLabel.get(l.label)! : null) : undefined;
              return (
                <tr key={i} className={`border-t ${i % 2 === 1 ? "bg-muted/20" : ""} hover:bg-muted/30`}>
                  <td className="px-3 py-1.5">{l.label}</td>
                  <td className="whitespace-nowrap px-3 py-1.5 text-xs text-muted-foreground tabular-nums">
                    {l.code ?? ""}
                  </td>
                  <td
                    className={`whitespace-nowrap px-3 py-1.5 text-right tabular-nums ${
                      l.amount < 0 ? "text-rose-600 dark:text-rose-400" : ""
                    }`}
                  >
                    {RM(l.amount)}
                  </td>
                  {showCompare && <td className="whitespace-nowrap px-3 py-1.5 text-right tabular-nums text-muted-foreground">{prev == null ? "—" : RM(prev)}</td>}
                  {showCompare && <td className="whitespace-nowrap px-3 py-1.5 text-right text-xs tabular-nums text-muted-foreground">{pctChange(l.amount, prev)}</td>}
                </tr>
              );
            })}
            <tr className="border-t bg-muted/30">
              <td colSpan={2} className="px-3 py-2 font-semibold">
                Net cash from {s.title.toLowerCase()}
              </td>
              <td
                className={`whitespace-nowrap px-3 py-2 text-right tabular-nums font-semibold ${
                  s.total < 0 ? "text-rose-600 dark:text-rose-400" : ""
                }`}
              >
                {RM(s.total)}
              </td>
              {showCompare && <td className="whitespace-nowrap px-3 py-2 text-right tabular-nums font-semibold text-muted-foreground">{cmp == null ? "—" : RM(cmp.total)}</td>}
              {showCompare && <td className="whitespace-nowrap px-3 py-2 text-right text-xs tabular-nums font-semibold text-muted-foreground">{pctChange(s.total, cmp?.total)}</td>}
            </tr>
          </tbody>
        </table>
      </div>
    </div>
  );
}

function CfSummaryCard({ label, amount, prev, showCompare, negative }: { label: string; amount: number; prev?: number | null; showCompare?: boolean; negative?: boolean }) {
  const tone = !negative ? "" : amount < 0 ? "text-rose-600 dark:text-rose-400" : amount > 0 ? "text-emerald-600 dark:text-emerald-400" : "";
  return (
    <div className="rounded-md border bg-card p-3">
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className={`truncate text-lg font-semibold tabular-nums ${tone}`}>{RM(amount)}</div>
      {showCompare && (
        <div className="mt-0.5 text-[11px] text-muted-foreground tabular-nums">
          {prev == null ? "vs —" : `vs ${RM(prev)}`} {pctChange(amount, prev) && <span>({pctChange(amount, prev)})</span>}
        </div>
      )}
    </div>
  );
}

function CfTab() {
  const { start, end, consolidated } = useControls();
  const [compare, setCompare] = useState<CompareMode>("none");
  // Consolidation scope applies to the primary AND the comparison fetch.
  const scope = consolidated ? "&companyId=consolidated" : "";
  const { data, isLoading, error } = useFetch<{ report: CfReport }>(
    `/api/finance/reports/cash-flow?start=${start}&end=${end}${scope}`
  );
  // Same compare windows as the P&L: the immediately-preceding equal-length
  // period, or the same dates a year back.
  const cmpRange = useMemo(() => {
    if (compare === "prev") { const cEnd = addDaysStr(start, -1); return { s: addDaysStr(cEnd, -daysBetween(start, end)), e: cEnd }; }
    if (compare === "year") return { s: addYearsStr(start, -1), e: addYearsStr(end, -1) };
    return null;
  }, [compare, start, end]);
  const { data: cmpData } = useFetch<{ report: CfReport }>(
    cmpRange ? `/api/finance/reports/cash-flow?start=${cmpRange.s}&end=${cmpRange.e}${scope}` : null
  );
  const showCompare = compare !== "none" && !!cmpData;
  const cmp = cmpData?.report;

  return (
    <div className="space-y-4">
      <StatementHeader title="Cash Flow Statement" periodLine={`${longDate(start)} to ${longDate(end)}`} />
      {consolidated && (
        <p className="text-[11px] text-muted-foreground">
          Consolidated group cash flow: all companies summed, inter-company transfer legs cancel so only external movements show. Cash at start and end is the group&apos;s total bank position.
        </p>
      )}
      {isLoading && <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />}
      {error && (
        <div className="rounded-lg border border-destructive/40 bg-destructive/5 p-3 text-sm text-destructive">
          Failed to load.
        </div>
      )}
      {data && (
        <div className="space-y-3">
          <div className="flex flex-wrap items-center justify-end gap-2">
            <label className="flex items-center gap-1 text-[11px] text-muted-foreground">Compare
              <select value={compare} onChange={(e) => setCompare(e.target.value as CompareMode)}
                className="h-7 rounded-md border bg-background px-1.5 text-xs">
                <option value="none">off</option>
                <option value="prev">previous period</option>
                <option value="year">previous year</option>
              </select>
            </label>
            {showCompare && cmpRange && <span className="text-[10px] text-muted-foreground tabular-nums">vs {cmpRange.s} → {cmpRange.e}</span>}
          </div>
          <CfSectionTable s={data.report.operating} cmp={cmp?.operating} showCompare={showCompare} />
          <CfSectionTable s={data.report.investing} cmp={cmp?.investing} showCompare={showCompare} />
          <CfSectionTable s={data.report.financing} cmp={cmp?.financing} showCompare={showCompare} />
          <div className="grid gap-3 sm:grid-cols-3">
            <CfSummaryCard label="Cash at start" amount={data.report.cashAtStart} prev={cmp?.cashAtStart} showCompare={showCompare} />
            <CfSummaryCard label="Net change" amount={data.report.netChangeInCash} prev={cmp?.netChangeInCash} showCompare={showCompare} negative />
            <CfSummaryCard label="Cash at end" amount={data.report.cashAtEnd} prev={cmp?.cashAtEnd} showCompare={showCompare} />
          </div>
          {Math.abs(data.report.reconciliationGap) > 0.01 && (
            <div className="flex items-start gap-2 rounded-md border border-amber-500/40 bg-amber-500/5 p-3 text-sm">
              <AlertTriangle className="h-4 w-4 shrink-0 mt-0.5 text-amber-600 dark:text-amber-400" />
              <span>
                Reconciliation gap of {RM(data.report.reconciliationGap)} between
                operating+investing+financing and bank-account ∆.
              </span>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ─── Auditor pack ───────────────────────────────────────────────

function AuditorPack() {
  const [year, setYear] = useState(new Date().getFullYear());
  const [busy, setBusy] = useState(false);
  const [files, setFiles] = useState<Array<{ filename: string; size: number; dataUrl: string }>>([]);
  const [errMsg, setErrMsg] = useState<string | null>(null);

  async function build() {
    setBusy(true);
    setErrMsg(null);
    setFiles([]);
    try {
      const res = await fetch(`/api/finance/reports/auditor-pack?fiscalYear=${year}`);
      const j = await res.json();
      if (!res.ok) setErrMsg(j.error ?? `Failed (${res.status})`);
      else setFiles(j.files);
    } catch (err) {
      setErrMsg(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="rounded-lg border bg-card">
      <header className="flex flex-col gap-2 border-b px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-2 min-w-0">
          <FileText className="h-4 w-4 shrink-0" />
          <span className="font-medium">Auditor pack</span>
          <span className="hidden sm:inline text-xs text-muted-foreground truncate">
            CSV bundle for external audit
          </span>
        </div>
        <div className="flex items-center gap-2">
          <input
            type="number"
            value={year}
            onChange={(e) => setYear(Number(e.target.value))}
            className="h-8 w-24 rounded-md border bg-background px-2 text-sm"
          />
          <Button onClick={build} disabled={busy} size="sm">
            {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />}
            Build pack
          </Button>
        </div>
      </header>
      {errMsg && <div className="px-4 py-2 text-sm text-destructive">{errMsg}</div>}
      {files.length > 0 && (
        <ul className="divide-y">
          {files.map((f) => (
            <li key={f.filename} className="flex items-center justify-between gap-2 px-4 py-2.5 text-sm">
              <span className="min-w-0 truncate font-mono text-xs">{f.filename}</span>
              <Button
                size="xs"
                variant="outline"
                render={<a href={f.dataUrl} download={f.filename} />}
              >
                Download
              </Button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

// ─── Page shell ─────────────────────────────────────────────────

// ─── Trial Balance tab ──────────────────────────────────────────
type TbRow = { code: string; name: string; type: string; debit: number; credit: number };
type Tb = { asOf: string; rows: TbRow[]; totalDebit: number; totalCredit: number; balanced: boolean };

function TbTab({ onDrill }: { onDrill: (code: string) => void }) {
  const { end: asOf } = useControls();
  const [q, setQ] = useState("");
  const { data, isLoading } = useFetch<{ report: Tb }>(`/api/finance/reports/trial-balance?asOf=${asOf}`);
  const rows = (data?.report?.rows ?? []).filter((r) => {
    const t = q.trim().toLowerCase();
    return !t || r.code.toLowerCase().includes(t) || r.name.toLowerCase().includes(t);
  });
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Filter by code or account…" className="h-8 w-56 rounded-md border bg-background px-2 text-sm" />
        <span className="text-xs text-muted-foreground">as of <span className="tabular-nums">{asOf}</span></span>
        {data?.report && (
          <div className="ml-auto flex items-center gap-2">
            <span className={`rounded px-2 py-1 text-xs font-medium ${data.report.balanced ? "bg-green-500/10 text-green-700 dark:text-green-400" : "bg-red-500/10 text-red-600"}`}>
              {data.report.balanced ? "Balanced" : "Out of balance"}
            </span>
            <ExportCsvButton onExport={() => {
              const r = data.report;
              const rows: Array<Array<string | number>> = [["Code", "Account", "Type", "Debit", "Credit"]];
              for (const x of r.rows) rows.push([x.code, x.name, x.type, x.debit || "", x.credit || ""]);
              rows.push(["", "Total", "", r.totalDebit, r.totalCredit]);
              downloadCsv(`trial-balance_${r.asOf}.csv`, rows);
            }} />
          </div>
        )}
      </div>
      {isLoading || !data?.report ? <div className="py-12 text-center text-sm text-muted-foreground">Loading…</div> : (
        <div className="overflow-x-auto rounded-lg border">
          <table className="w-full min-w-[560px] text-sm">
            <thead><tr className="border-b bg-muted/40 text-left text-muted-foreground">
              <th className="px-3 py-2 font-medium">Code</th><th className="px-3 py-2 font-medium">Account</th>
              <th className="px-3 py-2 text-right font-medium">Debit</th><th className="px-3 py-2 text-right font-medium">Credit</th>
            </tr></thead>
            <tbody className="divide-y">
              {rows.map((r) => (
                <tr key={r.code} className="cursor-pointer hover:bg-muted/40" onClick={() => onDrill(r.code)} title="Open in General Ledger">
                  <td className="whitespace-nowrap px-3 py-1.5 text-xs text-muted-foreground tabular-nums">{r.code}</td>
                  <td className="px-3 py-1.5">{r.name}</td>
                  <td className="px-3 py-1.5 text-right tabular-nums">{r.debit ? RM(r.debit) : ""}</td>
                  <td className="px-3 py-1.5 text-right tabular-nums">{r.credit ? RM(r.credit) : ""}</td>
                </tr>
              ))}
            </tbody>
            <tfoot><tr className="border-t-2 font-semibold">
              <td className="px-3 py-2" colSpan={2}>Total</td>
              <td className="px-3 py-2 text-right tabular-nums">{RM(data.report.totalDebit)}</td>
              <td className="px-3 py-2 text-right tabular-nums">{RM(data.report.totalCredit)}</td>
            </tr></tfoot>
          </table>
        </div>
      )}
      <p className="text-[11px] text-muted-foreground">Click any account to open its General Ledger. Fills in as the bank→GL bridge posts.</p>
    </div>
  );
}

// ─── General Ledger tab ─────────────────────────────────────────
type GlEntry = { transactionId: string; postedByAgent: string | null; date: string; txnType: string; description: string; debit: number; credit: number; balance: number };
type Gl = { accountCode: string; accountName: string; start: string; end: string; opening: number; entries: GlEntry[]; closing: number; totalDebit: number; totalCredit: number };

type CoaAccount = { code: string; name: string; type: string };

// Searchable COA picker — nobody should have to know "6000-01" by heart.
// Type a code OR a name fragment ("raw", "rental", "grab") and pick from the
// chart of accounts, the way Xero's Account Transactions report does it.
function AccountPicker({ value, onChange }: { value: string; onChange: (code: string) => void }) {
  const { data } = useFetch<{ accounts: CoaAccount[] }>("/api/finance/accounts");
  const [q, setQ] = useState<string | null>(null); // null = not editing, show the selection
  const [open, setOpen] = useState(false);
  const accounts = data?.accounts ?? [];
  const current = accounts.find((a) => a.code === value);
  const shown = q !== null ? q : current ? `${current.code} · ${current.name}` : value;
  const t = (q ?? "").trim().toLowerCase();
  const matches = (t
    ? accounts.filter((a) => a.code.toLowerCase().startsWith(t) || a.name.toLowerCase().includes(t))
    : accounts
  ).slice(0, 14);
  return (
    <div className="relative">
      <input
        value={shown}
        onFocus={() => { setQ(""); setOpen(true); }}
        onChange={(e) => { setQ(e.target.value); setOpen(true); }}
        onBlur={() => { setOpen(false); setQ(null); }}
        placeholder="Search account code or name…"
        className="h-8 w-64 sm:w-80 rounded-md border bg-background px-2 text-sm"
      />
      {open && matches.length > 0 && (
        <ul className="absolute z-20 mt-1 max-h-72 w-72 sm:w-96 overflow-y-auto rounded-md border bg-card shadow-lg">
          {matches.map((a) => (
            <li key={a.code}>
              <button
                type="button"
                onMouseDown={(e) => { e.preventDefault(); onChange(a.code); setOpen(false); setQ(null); }}
                className={`flex w-full items-baseline gap-2 px-3 py-1.5 text-left text-sm hover:bg-muted/50 ${a.code === value ? "bg-muted/30" : ""}`}
              >
                <span className="w-16 shrink-0 text-xs tabular-nums text-muted-foreground">{a.code}</span>
                <span className="min-w-0 flex-1 truncate">{a.name}</span>
                <span className="shrink-0 text-[10px] uppercase text-muted-foreground">{a.type}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function GlTab({ account, setAccount }: { account: string; setAccount: (c: string) => void }) {
  const { start, end } = useControls();
  const { data, isLoading, error, mutate } = useFetch<{ report: Gl }>(`/api/finance/reports/general-ledger?account=${encodeURIComponent(account)}&start=${start}&end=${end}`);
  const { data: acctData } = useFetch<{ accounts: { code: string; name: string }[] }>("/api/finance/accounts");
  const accountNames = new Map((acctData?.accounts ?? []).map((a) => [a.code, a.name]));
  // Which entry row is expanded to show the journal's source bank lines.
  const [openIdx, setOpenIdx] = useState<number | null>(null);
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <label className="flex items-center gap-2 text-xs text-muted-foreground">Account
          <AccountPicker value={account} onChange={setAccount} />
        </label>
        <span className="text-xs text-muted-foreground tabular-nums">{start} → {end}</span>
        {data?.report && (
          <div className="ml-auto">
            <ExportCsvButton onExport={() => {
              const r = data.report;
              const rows: Array<Array<string | number>> = [["Date", "Description", "Debit", "Credit", "Balance"]];
              rows.push(["", "Opening balance", "", "", r.opening]);
              for (const e of r.entries) rows.push([e.date, e.description, e.debit || "", e.credit || "", e.balance]);
              rows.push(["", "Period total / closing", r.totalDebit, r.totalCredit, r.closing]);
              downloadCsv(`general-ledger_${r.accountCode}_${r.start}_${r.end}.csv`, rows);
            }} />
          </div>
        )}
      </div>
      {error ? <div className="py-12 text-center text-sm text-muted-foreground">No ledger for this account. Pick another account above.</div>
      : isLoading || !data?.report ? <div className="py-12 text-center text-sm text-muted-foreground">Loading…</div> : (
        <div className="overflow-x-auto rounded-lg border">
          <div className="border-b bg-muted/40 px-3 py-2 text-sm font-medium">{data.report.accountCode} · {data.report.accountName}</div>
          <table className="w-full min-w-[640px] text-sm">
            <thead><tr className="border-b text-left text-muted-foreground">
              <th className="px-3 py-2 font-medium">Date</th><th className="px-3 py-2 font-medium">Description</th>
              <th className="px-3 py-2 text-right font-medium">Debit</th><th className="px-3 py-2 text-right font-medium">Credit</th><th className="px-3 py-2 text-right font-medium">Balance</th>
            </tr></thead>
            <tbody className="divide-y">
              <tr className="bg-muted/20 text-muted-foreground"><td className="px-3 py-1.5" colSpan={4}>Opening balance</td><td className="px-3 py-1.5 text-right tabular-nums">{RM(data.report.opening)}</td></tr>
              {data.report.entries.map((e, i) => (
                <Fragment key={i}>
                <tr className="hover:bg-muted/40">
                  <td className="whitespace-nowrap px-3 py-1.5 text-xs text-muted-foreground tabular-nums">{e.date}</td>
                  <td className="px-3 py-1.5 text-xs">
                    <span className="flex items-center gap-1.5">
                      <span className="min-w-0">{e.description}</span>
                      {e.postedByAgent === "bank" && (
                        <button
                          type="button"
                          onClick={() => setOpenIdx(openIdx === i ? null : i)}
                          title="Show the source bank lines behind this journal"
                          className={`shrink-0 rounded p-0.5 text-muted-foreground transition hover:text-foreground ${openIdx === i ? "bg-muted text-foreground" : ""}`}
                        >
                          <ListTree className="h-3.5 w-3.5" />
                        </button>
                      )}
                    </span>
                  </td>
                  <td className="px-3 py-1.5 text-right tabular-nums">{e.debit ? RM(e.debit) : ""}</td>
                  <td className="px-3 py-1.5 text-right tabular-nums">{e.credit ? RM(e.credit) : ""}</td>
                  <td className="px-3 py-1.5 text-right tabular-nums">{RM(e.balance)}</td>
                </tr>
                {openIdx === i && e.postedByAgent === "bank" && (
                  <tr className="bg-muted/20">
                    <td colSpan={5} className="p-0">
                      <GlSourceLines transactionId={e.transactionId} accountNames={accountNames} onChanged={() => mutate()} />
                    </td>
                  </tr>
                )}
                </Fragment>
              ))}
              {data.report.entries.length === 0 && <tr><td colSpan={5} className="px-3 py-4 text-center text-xs text-muted-foreground">No movements in this period.</td></tr>}
            </tbody>
            <tfoot><tr className="border-t-2 font-semibold">
              <td className="px-3 py-2" colSpan={2}>Period total / closing</td>
              <td className="px-3 py-2 text-right tabular-nums">{RM(data.report.totalDebit)}</td>
              <td className="px-3 py-2 text-right tabular-nums">{RM(data.report.totalCredit)}</td>
              <td className="px-3 py-2 text-right tabular-nums">{RM(data.report.closing)}</td>
            </tr></tfoot>
          </table>
        </div>
      )}
    </div>
  );
}

// ─── Aged Payables tab ──────────────────────────────────────────
type AgedRow = { vendor: string; count: number; current: number; d1_30: number; d31_60: number; d61_90: number; d90_plus: number; total: number };
type AgedPayables = { asOf: string; rows: AgedRow[]; totals: { current: number; d1_30: number; d31_60: number; d61_90: number; d90_plus: number }; grandTotal: number; invoiceCount: number };
const AP_COLS: { key: keyof AgedPayables["totals"]; label: string }[] = [
  { key: "current", label: "Current" }, { key: "d1_30", label: "1-30" }, { key: "d31_60", label: "31-60" },
  { key: "d61_90", label: "61-90" }, { key: "d90_plus", label: "90+" },
];

function ApTab() {
  const { end: asOf, outletId } = useControls();
  const [q, setQ] = useState("");
  const { data, isLoading } = useFetch<{ report: AgedPayables }>(
    `/api/finance/reports/aged-payables?asOf=${asOf}${outletId ? `&outletId=${outletId}` : ""}`
  );
  const rows = (data?.report?.rows ?? []).filter((r) => {
    const t = q.trim().toLowerCase();
    return !t || r.vendor.toLowerCase().includes(t);
  });
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Filter by supplier…" className="h-8 w-56 rounded-md border bg-background px-2 text-sm" />
        <span className="text-xs text-muted-foreground">as of <span className="tabular-nums">{asOf}</span></span>
        {data?.report && (
          <div className="ml-auto flex items-center gap-2">
            <span className="text-xs text-muted-foreground">{data.report.invoiceCount} open bills · <span className="font-medium text-foreground">{RM(data.report.grandTotal)}</span> outstanding</span>
            <ExportCsvButton onExport={() => {
              const r = data.report;
              const rows: Array<Array<string | number>> = [["Supplier", "Bills", "Current", "1-30", "31-60", "61-90", "90+", "Total"]];
              for (const x of r.rows) rows.push([x.vendor, x.count, x.current || "", x.d1_30 || "", x.d31_60 || "", x.d61_90 || "", x.d90_plus || "", x.total]);
              rows.push(["Total", r.invoiceCount, r.totals.current, r.totals.d1_30, r.totals.d31_60, r.totals.d61_90, r.totals.d90_plus, r.grandTotal]);
              downloadCsv(`aged-payables_${r.asOf}.csv`, rows);
            }} />
          </div>
        )}
      </div>
      {isLoading || !data?.report ? <div className="py-12 text-center text-sm text-muted-foreground">Loading…</div> : (
        <div className="overflow-x-auto rounded-lg border">
          <table className="w-full min-w-[720px] text-sm">
            <thead><tr className="border-b bg-muted/40 text-left text-muted-foreground">
              <th className="px-3 py-2 font-medium">Supplier</th>
              {AP_COLS.map((c) => <th key={c.key} className="px-3 py-2 text-right font-medium">{c.label}</th>)}
              <th className="px-3 py-2 text-right font-medium">Total</th>
            </tr></thead>
            <tbody className="divide-y">
              {rows.map((r) => (
                <tr key={r.vendor} className="hover:bg-muted/40">
                  <td className="px-3 py-1.5">{r.vendor} <span className="text-[10px] text-muted-foreground">({r.count})</span></td>
                  {AP_COLS.map((c) => <td key={c.key} className={`px-3 py-1.5 text-right tabular-nums ${c.key === "d90_plus" && r[c.key] ? "text-red-600" : ""}`}>{r[c.key] ? RM(r[c.key]) : ""}</td>)}
                  <td className="px-3 py-1.5 text-right font-medium tabular-nums">{RM(r.total)}</td>
                </tr>
              ))}
            </tbody>
            <tfoot><tr className="border-t-2 font-semibold">
              <td className="px-3 py-2">Total</td>
              {AP_COLS.map((c) => <td key={c.key} className="px-3 py-2 text-right tabular-nums">{RM(data.report.totals[c.key])}</td>)}
              <td className="px-3 py-2 text-right tabular-nums">{RM(data.report.grandTotal)}</td>
            </tr></tfoot>
          </table>
        </div>
      )}
      <p className="text-[11px] text-muted-foreground">Open supplier bills by how overdue they are (from due date). Aged Receivables is not shown because sales settle same-day via card/QR/grab, so there is no open receivables ledger.</p>
    </div>
  );
}

// ─── Reconciliation tab ─────────────────────────────────────────
type ReconChannel = {
  code: string; label: string; note: string;
  salesRecognised: number; settledToBank: number; unreconciled: number; pct: number | null;
  months: { month: string; sales: number; settled: number; net: number }[];
};
type QrTender = {
  months: { month: string; sales: number; settled: number; net: number }[];
  salesRecognised: number; settledToBank: number; unreconciled: number; pct: number | null;
};
type Recon = { start: string; end: string; channels: ReconChannel[]; qrTender: QrTender; totals: { salesRecognised: number; settledToBank: number; unreconciled: number } };

function ReconTab() {
  // Default to the matched period: sales archive + bank feed both exist from
  // 2026-01, so the channels net to true fees/timing (before that the bank feed
  // has settlements with no sales side, which reads as a false imbalance).
  const [start, setStart] = useState("2026-01-01");
  const [end, setEnd] = useState(todayMyt());
  const [open, setOpen] = useState<string | null>(null);
  const { data, isLoading } = useFetch<{ report: Recon }>(`/api/finance/reports/reconciliation?start=${start}&end=${end}`);
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-xs text-muted-foreground">Period</span>
        <DateRangePicker start={start} end={end} onChange={(s, e) => { setStart(s); setEnd(e); }} />
      </div>
      {isLoading || !data?.report ? <div className="py-12 text-center text-sm text-muted-foreground">Loading…</div> : (
        <div className="overflow-x-auto rounded-lg border">
          <table className="w-full min-w-[640px] text-sm">
            <thead><tr className="border-b bg-muted/40 text-left text-muted-foreground">
              <th className="px-3 py-2 font-medium">Channel</th>
              <th className="px-3 py-2 text-right font-medium">Sales recognised</th>
              <th className="px-3 py-2 text-right font-medium">Settled to bank</th>
              <th className="px-3 py-2 text-right font-medium">Unreconciled</th>
              <th className="px-3 py-2 text-right font-medium">%</th>
            </tr></thead>
            <tbody className="divide-y">
              {data.report.channels.map((c) => (
                <Fragment key={c.code}>
                  <tr className="cursor-pointer hover:bg-muted/40" onClick={() => setOpen(open === c.code ? null : c.code)} title="Show monthly breakdown">
                    <td className="px-3 py-1.5">
                      <span className="font-medium">{c.label}</span>
                      <span className="ml-2 text-xs text-muted-foreground tabular-nums">{c.code}</span>
                      <div className="text-[11px] text-muted-foreground">{c.note}</div>
                    </td>
                    <td className="px-3 py-1.5 text-right tabular-nums">{RM(c.salesRecognised)}</td>
                    <td className="px-3 py-1.5 text-right tabular-nums">{RM(c.settledToBank)}</td>
                    <td className={`px-3 py-1.5 text-right tabular-nums ${c.unreconciled < 0 ? "text-rose-600 dark:text-rose-400" : ""}`}>{RM(c.unreconciled)}</td>
                    <td className="px-3 py-1.5 text-right text-xs tabular-nums text-muted-foreground">{c.pct === null ? "" : `${c.pct}%`}</td>
                  </tr>
                  {open === c.code && c.months.map((m) => (
                    <tr key={`${c.code}-${m.month}`} className="bg-muted/20 text-xs">
                      <td className="px-3 py-1 pl-8 text-muted-foreground tabular-nums">{m.month}</td>
                      <td className="px-3 py-1 text-right tabular-nums">{RM(m.sales)}</td>
                      <td className="px-3 py-1 text-right tabular-nums">{RM(m.settled)}</td>
                      <td className={`px-3 py-1 text-right tabular-nums ${m.net < 0 ? "text-rose-600 dark:text-rose-400" : ""}`}>{RM(m.net)}</td>
                      <td className="px-3 py-1" />
                    </tr>
                  ))}
                </Fragment>
              ))}
            </tbody>
            <tfoot><tr className="border-t-2 font-semibold">
              <td className="px-3 py-2">Total</td>
              <td className="px-3 py-2 text-right tabular-nums">{RM(data.report.totals.salesRecognised)}</td>
              <td className="px-3 py-2 text-right tabular-nums">{RM(data.report.totals.settledToBank)}</td>
              <td className="px-3 py-2 text-right tabular-nums">{RM(data.report.totals.unreconciled)}</td>
              <td className="px-3 py-2" />
            </tr></tfoot>
          </table>
        </div>
      )}
      <p className="text-[11px] text-muted-foreground">Each sales channel is a debtor account: sales debit it, the bank settlement credits it. The unreconciled net is the expected economics (card timing, Grab commission, cash-not-banked), not an error. Click a channel for the monthly breakdown. Defaults to 2026-01 onward, where both the sales archive and the bank feed exist.</p>

      {data?.report?.qrTender && (
        <div className="mt-4 space-y-2">
          <div className="flex items-baseline justify-between">
            <h3 className="text-sm font-semibold">DuitNow QR tender reconciliation</h3>
            <span className="text-[11px] text-muted-foreground">from tender source, exact to the cent</span>
          </div>
          <div className="overflow-x-auto rounded-lg border">
            <table className="w-full min-w-[520px] text-sm">
              <thead><tr className="border-b bg-muted/40 text-left text-muted-foreground">
                <th className="px-3 py-2 font-medium">Month</th>
                <th className="px-3 py-2 text-right font-medium">QR sales rung</th>
                <th className="px-3 py-2 text-right font-medium">QR settled to bank</th>
                <th className="px-3 py-2 text-right font-medium">Timing gap</th>
              </tr></thead>
              <tbody className="divide-y">
                {data.report.qrTender.months.map((m) => (
                  <tr key={m.month} className="hover:bg-muted/40">
                    <td className="px-3 py-1.5 tabular-nums">{m.month}</td>
                    <td className="px-3 py-1.5 text-right tabular-nums">{RM(m.sales)}</td>
                    <td className="px-3 py-1.5 text-right tabular-nums">{RM(m.settled)}</td>
                    <td className={`px-3 py-1.5 text-right tabular-nums ${Math.abs(m.net) < 1 ? "text-green-700 dark:text-green-400" : m.net < 0 ? "text-rose-600 dark:text-rose-400" : ""}`}>{RM(m.net)}</td>
                  </tr>
                ))}
              </tbody>
              <tfoot><tr className="border-t-2 font-semibold">
                <td className="px-3 py-2">Total</td>
                <td className="px-3 py-2 text-right tabular-nums">{RM(data.report.qrTender.salesRecognised)}</td>
                <td className="px-3 py-2 text-right tabular-nums">{RM(data.report.qrTender.settledToBank)}</td>
                <td className="px-3 py-2 text-right tabular-nums">{RM(data.report.qrTender.unreconciled)}</td>
              </tr></tfoot>
            </table>
          </div>
          <p className="text-[11px] text-muted-foreground">DuitNow QR settles same-day at full value (no commission), so QR sales rung should equal QR settled to the cent. Read from the tender source (StoreHub archive + POS-native QR vs the bank QR category) rather than the commingled Cash &amp; QR ledger account. Each month nets to a small settlement-timing gap; the first month also carries the prior-December QR that settled in January.</p>
        </div>
      )}
    </div>
  );
}

export default function FinanceReportsPage() {
  const [tab, setTab] = useState<"pnl" | "bs" | "cf" | "tb" | "gl" | "ap" | "recon" | "audit">("pnl");
  const [glAccount, setGlAccount] = useState("1000-01"); // shared so TB rows can drill into GL
  const controls = useReportControlsState();
  // Tabs driven by the shared date range + outlet filter. Recon has its own
  // matched-period control; Auditor pack works by fiscal year.
  const usesControls = tab !== "recon" && tab !== "audit";

  return (
    <div className="space-y-4 p-3 sm:p-6">
      <header>
        <h1 className="text-xl sm:text-2xl font-semibold">Reports</h1>
        <p className="mt-0.5 text-xs sm:text-sm text-muted-foreground">
          P&L is source-driven (sales, procurement, ads, bank). Balance Sheet &amp; Cash Flow are ledger-based and fill in as journals post.
        </p>
      </header>

      <nav className="overflow-x-auto -mx-3 px-3 sm:mx-0 sm:px-0">
        <div className="flex min-w-max gap-1 border-b">
          {[
            { id: "pnl", label: "Profit & Loss" },
            { id: "bs", label: "Balance Sheet" },
            { id: "cf", label: "Cash Flow" },
            { id: "tb", label: "Trial Balance" },
            { id: "gl", label: "General Ledger" },
            { id: "ap", label: "Aged Payables" },
            { id: "recon", label: "Reconciliation" },
            { id: "audit", label: "Auditor pack" },
          ].map((t) => (
            <button
              key={t.id}
              onClick={() => setTab(t.id as typeof tab)}
              className={`-mb-px whitespace-nowrap border-b-2 px-3 py-2 text-sm transition ${
                tab === t.id
                  ? "border-foreground"
                  : "border-transparent text-muted-foreground hover:text-foreground"
              }`}
            >
              {t.label}
            </button>
          ))}
        </div>
      </nav>

      {usesControls && <ReportControlsBar c={controls} outletApplies={tab === "pnl" || tab === "ap"} />}

      {(tab === "bs" || tab === "cf") && (
        <div className="rounded-lg border border-amber-500/40 bg-amber-500/5 p-3 text-xs sm:text-sm text-amber-700 dark:text-amber-400">
          <span className="font-medium">Ledger-based.</span>{" "}
          Bank activity, payroll accruals and sales settlements now post to the ledger automatically. Two known gaps remain: unclassified inflows sit in <strong>Suspense (1999)</strong> until they are reconciled (clear them on the Recon page), and pre-June sales journals are partial. Cross-check cash against the <strong>Cashflow</strong> page.
        </div>
      )}

      {usesControls && controls.consolidated && tab !== "pnl" && (
        <p className="text-[11px] text-amber-600">
          Consolidated view applies to the P&amp;L only. This tab shows the active company.
        </p>
      )}

      <ControlsCtx.Provider value={{ start: controls.start, end: controls.end, outletId: controls.outletId, consolidated: controls.consolidated }}>
        {tab === "pnl" && <PnlTab />}
        {tab === "bs" && <BsTab />}
        {tab === "cf" && <CfTab />}
        {tab === "tb" && <TbTab onDrill={(code) => { setGlAccount(code); setTab("gl"); }} />}
        {tab === "gl" && <GlTab account={glAccount} setAccount={setGlAccount} />}
        {tab === "ap" && <ApTab />}
        {tab === "recon" && <ReconTab />}
        {tab === "audit" && <AuditorPack />}
      </ControlsCtx.Provider>
    </div>
  );
}
