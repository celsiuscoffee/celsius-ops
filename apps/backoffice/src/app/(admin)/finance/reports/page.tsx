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
import { Loader2, Download, FileText, AlertTriangle } from "lucide-react";
import { DateRangePicker } from "@/components/date-range-picker";
import { OUTFLOW_CATEGORIES, INFLOW_CATEGORIES, categoryLabel } from "@/lib/finance/cash-categories";

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
        title="Active company — every report is scoped to this legal entity. Consolidated = all companies with inter-company legs eliminated (P&L only)."
      >
        {!co && <option value="">Company…</option>}
        {(co?.companies ?? []).map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}
        <option value="__consolidated__">Consolidated — all companies</option>
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

// Row components live at module scope (not inside PnlTab) so their
// identity is stable across renders; ReportRow takes the drill-down
// callback as a prop instead of closing over PnlTab state.
function ReportRow({ line, totalIncome, onDrill, compareAmount, showCompare }: { line: PnlLine; totalIncome: number; onDrill: (code: string) => void; compareAmount?: number | null; showCompare?: boolean }) {
  return (
    <tr
      className="cursor-pointer border-t transition hover:bg-muted/30"
      onClick={() => onDrill(line.code)}
    >
      <td
        className="whitespace-nowrap px-3 py-1.5 text-xs tabular-nums text-muted-foreground"
        style={{ paddingLeft: line.parentCode ? 32 : 12 }}
      >
        {line.code}
      </td>
      <td className="px-3 py-1.5">{line.name}</td>
      <td className="whitespace-nowrap px-3 py-1.5 text-right tabular-nums">{RM(line.amount)}</td>
      {showCompare && <td className="whitespace-nowrap px-3 py-1.5 text-right tabular-nums text-muted-foreground">{compareAmount == null ? "—" : RM(compareAmount)}</td>}
      {showCompare && <td className="whitespace-nowrap px-3 py-1.5 text-right text-xs tabular-nums text-muted-foreground">{pctChange(line.amount, compareAmount)}</td>}
      <td className="whitespace-nowrap px-3 py-1.5 text-right text-xs tabular-nums text-muted-foreground">{pctOfIncome(line.amount, totalIncome)}</td>
    </tr>
  );
}

function TotalRow({ label, amount, totalIncome, bold = true, compareAmount, showCompare }: { label: string; amount: number; totalIncome: number; bold?: boolean; compareAmount?: number | null; showCompare?: boolean }) {
  const f = bold ? "font-semibold" : "";
  return (
    <tr className="border-t bg-muted/30">
      <td colSpan={2} className={`px-3 py-2 ${f}`}>{label}</td>
      <td className={`whitespace-nowrap px-3 py-2 text-right tabular-nums ${f}`}>{RM(amount)}</td>
      {showCompare && <td className={`whitespace-nowrap px-3 py-2 text-right tabular-nums text-muted-foreground ${f}`}>{compareAmount == null ? "—" : RM(compareAmount)}</td>}
      {showCompare && <td className={`whitespace-nowrap px-3 py-2 text-right text-xs tabular-nums text-muted-foreground ${f}`}>{pctChange(amount, compareAmount)}</td>}
      <td className={`whitespace-nowrap px-3 py-2 text-right text-xs tabular-nums text-muted-foreground ${f}`}>{pctOfIncome(amount, totalIncome)}</td>
    </tr>
  );
}

function SectionHeader({ label, cols }: { label: string; cols: number }) {
  return (
    <tr>
      <td colSpan={cols} className="bg-muted/50 px-3 py-1.5 text-xs uppercase tracking-wide text-muted-foreground">
        {label}
      </td>
    </tr>
  );
}

type CompareMode = "none" | "prev" | "year";

