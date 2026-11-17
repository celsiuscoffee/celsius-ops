"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { useFetch } from "@/lib/use-fetch";
import { Loader2, ChevronLeft, TrendingUp, TrendingDown, ArrowRightLeft, Wallet } from "lucide-react";

type MonthRow = { month: string; inflow: number; outflow: number; net: number; closingBalance: number };
type CatRow = { category: string; amount: number; count: number };
type Resp = {
  from: string;
  to: string;
  monthly: MonthRow[];
  totals: { inflow: number; outflow: number; net: number; closingBalance: number };
  topInflow: CatRow[];
  topOutflow: CatRow[];
  accounts: { code: string; name: string }[];
};

const PRESETS: Record<string, number> = { "6m": 6, "12m": 12, "24m": 24, All: 60 };

const CAT_OVERRIDES: Record<string, string> = {
  QR: "QR (DuitNow)",
  CARD: "Card",
  STOREHUB: "StoreHub",
  GASTROHUB: "GastroHub",
  GRAB: "Grab",
  FOODPANDA: "Foodpanda",
  OTHER_INFLOW: "Other inflow",
  OTHER_OUTFLOW: "Other outflow",
  RAW_MATERIALS: "Raw materials",
  EMPLOYEE_SALARY: "Employee salary",
  STATUTORY_PAYMENT: "Statutory (EPF/SOCSO)",
  DIRECTORS_ALLOWANCE: "Directors' allowance",
  INTERCO_PEOPLE: "InterCo (people)",
  DIGITAL_ADS: "Digital ads",
};
function catLabel(c: string): string {
  if (CAT_OVERRIDES[c]) return CAT_OVERRIDES[c];
  return c.charAt(0) + c.slice(1).toLowerCase().replace(/_/g, " ");
}
function fmtMYR(n: number, opts?: { sign?: boolean }): string {
  const s = new Intl.NumberFormat("en-MY", { maximumFractionDigits: 0 }).format(Math.abs(n));
  const prefix = n < 0 ? "−" : opts?.sign ? "+" : "";
  return `${prefix}RM ${s}`;
}
function monthLabel(m: string): string {
  const [y, mo] = m.split("-").map((x) => parseInt(x, 10));
  return new Date(y, mo - 1, 1).toLocaleString("en-MY", { month: "short", year: "2-digit" });
}
function isoMonthsAgo(months: number): string {
  const d = new Date();
  d.setUTCMonth(d.getUTCMonth() - months);
  return d.toISOString().slice(0, 10);
}

