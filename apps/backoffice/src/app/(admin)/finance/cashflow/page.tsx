"use client";

import { useState, useMemo } from "react";
import Link from "next/link";
import { useFetch } from "@/lib/use-fetch";
import { Loader2, AlertTriangle, Banknote, Settings, ArrowRight, TrendingDown, TrendingUp } from "lucide-react";

type Outlet = { id: string; name: string; code: string };

type CashflowBucket = {
  weekStart: string;
  weekEnd: string;
  opening: number;
  salesIn: number;
  otherIn: number;
  invoiceOut: number;
  payrollOut: number;
  marketingOut: number;
  recurringOut: number;
  otherOut: number;
  closing: number;
  invoiceIds: string[];
  recurringExpenseIds: string[];
};

type CashflowResult = {
  asOf: string;
  weeks: number;
  outletId: string | null;
  openingBalance: { amount: number; statementDate: string | null };
  bankFlowsPerDay: { inflow: number; outflow: number; sampleDays: number } | null;
  buckets: CashflowBucket[];
  warnings: string[];
};

const HORIZONS = [4, 8, 12, 26] as const;

function fmtMYR(n: number): string {
  return new Intl.NumberFormat("en-MY", { style: "currency", currency: "MYR", maximumFractionDigits: 0 }).format(n);
}
function fmtMYR2(n: number): string {
  return new Intl.NumberFormat("en-MY", { style: "currency", currency: "MYR", maximumFractionDigits: 2 }).format(n);
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
  const [weeks, setWeeks] = useState<number>(8);
  const [outletId, setOutletId] = useState<string>("");

  const params = new URLSearchParams({ weeks: String(weeks) });
  if (outletId) params.set("outletId", outletId);
  const { data, isLoading } = useFetch<CashflowResult>(`/api/finance/cashflow?${params.toString()}`);
  const { data: outlets } = useFetch<Outlet[]>("/api/settings/outlets");

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
          <select value={outletId} onChange={(e) => setOutletId(e.target.value)} className="rounded-md border border-gray-200 bg-white px-3 py-1.5 text-sm">
            <option value="">All outlets</option>
            {(outlets ?? []).map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}
          </select>
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
          <Link href="/finance/recurring-expenses" className="inline-flex items-center gap-1.5 rounded-md border border-gray-200 bg-white px-3 py-1.5 text-xs font-medium text-gray-700 hover:bg-gray-50">
            <Settings className="h-3.5 w-3.5" /> Recurring
          </Link>
        </div>
      </div>

      {isLoading || !data ? (
        <div className="mt-6 flex justify-center py-12"><Loader2 className="h-5 w-5 animate-spin text-gray-400" /></div>
      ) : (
        <>
          {/* Headline cards */}
          <div className="mt-4 grid grid-cols-2 sm:grid-cols-4 gap-2 sm:gap-3">
            <div className="rounded-lg border border-gray-200 bg-white px-3 py-2.5">
              <p className="text-xs text-gray-500">Opening balance</p>
              <p className="mt-0.5 text-lg font-bold text-gray-900">{fmtMYR2(data.openingBalance.amount)}</p>
              <p className="text-[10px] text-gray-400">
                {data.openingBalance.statementDate ? `Statement: ${data.openingBalance.statementDate}` : "No statement uploaded"}
              </p>
            </div>
            <div className="rounded-lg border border-gray-200 bg-white px-3 py-2.5">
              <p className="text-xs text-gray-500">Projected end of {weeks}w</p>
              <p className={`mt-0.5 text-lg font-bold ${data.buckets[data.buckets.length-1].closing < 0 ? "text-red-600" : "text-gray-900"}`}>
                {fmtMYR2(data.buckets[data.buckets.length-1]?.closing ?? 0)}
              </p>
              <p className="text-[10px] text-gray-400">{data.buckets[data.buckets.length-1]?.weekEnd.slice(0,10)}</p>
            </div>
            <div className="rounded-lg border border-gray-200 bg-white px-3 py-2.5">
              <p className="text-xs text-gray-500">Lowest week</p>
              {lowestWeek ? (
                <>
                  <p className={`mt-0.5 text-lg font-bold ${lowestWeek.closing < 0 ? "text-red-600" : "text-amber-600"}`}>
                    {fmtMYR2(lowestWeek.closing)}
                  </p>
                  <p className="text-[10px] text-gray-400">{shortRange(lowestWeek.weekStart, lowestWeek.weekEnd)}</p>
                </>
              ) : <p className="text-sm text-gray-400">—</p>}
            </div>
            <div className="rounded-lg border border-gray-200 bg-white px-3 py-2.5">
              <p className="text-xs text-gray-500">Net change</p>
              {(() => {
                const last = data.buckets[data.buckets.length-1]?.closing ?? data.openingBalance.amount;
                const delta = last - data.openingBalance.amount;
                const Icon = delta >= 0 ? TrendingUp : TrendingDown;
                return (
                  <p className={`mt-0.5 flex items-center gap-1 text-lg font-bold ${delta >= 0 ? "text-green-600" : "text-red-600"}`}>
                    <Icon className="h-4 w-4" />
                    {fmtMYR2(delta)}
                  </p>
                );
              })()}
              <p className="text-[10px] text-gray-400">over {weeks} weeks</p>
            </div>
          </div>

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

          {/* Chart */}
          {chartData && (
            <div className="mt-4 rounded-xl border border-gray-200 bg-white p-4">
              <p className="mb-2 text-xs font-medium text-gray-500">Projected closing balance</p>
              <Sparkline points={chartData.points} max={chartData.max} min={chartData.min} />
            </div>
          )}

          {/* Table */}
          <div className="mt-4 rounded-xl border border-gray-200 bg-white overflow-x-auto">
            <table className="w-full min-w-[1000px] text-sm">
              <thead>
                <tr className="border-b bg-gray-50/50 text-left text-gray-500">
                  <th className="px-3 py-3 font-medium">Week</th>
                  <th className="px-3 py-3 text-right font-medium">Opening</th>
                  <th className="px-3 py-3 text-right font-medium text-green-600">Sales (forecast)</th>
                  <th className="px-3 py-3 text-right font-medium text-green-600">Other (bank)</th>
                  <th className="px-3 py-3 text-right font-medium text-red-600">Invoices due</th>
                  <th className="px-3 py-3 text-right font-medium text-red-600">Payroll</th>
                  <th className="px-3 py-3 text-right font-medium text-red-600">Marketing</th>
                  <th className="px-3 py-3 text-right font-medium text-red-600">Recurring</th>
                  <th className="px-3 py-3 text-right font-medium text-red-600">Other (bank)</th>
                  <th className="px-3 py-3 text-right font-medium">Closing</th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {data.buckets.map((b) => (
                  <tr key={b.weekStart} className={`hover:bg-gray-50 ${b.closing < 0 ? "bg-red-50/30" : ""}`}>
                    <td className="px-3 py-3 text-xs font-medium text-gray-700">{shortRange(b.weekStart, b.weekEnd)}</td>
                    <td className="px-3 py-3 text-right font-mono text-xs">{fmtMYR(b.opening)}</td>
                    <td className="px-3 py-3 text-right font-mono text-xs text-green-700">{b.salesIn > 0 ? `+${fmtMYR(b.salesIn)}` : "—"}</td>
                    <td className="px-3 py-3 text-right font-mono text-xs text-green-700">{b.otherIn > 0 ? `+${fmtMYR(b.otherIn)}` : "—"}</td>
                    <td className="px-3 py-3 text-right font-mono text-xs text-red-700">{b.invoiceOut > 0 ? `−${fmtMYR(b.invoiceOut)}` : "—"}</td>
                    <td className="px-3 py-3 text-right font-mono text-xs text-red-700">{b.payrollOut > 0 ? `−${fmtMYR(b.payrollOut)}` : "—"}</td>
                    <td className="px-3 py-3 text-right font-mono text-xs text-red-700">{b.marketingOut > 0 ? `−${fmtMYR(b.marketingOut)}` : "—"}</td>
                    <td className="px-3 py-3 text-right font-mono text-xs text-red-700">{b.recurringOut > 0 ? `−${fmtMYR(b.recurringOut)}` : "—"}</td>
                    <td className="px-3 py-3 text-right font-mono text-xs text-red-700">{b.otherOut > 0 ? `−${fmtMYR(b.otherOut)}` : "—"}</td>
                    <td className={`px-3 py-3 text-right font-mono text-xs font-bold ${b.closing < 0 ? "text-red-600" : "text-gray-900"}`}>
                      {fmtMYR(b.closing)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <p className="mt-3 text-[11px] text-gray-400">
            Sales forecast: 12-week day-of-week average{outletId ? " for selected outlet" : ""}. Payroll: 4-month run-rate, projected on the 25th. Marketing: 4-month avg of Google Ads invoices, projected once per month{outletId ? " (HQ-level, excluded from per-outlet view)" : ""}.
            <strong className="text-gray-600"> Other (bank)</strong>: per-day residual from your bank statement period totals, minus everything the synthetic model already covers — captures pickup-app revenue, refunds, card-charged subscriptions, transfers and any other movement the projection isn&apos;t modelling yet.
            {data.bankFlowsPerDay
              ? ` Computed from the last ${data.bankFlowsPerDay.sampleDays} days of bank statements (avg in ${fmtMYR2(data.bankFlowsPerDay.inflow)}/day, out ${fmtMYR2(data.bankFlowsPerDay.outflow)}/day).`
              : " Upload a CSV/Excel statement with period totals to populate."}
          </p>
          <div className="mt-3">
            <Link href="/inventory/invoices" className="inline-flex items-center gap-1 text-xs text-blue-600 hover:underline">
              See unpaid invoice list <ArrowRight className="h-3 w-3" />
            </Link>
          </div>
        </>
      )}
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
