"use client";

import { useState, useEffect, useCallback } from "react";
import {
  DollarSign,
  ShoppingCart,
  TrendingUp,
  Loader2,
  Store,
  CalendarDays,
  UtensilsCrossed,
  ShoppingBag,
  Truck,
} from "lucide-react";
import { cn } from "@/lib/utils";

// ─── Types ──────────────────────────────────────────────────────────────

type Period = "daily" | "yesterday" | "last7days" | "last30days" | "weekly" | "monthly" | "custom";

type OutletOption = { id: string; name: string };

type ChannelBreakdown = { revenue: number; orders: number };

type DailyCell = {
  date: string;
  revenue: number;
  orders: number;
  aov: number;
  dineIn: ChannelBreakdown;
  takeaway: ChannelBreakdown;
  delivery: ChannelBreakdown;
};

type RoundData = {
  key: string;
  label: string;
  timeRange: string;
  daily: DailyCell[];
  totals: {
    revenue: number;
    orders: number;
    aov: number;
    dineIn: ChannelBreakdown;
    takeaway: ChannelBreakdown;
    delivery: ChannelBreakdown;
    pctOfTarget: number;
  };
  averages: {
    revenue: number;
    orders: number;
    aov: number;
    dineIn: ChannelBreakdown;
    takeaway: ChannelBreakdown;
    delivery: ChannelBreakdown;
  };
  target: { revenue: number };
};

type DashboardData = {
  period: { from: string; to: string; type: string };
  dates: string[];
  summary: { revenue: number; orders: number; aov: number };
  rounds: RoundData[];
  outsideRounds: { revenue: number; orders: number };
  availableOutlets: OutletOption[];
};

// ─── Helpers ────────────────────────────────────────────────────────────

function formatRM(n: number): string {
  if (n >= 1000) return `${(n / 1000).toFixed(1)}K`;
  return n.toFixed(0);
}

function formatDate(dateStr: string): string {
  const d = new Date(dateStr + "T00:00:00");
  return d.toLocaleDateString("en-MY", { weekday: "short", day: "numeric", month: "short" });
}

function formatDateShort(dateStr: string): string {
  const d = new Date(dateStr + "T00:00:00");
  const day = d.toLocaleDateString("en-MY", { weekday: "short" });
  const num = d.getDate();
  return `${day} ${num}`;
}

const PERIOD_OPTIONS: { key: Period; label: string }[] = [
  { key: "daily", label: "Today" },
  { key: "yesterday", label: "Yesterday" },
  { key: "last7days", label: "Last 7 Days" },
  { key: "last30days", label: "Last 30 Days" },
  { key: "weekly", label: "This Week" },
  { key: "monthly", label: "This Month" },
  { key: "custom", label: "Custom" },
];

function getPeriodLabel(p: Period): string {
  return PERIOD_OPTIONS.find((o) => o.key === p)?.label ?? p;
}

/** Color for % of target */
function targetColor(pct: number): { bg: string; text: string; label: string } {
  if (pct >= 100) return { bg: "bg-green-50", text: "text-green-700", label: "On Target" };
  if (pct >= 80) return { bg: "bg-yellow-50", text: "text-yellow-700", label: "Near Target" };
  if (pct >= 50) return { bg: "bg-orange-50", text: "text-orange-700", label: "Below Target" };
  return { bg: "bg-red-50", text: "text-red-700", label: "Critical" };
}

/** Color for a cell value vs daily target */
function cellColor(val: number, target: number): string {
  if (val === 0) return "text-gray-300";
  const pct = (val / target) * 100;
  if (pct >= 100) return "font-semibold text-green-600";
  if (pct >= 80) return "text-yellow-600";
  if (pct >= 50) return "text-orange-600";
  return "text-red-500";
}

// ─── Component ──────────────────────────────────────────────────────────