export default function MonthlyCashflowPage() {
  const [preset, setPreset] = useState<keyof typeof PRESETS>("12m");
  const [account, setAccount] = useState<string | null>(null); // last4 or null = all
  const [compare, setCompare] = useState(false);

  const months = PRESETS[preset];
  const from = isoMonthsAgo(months);
  const to = isoMonthsAgo(0);
  const prevFrom = isoMonthsAgo(months * 2);
  const prevTo = from;

  const q = (f: string, t: string) => {
    const p = new URLSearchParams({ from: f, to: t });
    if (account) p.set("account", account);
    return `/api/finance/cashflow/monthly?${p.toString()}`;
  };

  const { data, isLoading } = useFetch<Resp>(q(from, to));
  const { data: prev } = useFetch<Resp>(compare ? q(prevFrom, prevTo) : null);

  const maxIn = useMemo(() => Math.max(1, ...(data?.topInflow ?? []).map((c) => c.amount)), [data]);
  const maxOut = useMemo(() => Math.max(1, ...(data?.topOutflow ?? []).map((c) => c.amount)), [data]);
  const maxBar = useMemo(
    () => Math.max(1, ...(data?.monthly ?? []).flatMap((m) => [m.inflow, m.outflow])),
    [data]
  );

  return (
    <div className="px-4 pt-6 pb-10 md:px-8">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <Link href="/finance/cashflow" className="inline-flex items-center gap-1 text-xs text-text-2 hover:text-text-2">
            <ChevronLeft className="h-3 w-3" /> Cashflow
          </Link>
          <h2 className="mt-1 text-2xl font-semibold leading-[30px] tracking-[-0.01em] text-text">Monthly Cash Flow</h2>
          <p className="mt-0.5 text-xs sm:text-sm text-text-2">
            Consolidated net cash flow from Maybank statements (gross — includes inter-company transfers between entities, matching the cash-tracking spreadsheet). Group bank balance is the sum of each entity&rsquo;s month-end balance.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <button
            onClick={() => setCompare((v) => !v)}
            className={`inline-flex items-center gap-1 rounded-lg border px-2.5 py-1.5 text-xs font-medium transition-colors ${compare ? "border-ink bg-ink text-on-ink" : "border-line bg-surface text-text-2 hover:bg-sunken"}`}
          >
            <ArrowRightLeft className="h-3.5 w-3.5" /> Compare vs prev
          </button>
          <div className="flex rounded-lg border border-line bg-surface p-0.5">
            {Object.keys(PRESETS).map((p) => (
              <button
                key={p}
                onClick={() => setPreset(p as keyof typeof PRESETS)}
                className={`rounded-md px-2.5 py-1 text-xs font-medium transition-colors ${preset === p ? "bg-ink text-on-ink" : "text-text-2 hover:bg-sunken"}`}
              >
                {p}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Account / entity filter */}
      {data && data.accounts.length > 0 && (
        <div className="mt-4 flex flex-wrap gap-1.5">
          <button
            onClick={() => setAccount(null)}
            className={`rounded-md border px-3 py-1.5 text-xs font-medium transition-colors ${account === null ? "border-ink bg-ink text-on-ink" : "border-line bg-surface text-text-2 hover:bg-sunken"}`}
          >
            All entities
          </button>
          {data.accounts.map((a) => (
            <button
              key={a.code}
              onClick={() => setAccount(a.code)}
              className={`rounded-md border px-3 py-1.5 text-xs font-medium transition-colors ${account === a.code ? "border-ink bg-ink text-on-ink" : "border-line bg-surface text-text-2 hover:bg-sunken"}`}
            >
              {a.name} ··{a.code}
            </button>
          ))}
        </div>
      )}

      {isLoading || !data ? (
        <div className="mt-6 flex justify-center py-12"><Loader2 className="h-5 w-5 animate-spin text-text-3" /></div>
      ) : data.monthly.length === 0 ? (
        <div className="mt-6 rounded-lg border border-dashed border-line-2 bg-sunken px-4 py-8 text-center">
          <p className="text-sm text-text-2">No bank statements in this period.</p>
          <p className="mt-1 text-xs text-text-3">
            Drop a Maybank PDF on the <Link href="/finance/bank-statements" className="text-brand-text hover:underline">Bank Statements</Link> page, or let the watcher pick up new files.
          </p>
        </div>
      ) : (
        <>
          {/* Summary cards */}
          <div className="mt-4 grid grid-cols-2 gap-3 lg:grid-cols-4">
            <SummaryCard icon={<TrendingUp className="h-4 w-4" />} tone="in" label="Total inflow" value={data.totals.inflow} prev={prev?.totals.inflow} compare={compare} />
            <SummaryCard icon={<TrendingDown className="h-4 w-4" />} tone="out" label="Total outflow" value={data.totals.outflow} prev={prev?.totals.outflow} compare={compare} invertDelta />
            <SummaryCard icon={<ArrowRightLeft className="h-4 w-4" />} tone="net" label="Net cash flow" value={data.totals.net} prev={prev?.totals.net} compare={compare} />
            <SummaryCard icon={<Wallet className="h-4 w-4" />} tone="bal" label="Group bank balance" value={data.totals.closingBalance} prev={prev?.totals.closingBalance} compare={compare} />
          </div>

          {/* Monthly table */}
          <div className="mt-4 overflow-x-auto rounded-lg border border-line bg-surface">
            <table className="min-w-full text-xs sm:text-sm">
              <thead className="bg-sunken text-text-2">
                <tr>
                  <th className="px-3 py-2 text-left font-medium">Month</th>
                  <th className="px-3 py-2 text-right font-medium">Inflow</th>
                  <th className="px-3 py-2 text-right font-medium">Outflow</th>
                  <th className="px-3 py-2 text-right font-medium">Net</th>
                  <th className="px-3 py-2 text-right font-medium">Group bank balance</th>
                  <th className="hidden px-3 py-2 text-left font-medium sm:table-cell">In vs out</th>
                </tr>
              </thead>
              <tbody>
                {data.monthly.map((m) => (
                  <tr key={m.month} className="border-t border-line hover:bg-sunken">
                    <td className="px-3 py-2 font-medium text-text">{monthLabel(m.month)}</td>
                    <td className="px-3 py-2 text-right tabular-nums text-green-700">{fmtMYR(m.inflow)}</td>
                    <td className="px-3 py-2 text-right tabular-nums text-red-700">{fmtMYR(m.outflow)}</td>
                    <td className={`px-3 py-2 text-right font-semibold tabular-nums ${m.net >= 0 ? "text-green-700" : "text-red-700"}`}>{fmtMYR(m.net)}</td>
                    <td className="px-3 py-2 text-right tabular-nums text-text">{fmtMYR(m.closingBalance)}</td>
                    <td className="hidden px-3 py-2 sm:table-cell">
                      <div className="flex h-3 w-40 overflow-hidden rounded-sm bg-sunken">
                        <div className="bg-green-400" style={{ width: `${(m.inflow / maxBar) * 50}%` }} />
                        <div className="bg-red-400" style={{ width: `${(m.outflow / maxBar) * 50}%` }} />
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr className="border-t-2 border-line-2 bg-sunken font-semibold">
                  <td className="px-3 py-2 text-text">Total</td>
                  <td className="px-3 py-2 text-right tabular-nums text-green-700">{fmtMYR(data.totals.inflow)}</td>
                  <td className="px-3 py-2 text-right tabular-nums text-red-700">{fmtMYR(data.totals.outflow)}</td>
                  <td className={`px-3 py-2 text-right tabular-nums ${data.totals.net >= 0 ? "text-green-700" : "text-red-700"}`}>{fmtMYR(data.totals.net)}</td>
                  <td className="px-3 py-2 text-right tabular-nums text-text">{fmtMYR(data.totals.closingBalance)}</td>
                  <td className="hidden sm:table-cell" />
                </tr>
              </tfoot>
            </table>
          </div>

          {/* Category rankings */}
          <div className="mt-4 grid gap-3 lg:grid-cols-2">
            <CategoryPanel title="Top inflow categories" rows={data.topInflow} max={maxIn} tone="in" />
            <CategoryPanel title="Top outflow categories" rows={data.topOutflow} max={maxOut} tone="out" />
          </div>

          <p className="mt-2 text-[11px] text-text-3">
            Inflow/outflow include inter-company transfers between entities (gross). Where an account-month has both an early spreadsheet upload and the PDF import, the richer (PDF) statement is used so totals never double-count.
          </p>
        </>
      )}
    </div>
  );
}

function SummaryCard({
  icon, label, value, prev, compare, tone, invertDelta,
}: {
  icon: React.ReactNode;
  label: string;
  value: number;
  prev?: number;
  compare: boolean;
  tone: "in" | "out" | "net" | "bal";
  invertDelta?: boolean;
}) {
  const color = tone === "in" ? "text-green-700" : tone === "out" ? "text-red-700" : tone === "net" ? (value >= 0 ? "text-green-700" : "text-red-700") : "text-text";
  const delta = compare && prev != null && prev !== 0 ? ((value - prev) / Math.abs(prev)) * 100 : null;
  const good = delta == null ? false : invertDelta ? delta < 0 : delta > 0;
  return (
    <div className="rounded-lg border border-line bg-surface p-3">
      <div className="flex items-center gap-1.5 text-xs text-text-2">{icon}{label}</div>
      <div className={`mt-1 text-lg font-semibold tabular-nums ${color}`}>{fmtMYR(value)}</div>
      {delta != null && (
        <div className={`mt-0.5 text-[11px] font-medium ${good ? "text-green-600" : "text-red-600"}`}>
          {delta >= 0 ? "▲" : "▼"} {Math.abs(delta).toFixed(0)}% vs prev
        </div>
      )}
    </div>
  );
}

function CategoryPanel({ title, rows, max, tone }: { title: string; rows: CatRow[]; max: number; tone: "in" | "out" }) {
  return (
    <div className="rounded-lg border border-line bg-surface p-3">
      <h3 className="text-xs font-semibold uppercase tracking-wide text-text-2">{title}</h3>
      <div className="mt-2 space-y-1.5">
        {rows.slice(0, 10).map((r) => (
          <div key={r.category} className="flex items-center gap-2">
            <div className="w-32 shrink-0 truncate text-xs text-text-2" title={catLabel(r.category)}>{catLabel(r.category)}</div>
            <div className="relative h-4 flex-1 overflow-hidden rounded-sm bg-sunken">
              <div className={`h-full ${tone === "in" ? "bg-green-300" : "bg-red-300"}`} style={{ width: `${(r.amount / max) * 100}%` }} />
            </div>
            <div className="w-24 shrink-0 text-right text-xs tabular-nums text-text">{fmtMYR(r.amount)}</div>
          </div>
        ))}
        {rows.length === 0 && <p className="text-xs text-text-3">No data.</p>}
      </div>
    </div>
  );
}
