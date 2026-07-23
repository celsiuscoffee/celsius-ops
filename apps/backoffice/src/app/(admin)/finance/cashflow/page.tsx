"use client";

import { Fragment, useState, useMemo } from "react";
import Link from "next/link";
import { useFetch } from "@/lib/use-fetch";
import { Loader2, AlertTriangle, Banknote, TrendingDown, TrendingUp, ChevronDown, X } from "lucide-react";
import DailyBalancePanel from "./DailyBalancePanel";
import DailyRunRateStrip from "./DailyRunRateStrip";
import IncomingPanel from "./IncomingPanel";
import PayablesPanel from "./PayablesPanel";
import { DateRangePicker } from "@/components/date-range-picker";

type Outlet = { id: string; name: string; code: string };

type CashflowBucket = {
  weekStart: string;
  weekEnd: string;
  opening: number;
  salesIn: number;
  otherIn: number;
  invoiceOut: number;
  payrollOut: number;
  ptOut: number;
  cogsOut: number;
  marketingOut: number;
  recurringOut: number;
  otherOut: number;
  closing: number;
  invoiceIds: string[];
  recurringExpenseIds: string[];
};

type MonthlyHistory = {
  month: string;
  cashIn: number;
  cashOut: number;
  interCoInflows: number;
  interCoOutflows: number;
  netGenerated: number;
  netSource: 'balance' | 'periodTotals';
  minBalance: number | null;
  minBalanceDate: string | null;
  accountsReporting: number;
};

type Cadence = "DAILY" | "WEEKLY" | "MONTHLY";

type CashGeneratedRow = {
  period: string;
  label: string;
  cashIn: number;
  cashOut: number;
  netGenerated: number;
  minBalance: number | null;
  minBalanceDate: string | null;
  accountsReporting: number;
};

type CashGeneratedResult = {
  cadence: Cadence;
  account: string | null;
  accountLabel: string | null;
  rangeLabel: string;
  rows: CashGeneratedRow[];
  accountsInScope: number;
  reconciled: boolean;
};

// Lookback presets for the single Period control. One vocabulary for the whole
// page — previously the header spoke in weeks, the chart in 30D/90D/6M/12M/Max
// and the table in a date picker, so nothing agreed on "the period".
const PERIODS: { key: string; label: string; days: number | null }[] = [
  { key: "30", label: "30D", days: 30 },
  { key: "90", label: "90D", days: 90 },
  { key: "180", label: "6M", days: 180 },
  { key: "365", label: "12M", days: 365 },
  { key: "max", label: "Max", days: null },
];
function todayMytStr() {
  return new Date(Date.now() + 8 * 3600_000).toISOString().slice(0, 10);
}
function minusDays(days: number) {
  const d = new Date(Date.now() + 8 * 3600_000);
  d.setUTCDate(d.getUTCDate() - days);
  return d.toISOString().slice(0, 10);
}

const CADENCES: { key: Cadence; label: string }[] = [
  { key: "DAILY", label: "Daily" },
  { key: "WEEKLY", label: "Weekly" },
  { key: "MONTHLY", label: "Monthly" },
];

const ACCOUNTS: { code: string; name: string }[] = [
  { code: "4384", name: "Celsius Coffee SB" },
  { code: "2644", name: "Conezion" },
  { code: "9345", name: "Tamarind" },
];

type ProjectedMin = { closing: number; weekStart: string; weekEnd: string };
type ProjectedDailyMin = { date: string; balance: number };

type DailyBalance = {
  asOf: string | null;
  accounts: string[];
  consolidated: { date: string; balance: number }[];
  perAccount: { account: string; points: { date: string; balance: number }[] }[];
  projected: { date: string; balance: number }[];
  minPoint: { date: string; balance: number } | null;
};

type OperatingCashFlow = {
  month: string;
  sales: { card: number; qr: number; storehub: number; grab: number; foodpanda: number; gastrohub: number; meetings: number; total: number };
  costs: { payroll: number; cogs: number; rent: number; utilities: number; marketing: number; software: number; taxCompliance: number; maintenance: number; total: number };
  operatingNet: number;
};

type CashGeneration = {
  lastMonth: { month: string; net: number } | null;
  avg3Month: number | null;
  burnPerMonth: number | null;
  runwayMonths: number | null;
};

type CashflowResult = {
  asOf: string;
  weeks: number;
  outletId: string | null;
  outletIds: string[];
  openingBalance: { amount: number; statementDate: string | null };
  bankFlowsPerDay: { inflow: number; outflow: number; sampleDays: number } | null;
  monthlyHistory: MonthlyHistory[];
  operatingCashFlow: OperatingCashFlow[];
  cashGeneration: CashGeneration;
  projectedMin: ProjectedMin | null;
  projectedDailyMin: ProjectedDailyMin | null;
  dailyBalance: DailyBalance | null;
  buckets: CashflowBucket[];
  warnings: string[];
};

// 13 weeks is the default — the standard treasury 13-week cash flow model
// (a rolling quarter: far enough to see rent/payroll cycles, near enough
// that the committed-payables layer is meaningful).
const HORIZONS = [4, 8, 13, 26] as const;