function PnlTab() {
  const { start, end, outletId, consolidated } = useControls();
  const [compare, setCompare] = useState<CompareMode>("none");
  const scope = consolidated ? "&companyId=consolidated" : outletId ? `&outletId=${outletId}` : "";
  const qs = useMemo(() => `start=${start}&end=${end}${scope}`, [start, end, scope]);
  const { data, error, isLoading, mutate } = useFetch<{ report: PnlReport }>(
    `/api/finance/reports/pnl?${qs}`
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
  const cmpByCode = useMemo(() => {
    const m = new Map<string, number>();
    const r = cmpData?.report;
    if (r) for (const l of [...r.income.lines, ...r.cogs.lines, ...r.expenses.lines]) m.set(l.code, l.amount);
    return m;
  }, [cmpData]);
  const cmp = cmpData?.report;
  const cols = 4 + (showCompare ? 2 : 0);
  const [drillCode, setDrillCode] = useState<string | null>(null);

  return (
    <div className="space-y-4">
      {consolidated && (
        <p className="text-[11px] text-muted-foreground">
          Consolidated group P&amp;L: all companies summed with inter-company legs eliminated — HQ-paid salary, Google Ads and management fees count once as group cost. Other tabs stay per-company; switch to a company to drill into a line.
        </p>
      )}
      {!consolidated && outletId && (
        <p className="text-[11px] text-amber-600">
          Per-outlet view: revenue + COGS + outlet-tagged costs only (contribution margin). Shared/HQ opex is paid from the entity account and can&apos;t be split per outlet.
        </p>
      )}

      {isLoading && <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />}
      {error && (
        <div className="rounded-lg border border-destructive/40 bg-destructive/5 p-3 text-sm text-destructive">
          Failed to load.
        </div>
      )}

      {data && (
        <>
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
          <ExportCsvButton onExport={() => {
            const r = data.report;
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
          }} />
        </div>
        <div className="overflow-x-auto rounded-lg border bg-card">
          <table className="w-full text-sm">
            <thead className="bg-muted/40 text-left text-xs uppercase tracking-wide text-muted-foreground">
              <tr>
                <th className="whitespace-nowrap px-3 py-2">Code</th>
                <th className="px-3 py-2">Account</th>
                <th className="whitespace-nowrap px-3 py-2 text-right">Amount</th>
                {showCompare && <th className="whitespace-nowrap px-3 py-2 text-right">{compare === "year" ? "Prev year" : "Prev period"}</th>}
                {showCompare && <th className="whitespace-nowrap px-3 py-2 text-right" title="Change vs comparison period">Δ</th>}
                <th className="whitespace-nowrap px-3 py-2 text-right" title="Share of total income">% of income</th>
              </tr>
            </thead>
            <tbody>
              <SectionHeader label="Income" cols={cols} />
              {data.report.income.lines.map((l) => <ReportRow key={l.code} line={l} totalIncome={data.report.income.total} onDrill={setDrillCode} compareAmount={cmpByCode.get(l.code) ?? null} showCompare={showCompare} />)}
              <TotalRow label="Total Income" amount={data.report.income.total} totalIncome={data.report.income.total} compareAmount={cmp?.income.total} showCompare={showCompare} />

              <SectionHeader label="Cost of Sales" cols={cols} />
              {data.report.cogs.lines.map((l) => <ReportRow key={l.code} line={l} totalIncome={data.report.income.total} onDrill={setDrillCode} compareAmount={cmpByCode.get(l.code) ?? null} showCompare={showCompare} />)}
              <TotalRow label="Total COGS" amount={data.report.cogs.total} totalIncome={data.report.income.total} compareAmount={cmp?.cogs.total} showCompare={showCompare} />
              <TotalRow label="Gross Profit" amount={data.report.grossProfit} totalIncome={data.report.income.total} compareAmount={cmp?.grossProfit} showCompare={showCompare} />

              <SectionHeader label="Expenses" cols={cols} />
              {data.report.expenses.lines.map((l) => <ReportRow key={l.code} line={l} totalIncome={data.report.income.total} onDrill={setDrillCode} compareAmount={cmpByCode.get(l.code) ?? null} showCompare={showCompare} />)}
              <TotalRow label="Total Expenses" amount={data.report.expenses.total} totalIncome={data.report.income.total} compareAmount={cmp?.expenses.total} showCompare={showCompare} />

              <TotalRow label="Net Income" amount={data.report.netIncome} totalIncome={data.report.income.total} compareAmount={cmp?.netIncome} showCompare={showCompare} />
            </tbody>
          </table>
        </div>
        </>
      )}

      <Sheet open={!!drillCode} onOpenChange={(o) => !o && setDrillCode(null)}>
        <SheetContent side="right" className="w-full sm:max-w-3xl flex flex-col gap-0 p-0">
          <SheetHeader className="border-b px-4 py-4 sm:px-6">
            <SheetTitle>
              {(drillCode && data &&
                [...data.report.income.lines, ...data.report.cogs.lines, ...data.report.expenses.lines]
                  .find((l) => l.code === drillCode)?.name) ?? drillCode}
            </SheetTitle>
            {data && (
              <p className="text-xs text-muted-foreground tabular-nums">
                {drillCode} · {data.report.start} → {data.report.end}
              </p>
            )}
          </SheetHeader>
          {drillCode && data && (
            <DrillDown code={drillCode} start={data.report.start} end={data.report.end} outletId={outletId || undefined} consolidated={consolidated} onChanged={() => mutate()} />
          )}
        </SheetContent>
      </Sheet>
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
  const [busyRow, setBusyRow] = useState<string | null>(null);
  const [rowNote, setRowNote] = useState<Record<string, string>>({});

  // Recategorise a bank line straight from the report — the accounting-software
  // way. Books it to the new category (GL re-keys), then refreshes the drill and
  // the P&L behind it.
  async function recategorise(bankLineId: string, category: string) {
    if (!category) return;
    setBusyRow(bankLineId); setRowNote((n) => ({ ...n, [bankLineId]: "" }));
    try {
      const res = await fetch("/api/finance/bank-lines/classify", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ bankLineId, category }),
      });
      const j = await res.json();
      if (!res.ok) setRowNote((n) => ({ ...n, [bankLineId]: j.error ?? `Failed (${res.status})` }));
      else { await mutate(); onChanged?.(); }
    } catch (e) { setRowNote((n) => ({ ...n, [bankLineId]: e instanceof Error ? e.message : String(e) })); }
    finally { setBusyRow(null); }
  }
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
            const expandable = !!l.meta;
            const open = openRow === key;
            return (
              <Fragment key={key}>
              <tr className={`align-top ${expandable ? "cursor-pointer hover:bg-muted/30" : ""}`}
                  onClick={expandable ? () => setOpenRow(open ? null : key) : undefined}
                  title={expandable ? "Click to see the transaction detail" : undefined}>
                <td className="whitespace-nowrap py-2 pr-2 text-xs tabular-nums text-muted-foreground">{l.txnDate.slice(5)}</td>
                <td className="break-words py-2 pr-2">
                  <span className="flex items-start gap-1">
                    {expandable && <span className="mt-0.5 text-[10px] text-muted-foreground">{open ? "▾" : "▸"}</span>}
                    <span>{main}{metaLine && <span className="block text-[11px] leading-snug text-muted-foreground">{metaLine}</span>}</span>
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
              {open && l.meta && (
                <tr className="bg-muted/20">
                  <td colSpan={cols} className="px-3 py-2">
                    <dl className="grid grid-cols-[7rem_1fr] gap-x-3 gap-y-1 text-[11px]">
                      {l.meta.account && (<><dt className="text-muted-foreground">Bank account</dt><dd>{l.meta.account}</dd></>)}
                      {l.meta.reference && (<><dt className="text-muted-foreground">Reference</dt><dd className="break-words">{l.meta.reference}</dd></>)}
                      {l.meta.category !== undefined && (<><dt className="text-muted-foreground">Category</dt><dd>{l.meta.category ? l.meta.category.toLowerCase().replace(/_/g, " ") : "unclassified"}</dd></>)}
                      <><dt className="text-muted-foreground">Inter-company</dt><dd>{l.meta.isInterCo ? "yes" : "no"}</dd></>
                      {(l.meta.classifiedBy || l.meta.ruleName) && (<><dt className="text-muted-foreground">Classified</dt><dd>{l.meta.classifiedBy ?? "rule"}{l.meta.ruleName ? ` · ${l.meta.ruleName}` : ""}</dd></>)}
                    </dl>
                    <div className="mt-2 flex flex-wrap items-center gap-2 border-t pt-2" onClick={(e) => e.stopPropagation()}>
                      <span className="text-[11px] text-muted-foreground">Recategorise to</span>
                      <select defaultValue="" disabled={busyRow === l.transactionId}
                        onChange={(e) => { recategorise(l.transactionId, e.target.value); e.target.value = ""; }}
                        className="h-7 max-w-[280px] rounded border bg-background px-1 text-[11px] disabled:opacity-50">
                        <option value="" disabled>Choose a category…</option>
                        {(l.credit > 0 ? INFLOW_CATEGORIES : OUTFLOW_CATEGORIES).map((c) => (
                          <option key={c} value={c}>{categoryLabel(c, accountNames)}</option>
                        ))}
                      </select>
                      {busyRow === l.transactionId && <Loader2 className="h-3.5 w-3.5 animate-spin text-muted-foreground" />}
                      {rowNote[l.transactionId] && <span className="text-[10px] text-rose-600">{rowNote[l.transactionId]}</span>}
                    </div>
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
};

function BsSectionTable({ title, total, lines, onDrill, cmpByCode, cmpTotal, showCompare }: { title: string; total: number; lines: BsLine[]; onDrill: (code: string) => void; cmpByCode?: Map<string, number>; cmpTotal?: number | null; showCompare?: boolean }) {
  return (
    <div className="overflow-hidden rounded-md border bg-card">
      <header className="border-b bg-muted/30 px-3 py-2 text-xs uppercase tracking-wide text-muted-foreground">
        {title}
      </header>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <tbody>
            {lines.map((l) => {
              const c = cmpByCode?.get(l.code);
              return (
              <tr key={l.code} className="cursor-pointer border-t hover:bg-muted/30" onClick={() => onDrill(l.code)} title="Show journal lines">
                <td
                  className="whitespace-nowrap px-3 py-1.5 text-xs tabular-nums text-muted-foreground"
                  style={{ paddingLeft: l.parentCode ? 32 : 12 }}
                >
                  {l.code}
                </td>
                <td className="px-3 py-1.5">{l.name}</td>
                <td className="whitespace-nowrap px-3 py-1.5 text-right tabular-nums">{RM(l.amount)}</td>
                {showCompare && <td className="whitespace-nowrap px-3 py-1.5 text-right tabular-nums text-muted-foreground">{c == null ? "—" : RM(c)}</td>}
                {showCompare && <td className="whitespace-nowrap px-3 py-1.5 text-right text-xs tabular-nums text-muted-foreground">{pctChange(l.amount, c)}</td>}
              </tr>
            );})}
            <tr className="border-t bg-muted/30">
              <td colSpan={2} className="px-3 py-2 font-semibold">Total {title}</td>
              <td className="whitespace-nowrap px-3 py-2 text-right tabular-nums font-semibold">{RM(total)}</td>
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
  const { start, end: asOf } = useControls();
  const [compare, setCompare] = useState<CompareMode>("none");
  const { data, isLoading, error } = useFetch<{ report: BsReport }>(
    `/api/finance/reports/balance-sheet?asOf=${asOf}`
  );
  // A balance sheet compares as-OF dates: the prior period-end (the day before
  // the current period starts) or the same date a year earlier.
  const cmpAsOf = compare === "prev" ? addDaysStr(start, -1) : compare === "year" ? addYearsStr(asOf, -1) : null;
  const { data: cmpData } = useFetch<{ report: BsReport }>(
    cmpAsOf ? `/api/finance/reports/balance-sheet?asOf=${cmpAsOf}` : null
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
                Imbalance of {RM(data.report.imbalance)} — likely an unposted period or malformed manual journal.
              </span>
            </div>
          )}
          <div className="grid gap-3 lg:grid-cols-2">
            <BsSectionTable title="Assets" total={data.report.assets.total} lines={data.report.assets.lines} onDrill={setDrillCode} cmpByCode={cmpByCode} cmpTotal={cmp?.assets.total} showCompare={showCompare} />
            <div className="space-y-3">
              <BsSectionTable title="Liabilities" total={data.report.liabilities.total} lines={data.report.liabilities.lines} onDrill={setDrillCode} cmpByCode={cmpByCode} cmpTotal={cmp?.liabilities.total} showCompare={showCompare} />
              <BsSectionTable title="Equity" total={data.report.equity.total} lines={data.report.equity.lines} onDrill={setDrillCode} cmpByCode={cmpByCode} cmpTotal={cmp?.equity.total} showCompare={showCompare} />
              <div className="rounded-md border bg-muted/20 p-3 text-sm font-semibold">
                Liabilities + Equity:{" "}
                <span className="tabular-nums">{RM(data.report.totalLiabilitiesAndEquity)}</span>
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
          {drillCode && <DrillDown code={drillCode} start="2020-01-01" end={asOf} />}
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
    <div className="overflow-hidden rounded-md border bg-card">
      <header className="border-b bg-muted/30 px-3 py-2 text-xs uppercase tracking-wide text-muted-foreground">
        {s.title}
      </header>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <tbody>
            {s.lines.map((l, i) => {
              const prev = showCompare ? (cmpByLabel.has(l.label) ? cmpByLabel.get(l.label)! : null) : undefined;
              return (
                <tr key={i} className="border-t">
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
  return (
    <div className="rounded-md border bg-card p-3">
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className={`truncate text-lg font-semibold tabular-nums ${negative && amount < 0 ? "text-rose-600 dark:text-rose-400" : ""}`}>{RM(amount)}</div>
      {showCompare && (
        <div className="mt-0.5 text-[11px] text-muted-foreground tabular-nums">
          {prev == null ? "vs —" : `vs ${RM(prev)}`} {pctChange(amount, prev) && <span>({pctChange(amount, prev)})</span>}
        </div>
      )}
    </div>
  );
}

function CfTab() {
  const { start, end } = useControls();
  const [compare, setCompare] = useState<CompareMode>("none");
  const { data, isLoading, error } = useFetch<{ report: CfReport }>(
    `/api/finance/reports/cash-flow?start=${start}&end=${end}`
  );
  // Same compare windows as the P&L: the immediately-preceding equal-length
  // period, or the same dates a year back.
  const cmpRange = useMemo(() => {
    if (compare === "prev") { const cEnd = addDaysStr(start, -1); return { s: addDaysStr(cEnd, -daysBetween(start, end)), e: cEnd }; }
    if (compare === "year") return { s: addYearsStr(start, -1), e: addYearsStr(end, -1) };
    return null;
  }, [compare, start, end]);
  const { data: cmpData } = useFetch<{ report: CfReport }>(
    cmpRange ? `/api/finance/reports/cash-flow?start=${cmpRange.s}&end=${cmpRange.e}` : null
  );
  const showCompare = compare !== "none" && !!cmpData;
  const cmp = cmpData?.report;

  return (
    <div className="space-y-4">
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
type GlEntry = { date: string; txnType: string; description: string; debit: number; credit: number; balance: number };
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
  const { data, isLoading, error } = useFetch<{ report: Gl }>(`/api/finance/reports/general-ledger?account=${encodeURIComponent(account)}&start=${start}&end=${end}`);
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
                <tr key={i} className="hover:bg-muted/40">
                  <td className="whitespace-nowrap px-3 py-1.5 text-xs text-muted-foreground tabular-nums">{e.date}</td>
                  <td className="px-3 py-1.5 text-xs">{e.description}</td>
                  <td className="px-3 py-1.5 text-right tabular-nums">{e.debit ? RM(e.debit) : ""}</td>
                  <td className="px-3 py-1.5 text-right tabular-nums">{e.credit ? RM(e.credit) : ""}</td>
                  <td className="px-3 py-1.5 text-right tabular-nums">{RM(e.balance)}</td>
                </tr>
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
  { key: "current", label: "Current" }, { key: "d1_30", label: "1–30" }, { key: "d31_60", label: "31–60" },
  { key: "d61_90", label: "61–90" }, { key: "d90_plus", label: "90+" },
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
      <p className="text-[11px] text-muted-foreground">Open supplier bills by how overdue they are (from due date). Aged Receivables is not shown — sales settle same-day via card/QR/grab, so there is no open receivables ledger.</p>
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
            <h3 className="text-sm font-semibold">DuitNow QR — tender reconciliation</h3>
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