export default function SalesDashboard() {
  const [data, setData] = useState<DashboardData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [period, setPeriod] = useState<Period>("daily");
  const [outletId, setOutletId] = useState<string>("all");
  const [customFrom, setCustomFrom] = useState(() => new Date().toISOString().split("T")[0]);
  const [customTo, setCustomTo] = useState(() => new Date().toISOString().split("T")[0]);

  // Active metric tab for the grid
  const [activeMetric, setActiveMetric] = useState<"revenue" | "orders" | "aov">("revenue");

  const loadData = useCallback(
    async (p: Period, outlet: string, cFrom?: string, cTo?: string) => {
      setLoading(true);
      setError(null);
      try {
        let url = `/api/sales/dashboard?period=${p}`;
        if (outlet !== "all") url += `&outletId=${outlet}`;
        if (p === "custom" && cFrom && cTo) {
          url += `&from=${cFrom}&to=${cTo}`;
        }
        const res = await fetch(url, { credentials: "include" });
        if (!res.ok) {
          const body = await res.json().catch(() => ({}));
          throw new Error(body.error || `HTTP ${res.status}`);
        }
        setData(await res.json());
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to load");
      }
      setLoading(false);
    },
    [],
  );

  useEffect(() => {
    if (period === "custom") {
      loadData(period, outletId, customFrom, customTo);
    } else {
      loadData(period, outletId);
    }
  }, [period, outletId, customFrom, customTo, loadData]);

  // ─── Render ─────────────────────────────────────────────────────────

  return (
    <div className="p-6 pb-10 min-h-0 w-full">
      {/* Header */}
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-gray-900">Sales Dashboard</h1>
        <p className="mt-1 text-sm text-gray-500">Sales performance by time round</p>
      </div>

      {/* Filters bar */}
      <div className="rounded-xl border border-gray-200 bg-white shadow-sm p-4 mb-6">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
          <div className="flex items-center gap-2">
            <CalendarDays className="h-5 w-5 text-[#C2452D]" />
            <h2 className="text-sm font-semibold text-gray-900">Filters</h2>
            {data && (
              <span className="text-xs text-gray-400">
                {data.period.from === data.period.to
                  ? data.period.from
                  : `${data.period.from} to ${data.period.to}`}
              </span>
            )}
          </div>
          <div className="flex items-center gap-2 flex-wrap">
            {/* Outlet filter */}
            {data?.availableOutlets && data.availableOutlets.length > 1 && (
              <select
                value={outletId}
                onChange={(e) => setOutletId(e.target.value)}
                className="rounded-lg border border-gray-200 bg-white px-2.5 py-1.5 text-xs font-medium text-gray-700 focus:outline-none focus:ring-1 focus:ring-[#C2452D]"
              >
                <option value="all">All Outlets</option>
                {data.availableOutlets.map((o) => (
                  <option key={o.id} value={o.id}>
                    {o.name}
                  </option>
                ))}
              </select>
            )}
            {/* Period toggle */}
            <div className="flex rounded-lg border border-gray-200 overflow-hidden flex-wrap">
              {PERIOD_OPTIONS.map((p) => (
                <button
                  key={p.key}
                  onClick={() => setPeriod(p.key)}
                  className={cn(
                    "px-2.5 py-1.5 text-xs font-medium transition-colors whitespace-nowrap",
                    period === p.key
                      ? "bg-[#C2452D] text-white"
                      : "bg-white text-gray-600 hover:bg-gray-50",
                  )}
                >
                  {p.label}
                </button>
              ))}
            </div>
          </div>
        </div>

        {/* Custom date pickers */}
        {period === "custom" && (
          <div className="flex items-center gap-2 mt-3">
            <input
              type="date"
              value={customFrom}
              onChange={(e) => setCustomFrom(e.target.value)}
              className="rounded-lg border border-gray-200 px-3 py-1.5 text-xs text-gray-700 focus:outline-none focus:ring-1 focus:ring-[#C2452D]"
            />
            <span className="text-xs text-gray-400">to</span>
            <input
              type="date"
              value={customTo}
              onChange={(e) => setCustomTo(e.target.value)}
              className="rounded-lg border border-gray-200 px-3 py-1.5 text-xs text-gray-700 focus:outline-none focus:ring-1 focus:ring-[#C2452D]"
            />
          </div>
        )}
      </div>

      {/* Loading / Error */}
      {loading && (
        <div className="flex items-center justify-center h-64">
          <div className="flex flex-col items-center gap-3">
            <Loader2 className="h-8 w-8 animate-spin text-[#C2452D]" />
            <p className="text-sm text-gray-500">Loading sales data...</p>
          </div>
        </div>
      )}

      {error && !loading && (
        <div className="rounded-xl border border-red-200 bg-red-50 p-6 text-center">
          <p className="text-sm text-red-600">{error}</p>
        </div>
      )}

      {data && !loading && (
        <div className="flex flex-col gap-6">
          {/* ─── Summary Cards ─── */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <div className="rounded-xl border border-gray-200 bg-white p-5 shadow-sm">
              <div className="flex items-start gap-3 mb-3">
                <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-green-100">
                  <DollarSign className="h-5 w-5 text-green-600" />
                </div>
                <p className="text-xs font-medium text-gray-500 uppercase tracking-wide">
                  Total Revenue
                </p>
              </div>
              <p className="font-sans text-2xl font-bold text-gray-900">
                RM {data.summary.revenue.toLocaleString("en-MY", { minimumFractionDigits: 2 })}
              </p>
              <p className="text-xs text-gray-500 mt-1">{getPeriodLabel(period)}</p>
            </div>

            <div className="rounded-xl border border-gray-200 bg-white p-5 shadow-sm">
              <div className="flex items-start gap-3 mb-3">
                <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-blue-100">
                  <ShoppingCart className="h-5 w-5 text-blue-600" />
                </div>
                <p className="text-xs font-medium text-gray-500 uppercase tracking-wide">
                  Total Orders
                </p>
              </div>
              <p className="font-sans text-2xl font-bold text-gray-900">
                {data.summary.orders.toLocaleString()}
              </p>
              <p className="text-xs text-gray-500 mt-1">{getPeriodLabel(period)}</p>
            </div>

            <div className="rounded-xl border border-gray-200 bg-white p-5 shadow-sm">
              <div className="flex items-start gap-3 mb-3">
                <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-orange-100">
                  <TrendingUp className="h-5 w-5 text-orange-600" />
                </div>
                <p className="text-xs font-medium text-gray-500 uppercase tracking-wide">
                  Average Order Value
                </p>
              </div>
              <p className="font-sans text-2xl font-bold text-gray-900">
                RM {data.summary.aov.toFixed(2)}
              </p>
              <p className="text-xs text-gray-500 mt-1">{getPeriodLabel(period)}</p>
            </div>
          </div>

          {/* ─── Channel Summary Cards ─── */}
          {(() => {
            const totDineIn = data.rounds.reduce((s, r) => s + r.totals.dineIn.orders, 0);
            const totTakeaway = data.rounds.reduce((s, r) => s + r.totals.takeaway.orders, 0);
            const totDelivery = data.rounds.reduce((s, r) => s + r.totals.delivery.orders, 0);
            const revDineIn = data.rounds.reduce((s, r) => s + r.totals.dineIn.revenue, 0);
            const revTakeaway = data.rounds.reduce((s, r) => s + r.totals.takeaway.revenue, 0);
            const revDelivery = data.rounds.reduce((s, r) => s + r.totals.delivery.revenue, 0);
            return (
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                <div className="rounded-xl border border-gray-200 bg-white p-4 shadow-sm">
                  <div className="flex items-center gap-2 mb-2">
                    <UtensilsCrossed className="h-4 w-4 text-blue-500" />
                    <span className="text-xs font-semibold text-gray-600 uppercase">Dine-In</span>
                  </div>
                  <p className="text-lg font-bold text-gray-900">RM {revDineIn.toLocaleString("en-MY", { minimumFractionDigits: 0 })}</p>
                  <p className="text-xs text-gray-400">{totDineIn} orders</p>
                </div>
                <div className="rounded-xl border border-gray-200 bg-white p-4 shadow-sm">
                  <div className="flex items-center gap-2 mb-2">
                    <ShoppingBag className="h-4 w-4 text-amber-500" />
                    <span className="text-xs font-semibold text-gray-600 uppercase">Takeaway</span>
                  </div>
                  <p className="text-lg font-bold text-gray-900">RM {revTakeaway.toLocaleString("en-MY", { minimumFractionDigits: 0 })}</p>
                  <p className="text-xs text-gray-400">{totTakeaway} orders</p>
                </div>
                <div className="rounded-xl border border-gray-200 bg-white p-4 shadow-sm">
                  <div className="flex items-center gap-2 mb-2">
                    <Truck className="h-4 w-4 text-purple-500" />
                    <span className="text-xs font-semibold text-gray-600 uppercase">Delivery</span>
                  </div>
                  <p className="text-lg font-bold text-gray-900">RM {revDelivery.toLocaleString("en-MY", { minimumFractionDigits: 0 })}</p>
                  <p className="text-xs text-gray-400">{totDelivery} orders</p>
                </div>
              </div>
            );
          })()}

          {/* ─── Metric Toggle ─── */}
          <div className="flex items-center gap-2">
            <span className="text-xs font-medium text-gray-500 mr-1">View:</span>
            {(
              [
                { key: "revenue", label: "Revenue (RM)", icon: DollarSign },
                { key: "orders", label: "Orders", icon: ShoppingCart },
                { key: "aov", label: "AOV (RM)", icon: TrendingUp },
              ] as const
            ).map((m) => (
              <button
                key={m.key}
                onClick={() => setActiveMetric(m.key)}
                className={cn(
                  "flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-medium transition-colors",
                  activeMetric === m.key
                    ? "bg-[#C2452D] text-white"
                    : "bg-white text-gray-600 border border-gray-200 hover:bg-gray-50",
                )}
              >
                <m.icon className="h-3.5 w-3.5" />
                {m.label}
              </button>
            ))}
          </div>

          {/* ─── Rounds Grid Table ─── */}
          <div className="rounded-xl border border-gray-200 bg-white shadow-sm overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="bg-gray-50 border-b border-gray-200">
                    <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider text-gray-500 sticky left-0 bg-gray-50 z-10 min-w-[140px]">
                      Round
                    </th>
                    {data.dates.map((d) => (
                      <th
                        key={d}
                        className="px-3 py-3 text-center text-xs font-medium text-gray-500 min-w-[90px]"
                      >
                        {data.dates.length === 1 ? formatDate(d) : formatDateShort(d)}
                      </th>
                    ))}
                    <th className="px-3 py-3 text-center text-xs font-semibold uppercase tracking-wider text-gray-700 min-w-[80px] bg-gray-100">
                      Total
                    </th>
                    <th className="px-3 py-3 text-center text-xs font-semibold uppercase tracking-wider text-gray-700 min-w-[80px] bg-gray-100">
                      Avg
                    </th>
                    <th className="px-2 py-3 text-center text-xs font-semibold uppercase tracking-wider min-w-[60px] bg-blue-50 text-blue-700" title="Dine-In">
                      <UtensilsCrossed className="h-3.5 w-3.5 mx-auto" />
                    </th>
                    <th className="px-2 py-3 text-center text-xs font-semibold uppercase tracking-wider min-w-[60px] bg-amber-50 text-amber-700" title="Takeaway">
                      <ShoppingBag className="h-3.5 w-3.5 mx-auto" />
                    </th>
                    <th className="px-2 py-3 text-center text-xs font-semibold uppercase tracking-wider min-w-[60px] bg-purple-50 text-purple-700" title="Delivery">
                      <Truck className="h-3.5 w-3.5 mx-auto" />
                    </th>
                    <th className="px-3 py-3 text-center text-xs font-semibold uppercase tracking-wider text-[#C2452D] min-w-[80px] bg-orange-50">
                      Target
                    </th>
                    <th className="px-3 py-3 text-center text-xs font-semibold uppercase tracking-wider min-w-[70px] bg-gray-100 text-gray-600">
                      %
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {data.rounds.map((round) => {
                    const getValue = (cell: DailyCell) => {
                      if (activeMetric === "revenue") return cell.revenue;
                      if (activeMetric === "orders") return cell.orders;
                      return cell.aov;
                    };

                    const getTotal = () => {
                      if (activeMetric === "revenue") return round.totals.revenue;
                      if (activeMetric === "orders") return round.totals.orders;
                      return round.totals.aov;
                    };

                    const getAvg = () => {
                      if (activeMetric === "revenue") return round.averages.revenue;
                      if (activeMetric === "orders") return round.averages.orders;
                      return round.averages.aov;
                    };

                    const getTarget = () => {
                      if (activeMetric === "revenue") return round.target.revenue;
                      if (activeMetric === "orders") return "-";
                      return "-";
                    };

                    const formatValue = (v: number) => {
                      if (activeMetric === "revenue") return v > 0 ? formatRM(v) : "-";
                      if (activeMetric === "orders") return v > 0 ? v.toString() : "-";
                      return v > 0 ? v.toFixed(1) : "-";
                    };

                    const totalVal = getTotal();
                    const targetVal = getTarget();
                    const pct = round.totals.pctOfTarget;
                    const tc = targetColor(pct);

                    // Channel values for totals row
                    const chDineIn = activeMetric === "revenue" ? round.totals.dineIn.revenue : round.totals.dineIn.orders;
                    const chTakeaway = activeMetric === "revenue" ? round.totals.takeaway.revenue : round.totals.takeaway.orders;
                    const chDelivery = activeMetric === "revenue" ? round.totals.delivery.revenue : round.totals.delivery.orders;

                    return (
                      <tr key={round.key} className="hover:bg-gray-50/50 transition-colors">
                        <td className="px-4 py-3 sticky left-0 bg-white z-10">
                          <div>
                            <p className="font-medium text-gray-900">{round.label}</p>
                            <p className="text-[11px] text-gray-400">{round.timeRange}</p>
                          </div>
                        </td>
                        {round.daily.map((cell) => {
                          const val = getValue(cell);
                          return (
                            <td key={cell.date} className="px-3 py-3 text-center">
                              <span
                                className={cn(
                                  "font-sans text-sm",
                                  activeMetric === "revenue"
                                    ? cellColor(val, round.target.revenue)
                                    : val === 0
                                      ? "text-gray-300"
                                      : "text-gray-700",
                                )}
                              >
                                {formatValue(val)}
                              </span>
                            </td>
                          );
                        })}
                        <td className="px-3 py-3 text-center bg-gray-50">
                          <span className="font-sans font-bold text-gray-900">
                            {typeof totalVal === "number" ? formatValue(totalVal) : totalVal}
                          </span>
                        </td>
                        <td className="px-3 py-3 text-center bg-gray-50">
                          <span className="font-sans font-medium text-gray-600">
                            {typeof getAvg() === "number"
                              ? formatValue(getAvg() as number)
                              : getAvg()}
                          </span>
                        </td>
                        {/* Channel columns */}
                        <td className="px-2 py-3 text-center bg-blue-50/30">
                          <span className="font-sans text-xs text-gray-700">
                            {activeMetric === "aov" ? "-" : chDineIn > 0 ? (activeMetric === "revenue" ? formatRM(chDineIn) : chDineIn) : "-"}
                          </span>
                        </td>
                        <td className="px-2 py-3 text-center bg-amber-50/30">
                          <span className="font-sans text-xs text-gray-700">
                            {activeMetric === "aov" ? "-" : chTakeaway > 0 ? (activeMetric === "revenue" ? formatRM(chTakeaway) : chTakeaway) : "-"}
                          </span>
                        </td>
                        <td className="px-2 py-3 text-center bg-purple-50/30">
                          <span className="font-sans text-xs text-gray-700">
                            {activeMetric === "aov" ? "-" : chDelivery > 0 ? (activeMetric === "revenue" ? formatRM(chDelivery) : chDelivery) : "-"}
                          </span>
                        </td>
                        {/* Target */}
                        <td
                          className={cn(
                            "px-3 py-3 text-center",
                            pct >= 100 ? "bg-green-50" : "bg-orange-50",
                          )}
                        >
                          <span
                            className={cn(
                              "font-sans font-semibold",
                              pct >= 100 ? "text-green-600" : "text-[#C2452D]",
                            )}
                          >
                            {typeof targetVal === "number" ? formatRM(targetVal) : targetVal}
                          </span>
                        </td>
                        {/* % of target */}
                        <td className={cn("px-3 py-3 text-center", tc.bg)}>
                          <span className={cn("font-sans text-xs font-bold", tc.text)}>
                            {pct > 0 ? `${pct}%` : "-"}
                          </span>
                        </td>
                      </tr>
                    );
                  })}

                  {/* Grand total row */}
                  <tr className="bg-gray-100 font-semibold border-t-2 border-gray-300">
                    <td className="px-4 py-3 sticky left-0 bg-gray-100 z-10 text-gray-900">
                      Total
                    </td>
                    {data.dates.map((d) => {
                      const dayTotal = data.rounds.reduce((sum, r) => {
                        const cell = r.daily.find((c) => c.date === d);
                        if (!cell) return sum;
                        if (activeMetric === "revenue") return sum + cell.revenue;
                        if (activeMetric === "orders") return sum + cell.orders;
                        return sum; // AOV doesn't sum
                      }, 0);

                      let displayVal: string;
                      if (activeMetric === "aov") {
                        const dayRev = data.rounds.reduce(
                          (s, r) => s + (r.daily.find((c) => c.date === d)?.revenue || 0),
                          0,
                        );
                        const dayOrd = data.rounds.reduce(
                          (s, r) => s + (r.daily.find((c) => c.date === d)?.orders || 0),
                          0,
                        );
                        displayVal = dayOrd > 0 ? (dayRev / dayOrd).toFixed(1) : "-";
                      } else if (activeMetric === "revenue") {
                        displayVal = dayTotal > 0 ? formatRM(dayTotal) : "-";
                      } else {
                        displayVal = dayTotal > 0 ? dayTotal.toString() : "-";
                      }

                      return (
                        <td key={d} className="px-3 py-3 text-center text-gray-900">
                          {displayVal}
                        </td>
                      );
                    })}
                    <td className="px-3 py-3 text-center bg-gray-200 text-gray-900">
                      {activeMetric === "revenue"
                        ? `RM ${data.summary.revenue.toLocaleString("en-MY", { minimumFractionDigits: 0 })}`
                        : activeMetric === "orders"
                          ? data.summary.orders.toLocaleString()
                          : data.summary.aov.toFixed(1)}
                    </td>
                    <td className="px-3 py-3 text-center bg-gray-200 text-gray-600">-</td>
                    {/* Grand total channels */}
                    {(() => {
                      const gtDineIn = data.rounds.reduce((s, r) => s + (activeMetric === "revenue" ? r.totals.dineIn.revenue : r.totals.dineIn.orders), 0);
                      const gtTakeaway = data.rounds.reduce((s, r) => s + (activeMetric === "revenue" ? r.totals.takeaway.revenue : r.totals.takeaway.orders), 0);
                      const gtDelivery = data.rounds.reduce((s, r) => s + (activeMetric === "revenue" ? r.totals.delivery.revenue : r.totals.delivery.orders), 0);
                      return (
                        <>
                          <td className="px-2 py-3 text-center bg-blue-100/50 text-gray-900 text-xs font-bold">
                            {activeMetric === "aov" ? "-" : gtDineIn > 0 ? (activeMetric === "revenue" ? formatRM(gtDineIn) : gtDineIn) : "-"}
                          </td>
                          <td className="px-2 py-3 text-center bg-amber-100/50 text-gray-900 text-xs font-bold">
                            {activeMetric === "aov" ? "-" : gtTakeaway > 0 ? (activeMetric === "revenue" ? formatRM(gtTakeaway) : gtTakeaway) : "-"}
                          </td>
                          <td className="px-2 py-3 text-center bg-purple-100/50 text-gray-900 text-xs font-bold">
                            {activeMetric === "aov" ? "-" : gtDelivery > 0 ? (activeMetric === "revenue" ? formatRM(gtDelivery) : gtDelivery) : "-"}
                          </td>
                        </>
                      );
                    })()}
                    <td className="px-3 py-3 text-center bg-orange-100">
                      {activeMetric === "revenue"
                        ? `RM ${(data.rounds.reduce((s, r) => s + r.target.revenue, 0)).toLocaleString()}`
                        : "-"}
                    </td>
                    <td className="px-3 py-3 text-center bg-gray-200">
                      {(() => {
                        const avgPct = data.rounds.filter((r) => r.totals.pctOfTarget > 0).length > 0
                          ? Math.round(data.rounds.reduce((s, r) => s + r.totals.pctOfTarget, 0) / data.rounds.filter((r) => r.totals.pctOfTarget > 0).length)
                          : 0;
                        const c = targetColor(avgPct);
                        return <span className={cn("text-xs font-bold", c.text)}>{avgPct > 0 ? `${avgPct}%` : "-"}</span>;
                      })()}
                    </td>
                  </tr>
                </tbody>
              </table>
            </div>
          </div>

          {/* ─── Round Performance Bars ─── */}
          <div className="rounded-xl border border-gray-200 bg-white shadow-sm p-5">
            <div className="flex items-center gap-2 mb-4">
              <Store className="h-5 w-5 text-[#C2452D]" />
              <h3 className="text-sm font-semibold text-gray-900">Revenue by Round</h3>
            </div>
            <div className="space-y-3">
              {data.rounds.map((round) => {
                const maxRevenue = Math.max(...data.rounds.map((r) => r.totals.revenue), 1);
                const pct = (round.totals.revenue / maxRevenue) * 100;
                const targetPct = (round.target.revenue * data.dates.length) / maxRevenue * 100;
                const tc = targetColor(round.totals.pctOfTarget);

                return (
                  <div key={round.key} className="flex items-center gap-3">
                    <div className="w-24 shrink-0">
                      <p className="text-sm font-medium text-gray-700">{round.label}</p>
                      <p className="text-[11px] text-gray-400">{round.timeRange}</p>
                    </div>
                    <div className="flex-1 relative">
                      <div className="h-7 bg-gray-100 rounded-md overflow-hidden">
                        <div
                          className="h-full rounded-md transition-all duration-500"
                          style={{
                            width: `${Math.min(pct, 100)}%`,
                            backgroundColor:
                              round.totals.pctOfTarget >= 100
                                ? "#16a34a"
                                : round.totals.pctOfTarget >= 80
                                  ? "#ca8a04"
                                  : round.totals.pctOfTarget >= 50
                                    ? "#ea580c"
                                    : "#dc2626",
                            minWidth: round.totals.revenue > 0 ? "8px" : "0px",
                          }}
                        />
                      </div>
                      {/* Target marker */}
                      {targetPct > 0 && targetPct <= 100 && (
                        <div
                          className="absolute top-0 h-7 w-px bg-gray-800 opacity-30"
                          style={{ left: `${targetPct}%` }}
                          title={`Target: RM ${round.target.revenue * data.dates.length}`}
                        />
                      )}
                    </div>
                    <div className="w-32 shrink-0 text-right">
                      <p className="text-sm font-bold font-sans text-gray-900">
                        RM {round.totals.revenue.toLocaleString("en-MY", { minimumFractionDigits: 0 })}
                      </p>
                      <div className="flex items-center justify-end gap-1.5">
                        <span className="text-[11px] text-gray-400">
                          {round.totals.orders} orders
                        </span>
                        <span className={cn("text-[10px] font-bold px-1 py-0.5 rounded", tc.bg, tc.text)}>
                          {round.totals.pctOfTarget}%
                        </span>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          {/* ─── Outside-round info ─── */}
          {data.outsideRounds.orders > 0 && (
            <div className="rounded-lg border border-gray-100 bg-gray-50 px-4 py-3 text-xs text-gray-500">
              <span className="font-medium text-gray-700">
                {data.outsideRounds.orders} order{data.outsideRounds.orders > 1 ? "s" : ""}
              </span>{" "}
              outside tracked rounds (before 8AM or after 11PM) totalling{" "}
              <span className="font-medium text-gray-700">
                RM {data.outsideRounds.revenue.toLocaleString("en-MY", { minimumFractionDigits: 2 })}
              </span>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