function fmtMYR(n: number): string {
  return new Intl.NumberFormat("en-MY", { style: "currency", currency: "MYR", maximumFractionDigits: 0 }).format(n);
}
function fmtMYR2(n: number): string {
  return new Intl.NumberFormat("en-MY", { style: "currency", currency: "MYR", maximumFractionDigits: 2 }).format(n);
}
function fmtDay(dateStr: string): string {
  const d = new Date(dateStr + "T12:00:00+08:00");
  return `${d.getDate()} ${d.toLocaleString("en-MY", { month: "short" })}`;
}
// Label a cash-generated bucket for the table's first column. Daily shows
// "5 Jul", weekly shows "Week of 30 Jun", monthly shows the YYYY-MM key.
function fmtCashGenLabel(row: { period: string; label: string }, cadence: Cadence): string {
  if (cadence === "MONTHLY") return row.period;
  if (cadence === "DAILY") return fmtDay(row.period);
  return `Week of ${fmtDay(row.period)}`;
}
// Add N days to a YYYY-MM-DD string (UTC, timezone-agnostic).
function addDaysStr(s: string, n: number): string {
  const d = new Date(`${s}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}
// Whether a cash-generated row overlaps the selected [start, end] range. Empty
// bounds mean no filter. Period granularity follows the cadence: a daily row is
// one day, a weekly row spans its 7-day window, a monthly row spans its month.
function rowInDateRange(row: { period: string }, cadence: Cadence, start: string, end: string): boolean {
  if (!start || !end) return true;
  if (cadence === "MONTHLY") return row.period >= start.slice(0, 7) && row.period <= end.slice(0, 7);
  if (cadence === "DAILY") return row.period >= start && row.period <= end;
  // WEEKLY: row.period is the week start; include if the week overlaps the range.
  return addDaysStr(row.period, 6) >= start && row.period <= end;
}
function shortRange(start: string, end: string): string {
  const s = new Date(start);
  const e = new Date(end);
  const sm = s.toLocaleString("en-MY", { month: "short" });
  const em = e.toLocaleString("en-MY", { month: "short" });
  return sm === em
    ? `${s.getDate()} – ${e.getDate()} ${em}`
    : `${s.getDate()} ${sm} – ${e.getDate()} ${em}`;
}

export default function CashflowPage() {
  const [weeks, setWeeks] = useState<number>(13);
  const [outletIds, setOutletIds] = useState<string[]>([]);
  const [outletPickerOpen, setOutletPickerOpen] = useState(false);
  // Cash-generated table controls: cadence toggle + single-account filter.
  const [cadence, setCadence] = useState<Cadence>("MONTHLY");
  const [account, setAccount] = useState<string>(""); // "" = all accounts
  const [includeInterco, setIncludeInterco] = useState(true); // inter-entity transfers
  // Table filter + sort, client-side over the fetched rows.
  type SortCol = "period" | "cashIn" | "cashOut" | "netGenerated" | "minBalance";
  const [sortCol, setSortCol] = useState<SortCol>("period");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("asc");
  const [netFilter, setNetFilter] = useState<"all" | "pos" | "neg">("all");
  // Date-range filter over the fetched rows. "" = no range (show all). Uses the
  // shared single-calendar range picker (one calendar, click start then end).
  const [dateStart, setDateStart] = useState(() => minusDays(90));
  const [dateEnd, setDateEnd] = useState(() => todayMytStr());
  // Which preset is active ("custom" once a bespoke range is picked). The
  // period drives the chart window, the KPI cards and the table together.
  const [periodKey, setPeriodKey] = useState<string>("90");
  const applyPeriod = (key: string) => {
    setPeriodKey(key);
    const p = PERIODS.find((x) => x.key === key);
    if (!p || p.days == null) { setDateStart(""); setDateEnd(""); return; }
    setDateStart(minusDays(p.days));
    setDateEnd(todayMytStr());
  };
  const periodLabel =
    periodKey === "custom"
      ? `${dateStart || "start"} → ${dateEnd || "today"}`
      : (PERIODS.find((p) => p.key === periodKey)?.label ?? "");
  const toggleSort = (col: SortCol) => {
    if (sortCol === col) setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    else { setSortCol(col); setSortDir(col === "period" ? "asc" : "desc"); }
  };

  const params = new URLSearchParams({ weeks: String(weeks) });
  outletIds.forEach((id) => params.append("outlet", id));
  const { data, isLoading } = useFetch<CashflowResult>(`/api/finance/cashflow?${params.toString()}`);
  const { data: outlets } = useFetch<Outlet[]>("/api/settings/outlets");

  const cashGenParams = new URLSearchParams({ cadence });
  if (account) cashGenParams.set("account", account);
  if (!includeInterco) cashGenParams.set("interco", "exclude");
  const { data: cashGen, isLoading: cashGenLoading } =
    useFetch<CashGeneratedResult>(`/api/finance/cashflow/cash-generated?${cashGenParams.toString()}`);

  // Filter + sort the cash-generated rows client-side.
  const cashGenRows = useMemo(() => {
    if (!cashGen) return [];
    let rows = cashGen.rows.filter((m) => {
      if (netFilter === "pos" && m.netGenerated < 0) return false;
      if (netFilter === "neg" && m.netGenerated >= 0) return false;
      if (!rowInDateRange(m, cadence, dateStart, dateEnd)) return false;
      return true;
    });
    const dir = sortDir === "asc" ? 1 : -1;
    rows = [...rows].sort((a, b) => {
      if (sortCol === "period") return a.period.localeCompare(b.period) * dir;
      const av = sortCol === "minBalance" ? (a.minBalance ?? Number.NEGATIVE_INFINITY) : a[sortCol];
      const bv = sortCol === "minBalance" ? (b.minBalance ?? Number.NEGATIVE_INFINITY) : b[sortCol];
      return (av - bv) * dir;
    });
    return rows;
  }, [cashGen, netFilter, dateStart, dateEnd, sortCol, sortDir, cadence]);

  // Summary KPIs over the filtered cash-generated rows: they move with every
  // cadence / account / interco / period / net filter applied to the table.
  const cashGenSummary = useMemo(() => {
    const rows = cashGenRows;
    if (!rows.length) return null;
    const n = rows.length;
    const totalIn = rows.reduce((s, r) => s + r.cashIn, 0);
    const totalOut = rows.reduce((s, r) => s + r.cashOut, 0);
    const net = rows.reduce((s, r) => s + r.netGenerated, 0);
    const mins = rows.map((r) => r.minBalance).filter((v): v is number => v != null);
    let minBal: number | null = null;
    let minBalRow: (typeof rows)[number] | null = null;
    for (const r of rows) {
      if (r.minBalance == null) continue;
      if (minBal == null || r.minBalance < minBal) { minBal = r.minBalance; minBalRow = r; }
    }
    return { avgIn: totalIn / n, avgOut: totalOut / n, net, minBal: mins.length ? minBal : null, minBalRow, n };
  }, [cashGenRows]);
  const cadenceUnit = cadence === "DAILY" ? "day" : cadence === "WEEKLY" ? "week" : "month";

  const toggleOutlet = (id: string) =>
    setOutletIds((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));
  const clearOutlets = () => setOutletIds([]);
  const outletButtonLabel =
    outletIds.length === 0 ? "All outlets"
    : outletIds.length === 1 ? (outlets?.find((o) => o.id === outletIds[0])?.name ?? "1 outlet")
    : `${outletIds.length} outlets`;

  // Chart bounds — y-axis runs from min(closing, opening, 0) to max(closing).
  const chartData = useMemo(() => {
    if (!data) return null;
    const points = [
      { label: "Now", value: data.openingBalance.amount, end: data.asOf },
      ...data.buckets.map((b) => ({ label: shortRange(b.weekStart, b.weekEnd), value: b.closing, end: b.weekEnd })),
    ];
    const max = Math.max(...points.map((p) => p.value), 0);
    const min = Math.min(...points.map((p) => p.value), 0);
    return { points, max, min };
  }, [data]);

  const lowestWeek = useMemo(() => {
    if (!data) return null;
    return data.buckets.reduce((acc, b) => (acc == null || b.closing < acc.closing ? b : acc), null as CashflowBucket | null);
  }, [data]);

  return (
    <div className="p-3 sm:p-6">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h2 className="text-lg sm:text-xl font-semibold text-gray-900">Cashflow Projection</h2>
          <p className="mt-0.5 text-xs sm:text-sm text-gray-500">
            Weekly cash position based on bank balance, sales forecast, and committed outflows.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {/* Multi-filter outlet picker. Click to toggle the popover; tick
              one or more outlets, click outside to dismiss. Empty selection
              = consolidated "All outlets" view (same as the bank-residual
              view that includes the Other-bank column). */}
          <div className="relative">
            <button
              type="button"
              onClick={() => setOutletPickerOpen((v) => !v)}
              className={`flex items-center gap-1.5 rounded-md border bg-white px-3 py-1.5 text-sm transition-colors ${outletIds.length > 0 ? "border-terracotta text-terracotta-dark" : "border-gray-200 text-gray-700 hover:bg-gray-50"}`}
            >
              {outletButtonLabel}
              {outletIds.length > 0 && (
                <span
                  role="button"
                  onClick={(e) => { e.stopPropagation(); clearOutlets(); }}
                  className="ml-1 rounded-full p-0.5 text-gray-400 hover:bg-gray-100 hover:text-gray-600"
                  aria-label="Clear outlet filter"
                >
                  <X className="h-3 w-3" />
                </span>
              )}
              <ChevronDown className="h-3.5 w-3.5 text-gray-400" />
            </button>
            {outletPickerOpen && (
              <>
                <div className="fixed inset-0 z-10" onClick={() => setOutletPickerOpen(false)} />
                <div className="absolute right-0 z-20 mt-1 w-64 rounded-lg border border-gray-200 bg-white shadow-lg">
                  <div className="flex items-center justify-between border-b border-gray-100 px-3 py-2">
                    <span className="text-xs font-medium text-gray-500">Filter by outlet</span>
                    <button onClick={clearOutlets} className="text-[11px] text-blue-600 hover:underline">Clear</button>
                  </div>
                  <div className="max-h-[280px] overflow-y-auto p-1">
                    {(outlets ?? []).map((o) => {
                      const checked = outletIds.includes(o.id);
                      return (
                        <label key={o.id} className="flex cursor-pointer items-center gap-2 rounded px-2 py-1.5 text-sm text-gray-700 hover:bg-gray-50">
                          <input type="checkbox" checked={checked} onChange={() => toggleOutlet(o.id)} className="rounded border-gray-300 text-terracotta focus:ring-terracotta" />
                          {o.name}
                        </label>
                      );
                    })}
                  </div>
                </div>
              </>
            )}
          </div>
          <div className="flex rounded-lg border border-gray-200 bg-white p-0.5">
            {HORIZONS.map((h) => (
              <button key={h} onClick={() => setWeeks(h)}
                className={`rounded-md px-2.5 py-1 text-xs font-medium transition-colors ${weeks === h ? "bg-terracotta text-white" : "text-gray-600 hover:bg-gray-50"}`}>
                {h}w
              </button>
            ))}
          </div>
          <Link href="/finance/bank-statements" className="inline-flex items-center gap-1.5 rounded-md border border-gray-200 bg-white px-3 py-1.5 text-xs font-medium text-gray-700 hover:bg-gray-50">
            <Banknote className="h-3.5 w-3.5" /> Bank Statements
          </Link>
        </div>
      </div>

      {/* One control bar for the whole page. The balance chart, the KPI cards
          and the cash-generated table all read from these, so everything on
          screen describes the same slice of money. Previously period lived in
          three different vocabularies (weeks / 30D-Max / a date picker) and
          account existed twice, with the controls that drove the KPIs sitting
          BELOW them inside the table toolbar — so nothing told you what window
          you were looking at. */}
      <div className="mt-3 flex flex-wrap items-center gap-2 rounded-lg border border-gray-200 bg-gray-50/60 px-3 py-2">
        <span className="text-[11px] font-medium uppercase tracking-wide text-gray-400">Period</span>
        <div className="flex rounded-lg border border-gray-200 bg-white p-0.5">
          {PERIODS.map((p) => (
            <button
              key={p.key}
              onClick={() => applyPeriod(p.key)}
              className={`rounded-md px-2.5 py-1 text-xs font-medium transition-colors ${periodKey === p.key ? "bg-terracotta text-white" : "text-gray-600 hover:bg-gray-50"}`}
            >
              {p.label}
            </button>
          ))}
        </div>
        <DateRangePicker
          start={dateStart}
          end={dateEnd}
          onChange={(s, e) => { setDateStart(s); setDateEnd(e); setPeriodKey("custom"); }}
          size="xs"
        />

        <span className="mx-1 hidden h-4 w-px bg-gray-200 sm:block" />

        <span className="text-[11px] font-medium uppercase tracking-wide text-gray-400">Scope</span>
        <select
          value={account}
          onChange={(e) => setAccount(e.target.value)}
          className="rounded-md border border-gray-200 bg-white px-2.5 py-1 text-xs text-gray-700 focus:border-terracotta focus:outline-none focus:ring-1 focus:ring-terracotta"
          aria-label="Filter by bank account"
        >
          <option value="">All accounts</option>
          {ACCOUNTS.map((a) => (
            <option key={a.code} value={a.code}>{a.name}</option>
          ))}
        </select>
        <button
          type="button"
          onClick={() => setIncludeInterco((v) => !v)}
          aria-pressed={includeInterco}
          title="Include or exclude inter-entity transfers"
          className={`rounded-md border px-2.5 py-1 text-xs font-medium transition-colors ${includeInterco ? "border-terracotta bg-terracotta/10 text-terracotta" : "border-gray-200 bg-white text-gray-500 hover:bg-gray-50"}`}
        >
          Interco {includeInterco ? "on" : "off"}
        </button>

        <span className="mx-1 hidden h-4 w-px bg-gray-200 sm:block" />

        <span className="text-[11px] font-medium uppercase tracking-wide text-gray-400">Grain</span>
        <div className="flex rounded-lg border border-gray-200 bg-white p-0.5">
          {CADENCES.map((c) => (
            <button
              key={c.key}
              onClick={() => setCadence(c.key)}
              className={`rounded-md px-2.5 py-1 text-xs font-medium transition-colors ${cadence === c.key ? "bg-terracotta text-white" : "text-gray-600 hover:bg-gray-50"}`}
            >
              {c.label}
            </button>
          ))}
        </div>
      </div>

      {isLoading || !data ? (
        <div className="mt-6 flex justify-center py-12"><Loader2 className="h-5 w-5 animate-spin text-gray-400" /></div>
      ) : (
        <>
          {/* Daily bank balance — the hero. Account-level cash position over
              time, with period-overlay comparison and forward projection. */}
          {data.dailyBalance && (
            <div className="mt-4">
              <DailyBalancePanel db={data.dailyBalance} account={account} startDate={dateStart} endDate={dateEnd} />
            </div>
          )}

          {/* Daily run-rate — the true per-day cash-in/out/net off actual bank
              flows (the ~RM10.6k/day the owner reads off the bank), with the
              weekday/weekend split. Sits above the settlement panels because
              those forecast a narrower, forward figure that reads lower. */}
          <div className="mt-4">
            <DailyRunRateStrip account={account || undefined} />
          </div>

          {/* What's landing and what's leaving — the settlement pipeline and
              the committed payables, day by day, side by side. Sits directly
              under the balance so the page reads position → in vs out →
              history. Each panel has its own presets + custom date range. */}
          <div className="mt-4 grid grid-cols-1 gap-4 xl:grid-cols-2">
            <IncomingPanel />
            <PayablesPanel />
          </div>

          {/* Headline KPIs, computed over the FILTERED cash-generated rows,
              so they move with the control bar above. The scope is echoed
              underneath the heading because the single most confusing thing
              about the old layout was not knowing what window a number covered. */}
          <p className="mt-4 text-[11px] text-gray-400">
            Showing <span className="font-medium text-gray-600">{periodLabel}</span>
            {" · "}{account ? (ACCOUNTS.find((a) => a.code === account)?.name ?? account) : "all accounts"}
            {" · "}interco {includeInterco ? "on" : "off"}
            {" · "}per {cadenceUnit}
          </p>
          <div className="mt-1.5 grid grid-cols-2 sm:grid-cols-4 gap-2 sm:gap-3">
            <div className="rounded-lg border border-gray-200 bg-white px-3 py-2.5">
              <p className="text-xs text-gray-500">Avg cash in</p>
              <p className="mt-0.5 text-lg font-bold text-green-600">
                {cashGenSummary ? fmtMYR2(cashGenSummary.avgIn) : "—"}
              </p>
              <p className="text-[10px] text-gray-400">per {cadenceUnit}{cashGenSummary ? ` · ${cashGenSummary.n} ${cadenceUnit}s` : ""}</p>
            </div>
            <div className="rounded-lg border border-gray-200 bg-white px-3 py-2.5">
              <p className="text-xs text-gray-500">Avg cash out</p>
              <p className="mt-0.5 text-lg font-bold text-red-600">
                {cashGenSummary ? fmtMYR2(cashGenSummary.avgOut) : "—"}
              </p>
              <p className="text-[10px] text-gray-400">per {cadenceUnit}</p>
            </div>
            <div className="rounded-lg border border-gray-200 bg-white px-3 py-2.5">
              <p className="text-xs text-gray-500">Min balance</p>
              <p className={`mt-0.5 text-lg font-bold ${cashGenSummary?.minBal == null ? "text-gray-400" : cashGenSummary.minBal < 0 ? "text-red-600" : cashGenSummary.minBal < 10000 ? "text-amber-600" : "text-gray-900"}`}>
                {cashGenSummary?.minBal == null ? "—" : fmtMYR2(cashGenSummary.minBal)}
              </p>
              <p className="text-[10px] text-gray-400">
                {cashGenSummary?.minBalRow?.minBalanceDate
                  ? `lowest, ${cashGenSummary.minBalRow.minBalanceDate}`
                  : "lowest in range"}
              </p>
            </div>
            <div className="rounded-lg border border-gray-200 bg-white px-3 py-2.5">
              <p className="text-xs text-gray-500">Cash generated</p>
              <p className={`mt-0.5 flex items-center gap-1 text-lg font-bold ${!cashGenSummary ? "text-gray-400" : cashGenSummary.net >= 0 ? "text-green-600" : "text-red-600"}`}>
                {cashGenSummary && (cashGenSummary.net >= 0 ? <TrendingUp className="h-4 w-4" /> : <TrendingDown className="h-4 w-4" />)}
                {cashGenSummary ? fmtMYR2(cashGenSummary.net) : "—"}
              </p>
              <p className="text-[10px] text-gray-400">net over {cashGen ? cashGen.rangeLabel : "range"}{includeInterco ? "" : ", interco off"}</p>
            </div>
          </div>

          {/* Cash generated (actuals from bank statements). Daily / Weekly /
              Monthly cadence toggle + single-account filter. Monthly (all
              accounts) is the reconciled header figure; Daily/Weekly are
              summed from individual bank lines. */}
          <div className="mt-4 rounded-xl border border-gray-200 bg-white">
            <div className="flex flex-col gap-2 border-b border-gray-100 px-4 py-2.5 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <p className="text-xs font-semibold uppercase tracking-wide text-gray-500">
                  Cash generated {cadence === "DAILY" ? "per day" : cadence === "WEEKLY" ? "per week" : "per month"} (actual)
                </p>
                <p className="text-[10px] text-gray-400">
                  {cashGen
                    ? `${cashGen.accountLabel ?? "All accounts"} · ${cashGen.rangeLabel} · ${cashGenRows.length}${cashGenRows.length !== cashGen.rows.length ? ` of ${cashGen.rows.length}` : ""} rows`
                    : "Loading..."}
                </p>
              </div>
              {/* Period, account, interco and grain now live in the page
                  control bar. Only the net-sign filter is table-specific. */}
              <div className="flex flex-wrap items-center gap-2">
                <select
                  value={netFilter}
                  onChange={(e) => setNetFilter(e.target.value as "all" | "pos" | "neg")}
                  className="rounded-md border border-gray-200 bg-white px-2.5 py-1 text-xs text-gray-700 focus:border-terracotta focus:outline-none focus:ring-1 focus:ring-terracotta"
                  aria-label="Filter by net sign"
                >
                  <option value="all">All net</option>
                  <option value="pos">Net positive</option>
                  <option value="neg">Net negative</option>
                </select>
              </div>
            </div>
            {cashGenLoading || !cashGen ? (
              <div className="flex justify-center py-10"><Loader2 className="h-5 w-5 animate-spin text-gray-400" /></div>
            ) : cashGen.rows.length === 0 ? (
              <p className="px-4 py-8 text-center text-xs text-gray-400">No bank statement data for this range.</p>
            ) : (
              <>
                <div className="overflow-x-auto">
                  <table className="w-full min-w-[640px] text-sm">
                    <thead>
                      <tr className="border-b bg-gray-50/50 text-left text-gray-500">
                        {([
                          { col: "period" as const, label: cadence === "DAILY" ? "Day" : cadence === "WEEKLY" ? "Week" : "Month", align: "left" },
                          { col: "cashIn" as const, label: "Cash in", align: "right", cls: "text-green-600" },
                          { col: "cashOut" as const, label: "Cash out", align: "right", cls: "text-red-600" },
                          { col: "netGenerated" as const, label: "Net generated", align: "right" },
                          { col: "minBalance" as const, label: "Min balance", align: "right" },
                        ]).map((h) => (
                          <th key={h.col}
                            onClick={() => toggleSort(h.col)}
                            className={`cursor-pointer select-none px-4 py-2 font-medium hover:text-gray-800 ${h.align === "right" ? "text-right" : ""} ${h.cls ?? ""}`}
                            title="Click to sort">
                            {h.label}
                            <span className="ml-0.5 text-[9px] text-gray-400">{sortCol === h.col ? (sortDir === "asc" ? "▲" : "▼") : "↕"}</span>
                          </th>
                        ))}
                        {cashGen.account == null && <th className="px-4 py-2 font-medium">Coverage</th>}
                      </tr>
                    </thead>
                    <tbody className="divide-y">
                      {cashGenRows.map((m) => {
                        const expectedAccounts = cashGen.accountsInScope;
                        const incomplete = cashGen.account == null && m.accountsReporting < expectedAccounts;
                        return (
                          <tr key={m.period} className={`hover:bg-gray-50 ${m.netGenerated < 0 ? "bg-red-50/30" : ""}`}>
                            <td className="px-4 py-2 text-xs font-medium text-gray-700">{fmtCashGenLabel(m, cadence)}</td>
                            <td className="px-4 py-2 text-right font-mono text-xs text-green-700">+{fmtMYR(m.cashIn)}</td>
                            <td className="px-4 py-2 text-right font-mono text-xs text-red-700">−{fmtMYR(m.cashOut)}</td>
                            <td className={`px-4 py-2 text-right font-mono text-xs font-bold ${m.netGenerated >= 0 ? "text-green-700" : "text-red-700"}`}>
                              {m.netGenerated >= 0 ? "+" : ""}{fmtMYR(m.netGenerated)}
                            </td>
                            <td className={`px-4 py-2 text-right font-mono text-xs ${m.minBalance == null ? "text-gray-400" : m.minBalance < 0 ? "text-red-600 font-semibold" : m.minBalance < 10000 ? "text-amber-600" : "text-gray-700"}`}>
                              {m.minBalance == null ? "-" : fmtMYR(m.minBalance)}
                              {m.minBalanceDate && (
                                <span className="ml-1 text-[10px] text-gray-400">({m.minBalanceDate.slice(8, 10)}/{m.minBalanceDate.slice(5, 7)})</span>
                              )}
                            </td>
                            {cashGen.account == null && (
                              <td className="px-4 py-2 text-[11px]">
                                {incomplete
                                  ? <span className="text-amber-600">{m.accountsReporting}/{expectedAccounts} accounts ⚠</span>
                                  : <span className="text-gray-500">{m.accountsReporting}/{expectedAccounts} accounts</span>}
                              </td>
                            )}
                          </tr>
                        );
                      })}
                      {cashGenRows.length === 0 && (
                        <tr>
                          <td colSpan={cashGen.account == null ? 6 : 5} className="px-4 py-6 text-center text-xs text-gray-400">
                            No rows match the filter.
                          </td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                </div>
                <p className="border-t border-gray-100 px-4 py-2 text-[10px] text-gray-400">
                  Net generated = Cash in − Cash out, {includeInterco ? "including" : "excluding"} transfers between Celsius entities. Min balance is the lowest {cashGen.account == null ? "consolidated" : "account"} daily balance reached in the period (always the real bank balance).
                  {cadence === "MONTHLY" && cashGen.reconciled
                    ? " Monthly is the reconciled statement figure that matches the consolidated cash-tracking spreadsheet."
                    : " Daily and weekly are summed from individual bank transactions and may differ by a small amount from the monthly statement totals (bank fees, timing); monthly is the reconciled statement figure."}
                </p>
              </>
            )}
          </div>

          {/* Operating Cash Flow drill-down — sales vs operating costs */}
          {data.operatingCashFlow.length > 0 && (
            <div className="mt-4 rounded-xl border border-gray-200 bg-white">
              <div className="flex items-center justify-between border-b border-gray-100 px-4 py-2.5">
                <div>
                  <p className="text-xs font-semibold uppercase tracking-wide text-gray-500">Operating cash flow (drill-down)</p>
                  <p className="mt-0.5 text-[11px] text-gray-400">
                    Sales minus operating costs only. Excludes loans, capital injections, owner draws (directors), capex (equipment, renovation), one-offs, and InterCo. Tells you if the core business itself generates cash.
                  </p>
                </div>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full min-w-[1100px] text-sm">
                  <thead>
                    <tr className="border-b bg-gray-50/50 text-left text-gray-500">
                      <th className="px-3 py-2 font-medium">Month</th>
                      <th className="px-3 py-2 text-right font-medium text-green-600">Sales</th>
                      <th className="px-3 py-2 text-right font-medium text-red-600">Payroll</th>
                      <th className="px-3 py-2 text-right font-medium text-red-600">COGS</th>
                      <th className="px-3 py-2 text-right font-medium text-red-600">Rent</th>
                      <th className="px-3 py-2 text-right font-medium text-red-600">Utilities</th>
                      <th className="px-3 py-2 text-right font-medium text-red-600">Marketing</th>
                      <th className="px-3 py-2 text-right font-medium text-red-600">Software</th>
                      <th className="px-3 py-2 text-right font-medium text-red-600">Tax/Comp.</th>
                      <th className="px-3 py-2 text-right font-medium text-red-600">Maint.</th>
                      <th className="px-3 py-2 text-right font-medium">Operating net</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y">
                    {data.operatingCashFlow.map((m) => (
                      <tr key={m.month} className={`hover:bg-gray-50 ${m.operatingNet < 0 ? "bg-red-50/30" : ""}`}>
                        <td className="px-3 py-2 text-xs font-medium text-gray-700">{m.month}</td>
                        <td className="px-3 py-2 text-right font-mono text-xs text-green-700" title={`Card ${fmtMYR(m.sales.card)} · QR ${fmtMYR(m.sales.qr)} · StoreHub ${fmtMYR(m.sales.storehub)} · Grab ${fmtMYR(m.sales.grab)} · FoodPanda ${fmtMYR(m.sales.foodpanda)} · GastroHub ${fmtMYR(m.sales.gastrohub)} · Meetings ${fmtMYR(m.sales.meetings)}`}>+{fmtMYR(m.sales.total)}</td>
                        <td className="px-3 py-2 text-right font-mono text-xs text-red-700">{m.costs.payroll > 0 ? `−${fmtMYR(m.costs.payroll)}` : "—"}</td>
                        <td className="px-3 py-2 text-right font-mono text-xs text-red-700">{m.costs.cogs > 0 ? `−${fmtMYR(m.costs.cogs)}` : "—"}</td>
                        <td className="px-3 py-2 text-right font-mono text-xs text-red-700">{m.costs.rent > 0 ? `−${fmtMYR(m.costs.rent)}` : "—"}</td>
                        <td className="px-3 py-2 text-right font-mono text-xs text-red-700">{m.costs.utilities > 0 ? `−${fmtMYR(m.costs.utilities)}` : "—"}</td>
                        <td className="px-3 py-2 text-right font-mono text-xs text-red-700">{m.costs.marketing > 0 ? `−${fmtMYR(m.costs.marketing)}` : "—"}</td>
                        <td className="px-3 py-2 text-right font-mono text-xs text-red-700">{m.costs.software > 0 ? `−${fmtMYR(m.costs.software)}` : "—"}</td>
                        <td className="px-3 py-2 text-right font-mono text-xs text-red-700">{m.costs.taxCompliance > 0 ? `−${fmtMYR(m.costs.taxCompliance)}` : "—"}</td>
                        <td className="px-3 py-2 text-right font-mono text-xs text-red-700">{m.costs.maintenance > 0 ? `−${fmtMYR(m.costs.maintenance)}` : "—"}</td>
                        <td className={`px-3 py-2 text-right font-mono text-xs font-bold ${m.operatingNet >= 0 ? "text-green-700" : "text-red-700"}`}>
                          {m.operatingNet >= 0 ? "+" : ""}{fmtMYR(m.operatingNet)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <p className="border-t border-gray-100 px-4 py-2 text-[10px] text-gray-400">
                Hover the Sales column for per-channel breakdown (Card / QR / StoreHub / Grab / FoodPanda / GastroHub / Meetings). Operating net = Sales − all operating cost columns. Excluded from this view: Loans, Capital, Directors, Equipment, Investments, Other inflow/outflow, InterCo, Transfer not successful.
              </p>
            </div>
          )}

          {/* Warnings */}
          {data.warnings.length > 0 && (
            <div className="mt-3 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2">
              {data.warnings.map((w, i) => (
                <p key={i} className="flex items-start gap-1.5 text-xs text-amber-800">
                  <AlertTriangle className="h-3.5 w-3.5 mt-0.5 shrink-0" />
                  <span>{w}</span>
                </p>
              ))}
            </div>
          )}

          {/* Forward weekly projection — sub-header */}
          <div className="mt-6 mb-2 flex items-center justify-between gap-2 flex-wrap">
            <div>
              <p className="text-xs font-semibold uppercase tracking-wide text-gray-500">{weeks}-week cash flow model</p>
              <p className="text-[11px] text-gray-400">Receipts and disbursements per week, opening → closing. Use the {weeks}w toggle above to change horizon.</p>
            </div>
            <div className="flex flex-wrap items-center gap-3 text-[11px] text-gray-500">
              {data.projectedDailyMin && (
                <span title="Lowest point on the day-by-day projection — the real intra-week dip when salary/rent clear before receipts land.">
                  Lowest day: <span className={`font-mono ${data.projectedDailyMin.balance < 0 ? "text-red-600" : data.projectedDailyMin.balance < 10000 ? "text-amber-600" : "text-gray-700"}`}>{fmtMYR(data.projectedDailyMin.balance)}</span>{" "}
                  ({fmtDay(data.projectedDailyMin.date)})
                </span>
              )}
              {lowestWeek && (
                <span>
                  Lowest week-end: <span className={`font-mono ${lowestWeek.closing < 0 ? "text-red-600" : "text-amber-600"}`}>{fmtMYR(lowestWeek.closing)}</span>{" "}
                  ({shortRange(lowestWeek.weekStart, lowestWeek.weekEnd)})
                </span>
              )}
              {(() => {
                const last = data.buckets[data.buckets.length-1]?.closing ?? data.openingBalance.amount;
                const delta = last - data.openingBalance.amount;
                return (
                  <span>
                    Net change over {weeks}w:{" "}
                    <span className={`font-mono ${delta >= 0 ? "text-green-600" : "text-red-600"}`}>{delta >= 0 ? "+" : ""}{fmtMYR(delta)}</span>
                  </span>
                );
              })()}
            </div>
          </div>

          {/* Chart */}
          {chartData && (
            <div className="rounded-xl border border-gray-200 bg-white p-4">
              <p className="mb-2 text-xs font-medium text-gray-500">Projected closing balance</p>
              <Sparkline points={chartData.points} max={chartData.max} min={chartData.min} />
            </div>
          )}

          {/* The model grid — classic 13-week layout: line items as rows,
              weeks as columns, so the whole quarter reads left to right. */}
          <div className="mt-4">
            <WeeklyModelTable buckets={data.buckets} lowestWeekStart={lowestWeek?.weekStart ?? null} />
          </div>

          <p className="mt-3 text-[11px] text-gray-400">
            Columns derived from classified bank-line categories over the last 90 days. <strong>Sales</strong>: Card + QR + StoreHub + Grab + FoodPanda + GastroHub + Meetings/Events. <strong>COGS</strong>: BOM — this week&apos;s sales × the sales-weighted recipe food-cost % (from menu_margins), netted against committed invoices so the two don&apos;t double-count. <strong>PT wages</strong>: latest published roster cost, one pulse each Friday. <strong>Marketing</strong>: Google Ads + SMS + KOL, one monthly pulse on the 20th. <strong>Recurring</strong>: Rent + Utilities + Software + Tax + Maintenance + bank/loan/licensing on their due dates. <strong>Other outflow</strong>: petty cash, staff claims, and anything not yet categorised.
            {data.bankFlowsPerDay
              ? ` 90-day sample: avg in ${fmtMYR2(data.bankFlowsPerDay.inflow)}/day, out ${fmtMYR2(data.bankFlowsPerDay.outflow)}/day.`
              : " Upload a CSV/Excel statement with period totals to populate."}
          </p>
        </>
      )}
    </div>
  );
}

// Classic 13-week cash flow model grid — line items as rows, weeks as
// columns. Reads like the treasury spreadsheet it replaces: opening balance,
// receipts, disbursements, net, closing, scanning a quarter left to right.
// The lowest-closing week is tinted so the crunch is visible at a glance.
function WeeklyModelTable({ buckets, lowestWeekStart }: { buckets: CashflowBucket[]; lowestWeekStart: string | null }) {
  type Row = {
    label: string;
    value: (b: CashflowBucket) => number;
    kind: "balance" | "in" | "out" | "subtotal-in" | "subtotal-out" | "net";
    section?: string; // section header rendered above this row
  };
  const totalIn = (b: CashflowBucket) => b.salesIn + b.otherIn;
  const totalOut = (b: CashflowBucket) =>
    b.invoiceOut + b.payrollOut + b.ptOut + b.cogsOut + b.marketingOut + b.recurringOut + b.otherOut;
  const rows: Row[] = [
    { label: "Opening balance", value: (b) => b.opening, kind: "balance" },
    { label: "Sales settlements", value: (b) => b.salesIn, kind: "in", section: "Receipts" },
    { label: "Other inflow", value: (b) => b.otherIn, kind: "in" },
    { label: "Total receipts", value: totalIn, kind: "subtotal-in" },
    { label: "Supplier invoices", value: (b) => b.invoiceOut, kind: "out", section: "Disbursements" },
    { label: "Payroll", value: (b) => b.payrollOut, kind: "out" },
    { label: "PT wages (Fri)", value: (b) => b.ptOut, kind: "out" },
    { label: "COGS", value: (b) => b.cogsOut, kind: "out" },
    { label: "Marketing (20th)", value: (b) => b.marketingOut, kind: "out" },
    { label: "Recurring", value: (b) => b.recurringOut, kind: "out" },
    { label: "Other outflow", value: (b) => b.otherOut, kind: "out" },
    { label: "Total disbursements", value: totalOut, kind: "subtotal-out" },
    { label: "Net cash flow", value: (b) => totalIn(b) - totalOut(b), kind: "net" },
    { label: "Closing balance", value: (b) => b.closing, kind: "balance" },
  ];

  const cellText = (kind: Row["kind"], v: number): string => {
    if (kind === "in" || kind === "subtotal-in") return v > 0 ? `+${fmtMYR(v)}` : "—";
    if (kind === "out" || kind === "subtotal-out") return v > 0 ? `−${fmtMYR(v)}` : "—";
    if (kind === "net") return `${v >= 0 ? "+" : ""}${fmtMYR(v)}`;
    return fmtMYR(v);
  };
  const cellCls = (kind: Row["kind"], v: number): string => {
    switch (kind) {
      case "in": return "text-green-700";
      case "subtotal-in": return "font-semibold text-green-700";
      case "out": return "text-red-700";
      case "subtotal-out": return "font-semibold text-red-700";
      case "net": return `font-semibold ${v >= 0 ? "text-green-700" : "text-red-700"}`;
      default: return `font-bold ${v < 0 ? "text-red-600" : "text-gray-900"}`;
    }
  };

  return (
    <div className="rounded-xl border border-gray-200 bg-white overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b bg-gray-50/50 text-gray-500">
            <th className="sticky left-0 z-10 bg-gray-50 px-3 py-2 text-left font-medium">Week</th>
            {buckets.map((b, i) => (
              <th
                key={b.weekStart}
                className={`whitespace-nowrap px-3 py-2 text-right font-medium ${b.weekStart === lowestWeekStart ? "bg-amber-50 text-amber-700" : ""}`}
              >
                <span className="block text-[10px] text-gray-400">W{i + 1}</span>
                {shortRange(b.weekStart, b.weekEnd)}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <Fragment key={row.label}>
              {row.section && (
                <tr className="border-t border-gray-100">
                  <td colSpan={buckets.length + 1} className="sticky left-0 bg-white px-3 pb-0.5 pt-2 text-[10px] font-semibold uppercase tracking-wide text-gray-400">
                    {row.section}
                  </td>
                </tr>
              )}
              <tr
                className={`${row.kind.startsWith("subtotal") || row.kind === "net" ? "border-t border-gray-100" : ""} ${row.label === "Closing balance" ? "border-t-2 border-gray-200 bg-gray-50/50" : "hover:bg-gray-50"}`}
              >
                <td className={`sticky left-0 z-10 whitespace-nowrap px-3 py-1.5 text-xs ${row.label === "Closing balance" ? "bg-gray-50 font-semibold text-gray-900" : "bg-white font-medium text-gray-600"}`}>
                  {row.label}
                </td>
                {buckets.map((b) => {
                  const v = row.value(b);
                  return (
                    <td
                      key={b.weekStart}
                      className={`whitespace-nowrap px-3 py-1.5 text-right font-mono text-xs ${cellCls(row.kind, v)} ${b.weekStart === lowestWeekStart ? "bg-amber-50/60" : ""}`}
                    >
                      {cellText(row.kind, v)}
                    </td>
                  );
                })}
              </tr>
            </Fragment>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// Inline SVG sparkline. Plots y as cash position over time. Negative band
// (where the closing balance dips below zero) is shaded red so Finance can
// eyeball the pinch weeks.
function Sparkline({ points, max, min }: { points: { label: string; value: number; end: string }[]; max: number; min: number }) {
  const W = 800;
  const H = 180;
  const PAD = 28;
  const xStep = points.length > 1 ? (W - PAD * 2) / (points.length - 1) : 0;
  const range = Math.max(1, max - min);
  const y = (v: number) => PAD + (1 - (v - min) / range) * (H - PAD * 2);
  const x = (i: number) => PAD + i * xStep;
  const zeroY = y(0);

  // Path
  const d = points.map((p, i) => `${i === 0 ? "M" : "L"} ${x(i).toFixed(1)} ${y(p.value).toFixed(1)}`).join(" ");
  // Fill area for negative
  const negativeArea = points.length > 1 && min < 0
    ? `M ${x(0).toFixed(1)} ${zeroY} ${points.map((p, i) => `L ${x(i).toFixed(1)} ${Math.max(zeroY, y(p.value)).toFixed(1)}`).join(" ")} L ${x(points.length - 1).toFixed(1)} ${zeroY} Z`
    : null;

  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="w-full h-[180px]" preserveAspectRatio="none">
      {/* Zero line */}
      {min < 0 && (
        <line x1={PAD} x2={W - PAD} y1={zeroY} y2={zeroY} stroke="#fca5a5" strokeWidth={1} strokeDasharray="4 4" />
      )}
      {/* Negative shaded area */}
      {negativeArea && <path d={negativeArea} fill="#fee2e2" />}
      {/* Line */}
      <path d={d} fill="none" stroke="#C2714F" strokeWidth={2.5} strokeLinejoin="round" />
      {/* Dots + labels */}
      {points.map((p, i) => (
        <g key={i}>
          <circle cx={x(i)} cy={y(p.value)} r={3} fill={p.value < 0 ? "#dc2626" : "#C2714F"} />
          {i === 0 || i === points.length - 1 || i % Math.max(1, Math.floor(points.length / 6)) === 0 ? (
            <text x={x(i)} y={H - 6} textAnchor="middle" fontSize={9} fill="#9ca3af">{p.label}</text>
          ) : null}
        </g>
      ))}
    </svg>
  );
}
