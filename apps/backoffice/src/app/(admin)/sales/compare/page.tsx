"use client";

import { useState, useCallback, useEffect } from "react";
import {
  ArrowLeftRight,
  Plus,
  X,
  Loader2,
  Calendar,
  DollarSign,
  ShoppingCart,
  TrendingUp,
  ChevronDown,
  ChevronUp,
} from "lucide-react";

// ─── Types ───────────────────────────────────────────────────────────────

type ComparisonSlot = {
  id: string;
  from: string;
  to: string;
};

type PeriodRound = {
  key: string;
  label: string;
  revenue: number;
  orders: number;
  aov: number;
  channels: {
    dineIn: { revenue: number; orders: number };
    takeaway: { revenue: number; orders: number };
    delivery: { revenue: number; orders: number };
  };
};

type PeriodResult = {
  from: string;
  to: string;
  label: string;
  summary: { revenue: number; orders: number; aov: number };
  rounds: PeriodRound[];
  channels: {
    dineIn: { revenue: number; orders: number };
    takeaway: { revenue: number; orders: number };
    delivery: { revenue: number; orders: number };
  };
  dailyTotals: { date: string; revenue: number; orders: number }[];
};

type CompareResponse = {
  periods: PeriodResult[];
  availableOutlets: { id: string; name: string }[];
  warnings?: string[];
};

// ─── Constants ───────────────────────────────────────────────────────────

const PERIOD_COLORS = ["#C2452D", "#3B82F6", "#10B981", "#F59E0B"];
const PERIOD_BG = ["bg-red-50", "bg-blue-50", "bg-emerald-50", "bg-amber-50"];
const PERIOD_BORDER = ["border-red-200", "border-blue-200", "border-emerald-200", "border-amber-200"];
const PERIOD_TEXT = ["text-red-700", "text-blue-700", "text-emerald-700", "text-amber-700"];

function getMYTToday(): string {
  const now = new Date();
  const myt = new Date(now.getTime() + 8 * 60 * 60 * 1000);
  return myt.toISOString().split("T")[0];
}

function addDays(dateStr: string, days: number): string {
  const d = new Date(dateStr + "T12:00:00+08:00");
  d.setDate(d.getDate() + days);
  return d.toISOString().split("T")[0];
}

function getMonday(dateStr: string): string {
  const d = new Date(dateStr + "T12:00:00+08:00");
  const day = d.getDay();
  const diff = day === 0 ? -6 : 1 - day;
  d.setDate(d.getDate() + diff);
  return d.toISOString().split("T")[0];
}

function getMonthStart(dateStr: string): string {
  const d = new Date(dateStr + "T12:00:00+08:00");
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-01`;
}

function getMonthEnd(dateStr: string): string {
  const d = new Date(dateStr + "T12:00:00+08:00");
  const last = new Date(d.getFullYear(), d.getMonth() + 1, 0);
  return `${last.getFullYear()}-${String(last.getMonth() + 1).padStart(2, "0")}-${String(last.getDate()).padStart(2, "0")}`;
}

function uid(): string {
  return Math.random().toString(36).slice(2, 8);
}

function fmtRM(v: number): string {
  return `RM ${v.toLocaleString("en-MY", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function pctChange(current: number, previous: number): { label: string; color: string } {
  if (previous === 0) return { label: current > 0 ? "New" : "—", color: "text-gray-400" };
  const pct = ((current - previous) / previous) * 100;
  if (pct > 0) return { label: `+${pct.toFixed(1)}%`, color: "text-green-600" };
  if (pct < 0) return { label: `${pct.toFixed(1)}%`, color: "text-red-500" };
  return { label: "0%", color: "text-gray-400" };
}

// ─── Presets ─────────────────────────────────────────────────────────────

function getPresets(): { label: string; slots: ComparisonSlot[] }[] {
  const today = getMYTToday();
  const thisMonday = getMonday(today);
  const lastMonday = addDays(thisMonday, -7);
  const thisMonthStart = getMonthStart(today);
  const lastMonthEnd = addDays(thisMonthStart, -1);
  const lastMonthStart = getMonthStart(lastMonthEnd);

  return [
    {
      label: "This Week vs Last Week",
      slots: [
        { id: uid(), from: thisMonday, to: addDays(thisMonday, 6) },
        { id: uid(), from: lastMonday, to: addDays(lastMonday, 6) },
      ],
    },
    {
      label: "This Month vs Last Month",
      slots: [
        { id: uid(), from: thisMonthStart, to: getMonthEnd(today) },
        { id: uid(), from: lastMonthStart, to: lastMonthEnd },
      ],
    },
    {
      label: "Today vs Same Day Last Week",
      slots: [
        { id: uid(), from: today, to: today },
        { id: uid(), from: addDays(today, -7), to: addDays(today, -7) },
      ],
    },
    {
      label: "Last 4 Same Weekdays",
      slots: [0, -7, -14, -21].map((offset) => ({
        id: uid(),
        from: addDays(today, offset),
        to: addDays(today, offset),
      })),
    },
  ];
}

// ─── Component ───────────────────────────────────────────────────────────

export default function SalesComparePage() {
  const [slots, setSlots] = useState<ComparisonSlot[]>([]);
  const [outletId, setOutletId] = useState("all");
  const [data, setData] = useState<CompareResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [outlets, setOutlets] = useState<{ id: string; name: string }[]>([]);
  const [showPicker, setShowPicker] = useState(false);
  const [pickerFrom, setPickerFrom] = useState(getMYTToday());
  const [pickerTo, setPickerTo] = useState(getMYTToday());
  const [metric, setMetric] = useState<"revenue" | "orders" | "aov">("revenue");
  const [showRounds, setShowRounds] = useState(true);
  const [showChannels, setShowChannels] = useState(true);

  const fetchData = useCallback(
    async (currentSlots: ComparisonSlot[], outlet: string) => {
      if (currentSlots.length === 0) {
        setData(null);
        return;
      }
      setLoading(true);
      setError(null);
      try {
        const periodsStr = currentSlots.map((s) => `${s.from}:${s.to}`).join(",");
        let url = `/api/sales/compare?periods=${periodsStr}`;
        if (outlet !== "all") url += `&outletId=${outlet}`;
        const res = await fetch(url, { credentials: "include" });
        if (!res.ok) {
          const body = await res.json().catch(() => ({}));
          throw new Error(body.error || `HTTP ${res.status}`);
        }
        const json: CompareResponse = await res.json();
        setData(json);
        if (json.availableOutlets) setOutlets(json.availableOutlets);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to load");
      } finally {
        setLoading(false);
      }
    },
    [],
  );

  // Fetch outlets on mount
  useEffect(() => {
    fetch("/api/sales/compare?periods=" + getMYTToday() + ":" + getMYTToday(), { credentials: "include" })
      .then((r) => r.json())
      .then((d) => {
        if (d.availableOutlets) setOutlets(d.availableOutlets);
      })
      .catch(() => {});
  }, []);

  const addSlot = (from: string, to: string) => {
    if (slots.length >= 4) return;
    const next = [...slots, { id: uid(), from, to }];
    setSlots(next);
    setShowPicker(false);
    fetchData(next, outletId);
  };

  const removeSlot = (id: string) => {
    const next = slots.filter((s) => s.id !== id);
    setSlots(next);
    fetchData(next, outletId);
  };

  const applyPreset = (preset: { slots: ComparisonSlot[] }) => {
    setSlots(preset.slots);
    fetchData(preset.slots, outletId);
  };

  const changeOutlet = (v: string) => {
    setOutletId(v);
    fetchData(slots, v);
  };

  const presets = getPresets();

  return (
    <div className="min-h-screen bg-[#f5f3f0] p-4 sm:p-6 space-y-5">
      {/* Header */}
      <div className="flex items-center gap-3">
        <div className="flex items-center justify-center w-10 h-10 rounded-xl bg-[#C2452D]/10">
          <ArrowLeftRight className="w-5 h-5 text-[#C2452D]" />
        </div>
        <div>
          <h1 className="text-xl font-bold text-gray-900">Sales Compare</h1>
          <p className="text-sm text-gray-500">Compare sales across different periods</p>
        </div>
      </div>

      {/* Quick Presets */}
      <div className="flex flex-wrap gap-2">
        {presets.map((p) => (
          <button
            key={p.label}
            onClick={() => applyPreset(p)}
            className="px-3 py-1.5 text-xs font-medium rounded-lg border border-gray-200 bg-white text-gray-700 hover:border-[#C2452D] hover:text-[#C2452D] transition-colors"
          >
            {p.label}
          </button>
        ))}
      </div>

      {/* Slot Bar + Controls */}
      <div className="flex flex-wrap items-start gap-3">
        {/* Period Slots */}
        {slots.map((slot, i) => {
          const periodResult = data?.periods[i];
          const label = periodResult?.label || formatSlotLabel(slot.from, slot.to);
          return (
            <div
              key={slot.id}
              className={`flex items-center gap-2 px-3 py-2 rounded-lg border ${PERIOD_BORDER[i]} ${PERIOD_BG[i]}`}
            >
              <div
                className="w-3 h-3 rounded-full flex-shrink-0"
                style={{ backgroundColor: PERIOD_COLORS[i] }}
              />
              <span className={`text-sm font-medium ${PERIOD_TEXT[i]}`}>{label}</span>
              <button
                onClick={() => removeSlot(slot.id)}
                className="p-0.5 rounded hover:bg-black/5"
              >
                <X className="w-3.5 h-3.5 text-gray-400" />
              </button>
            </div>
          );
        })}

        {/* Add Period */}
        {slots.length < 4 && (
          <div className="relative">
            <button
              onClick={() => setShowPicker(!showPicker)}
              className="flex items-center gap-1.5 px-3 py-2 rounded-lg border border-dashed border-gray-300 text-sm text-gray-500 hover:border-[#C2452D] hover:text-[#C2452D] transition-colors"
            >
              <Plus className="w-4 h-4" />
              Add Period
            </button>

            {showPicker && (
              <div className="absolute top-full left-0 mt-2 z-50 bg-white rounded-xl shadow-lg border border-gray-200 p-4 w-72">
                <p className="text-xs font-medium text-gray-500 mb-2">Quick Select</p>
                <div className="grid grid-cols-2 gap-1.5 mb-3">
                  {[
                    { label: "Today", from: getMYTToday(), to: getMYTToday() },
                    { label: "Yesterday", from: addDays(getMYTToday(), -1), to: addDays(getMYTToday(), -1) },
                    { label: "This Week", from: getMonday(getMYTToday()), to: addDays(getMonday(getMYTToday()), 6) },
                    { label: "Last Week", from: addDays(getMonday(getMYTToday()), -7), to: addDays(getMonday(getMYTToday()), -1) },
                    { label: "This Month", from: getMonthStart(getMYTToday()), to: getMonthEnd(getMYTToday()) },
                    { label: "Last Month", from: getMonthStart(addDays(getMonthStart(getMYTToday()), -1)), to: addDays(getMonthStart(getMYTToday()), -1) },
                  ].map((q) => (
                    <button
                      key={q.label}
                      onClick={() => addSlot(q.from, q.to)}
                      className="px-2 py-1.5 text-xs rounded-md bg-gray-50 hover:bg-[#C2452D]/10 hover:text-[#C2452D] text-gray-700 transition-colors text-left"
                    >
                      {q.label}
                    </button>
                  ))}
                </div>
                <p className="text-xs font-medium text-gray-500 mb-2">Custom Range</p>
                <div className="flex gap-2 items-center mb-2">
                  <input
                    type="date"
                    value={pickerFrom}
                    onChange={(e) => setPickerFrom(e.target.value)}
                    className="flex-1 text-xs border border-gray-200 rounded-md px-2 py-1.5"
                  />
                  <span className="text-gray-400 text-xs">to</span>
                  <input
                    type="date"
                    value={pickerTo}
                    onChange={(e) => setPickerTo(e.target.value)}
                    className="flex-1 text-xs border border-gray-200 rounded-md px-2 py-1.5"
                  />
                </div>
                <button
                  onClick={() => addSlot(pickerFrom, pickerTo)}
                  className="w-full py-1.5 text-xs font-medium rounded-md bg-[#C2452D] text-white hover:bg-[#A33822] transition-colors"
                >
                  Add
                </button>
              </div>
            )}
          </div>
        )}

        {/* Outlet Filter */}
        <select
          value={outletId}
          onChange={(e) => changeOutlet(e.target.value)}
          className="ml-auto px-3 py-2 text-sm rounded-lg border border-gray-200 bg-white text-gray-700"
        >
          <option value="all">All Outlets</option>
          {outlets.map((o) => (
            <option key={o.id} value={o.id}>
              {o.name}
            </option>
          ))}
        </select>
      </div>

      {/* Loading */}
      {loading && (
        <div className="flex items-center justify-center py-20">
          <Loader2 className="w-6 h-6 animate-spin text-[#C2452D]" />
          <span className="ml-2 text-sm text-gray-500">Fetching sales data...</span>
        </div>
      )}

      {/* Error */}
      {error && (
        <div className="bg-red-50 border border-red-200 rounded-xl p-4 text-sm text-red-700">
          {error}
        </div>
      )}

      {/* Empty State */}
      {!loading && !error && slots.length === 0 && (
        <div className="bg-white rounded-xl border border-gray-200 p-12 text-center">
          <Calendar className="w-10 h-10 mx-auto text-gray-300 mb-3" />
          <p className="text-gray-500 text-sm">Select a preset above or add periods to compare</p>
        </div>
      )}

      {/* Warnings */}
      {data?.warnings && data.warnings.length > 0 && (
        <div className="bg-amber-50 border border-amber-200 rounded-xl p-3 text-xs text-amber-700">
          {data.warnings.map((w, i) => (
            <p key={i}>{w}</p>
          ))}
        </div>
      )}

      {/* Results */}
      {data && data.periods.length > 0 && !loading && (
        <>
          {/* Metric Toggle */}
          <div className="flex gap-1 bg-white rounded-lg border border-gray-200 p-1 w-fit">
            {([
              { key: "revenue" as const, label: "Revenue", icon: DollarSign },
              { key: "orders" as const, label: "Orders", icon: ShoppingCart },
              { key: "aov" as const, label: "AOV", icon: TrendingUp },
            ]).map((m) => (
              <button
                key={m.key}
                onClick={() => setMetric(m.key)}
                className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium transition-colors ${
                  metric === m.key
                    ? "bg-[#C2452D] text-white"
                    : "text-gray-500 hover:text-gray-700"
                }`}
              >
                <m.icon className="w-3.5 h-3.5" />
                {m.label}
              </button>
            ))}
          </div>

          {/* Summary Cards */}
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
            {data.periods.map((p, i) => {
              const base = data.periods[0];
              const isBase = i === 0;
              const val = metric === "revenue" ? p.summary.revenue : metric === "orders" ? p.summary.orders : p.summary.aov;
              const baseVal = metric === "revenue" ? base.summary.revenue : metric === "orders" ? base.summary.orders : base.summary.aov;
              const change = !isBase ? pctChange(val, baseVal) : null;
              return (
                <div
                  key={i}
                  className={`bg-white rounded-xl border p-4 ${PERIOD_BORDER[i]}`}
                >
                  <div className="flex items-center gap-2 mb-2">
                    <div
                      className="w-2.5 h-2.5 rounded-full"
                      style={{ backgroundColor: PERIOD_COLORS[i] }}
                    />
                    <span className="text-xs font-medium text-gray-500">{p.label}</span>
                    {isBase && <span className="text-[10px] bg-gray-100 text-gray-500 px-1.5 py-0.5 rounded">Base</span>}
                  </div>
                  <div className="text-2xl font-bold text-gray-900">
                    {metric === "revenue" || metric === "aov" ? fmtRM(val) : val.toLocaleString()}
                  </div>
                  <div className="flex items-center gap-3 mt-1 text-xs text-gray-500">
                    <span>{p.summary.orders} orders</span>
                    {change && (
                      <span className={`font-medium ${change.color}`}>{change.label}</span>
                    )}
                  </div>
                </div>
              );
            })}
          </div>

          {/* By Time Round */}
          <div className="bg-white rounded-xl border border-gray-200 p-4">
            <button
              onClick={() => setShowRounds(!showRounds)}
              className="flex items-center justify-between w-full mb-3"
            >
              <h2 className="text-sm font-semibold text-gray-900">
                {metric === "revenue" ? "Revenue" : metric === "orders" ? "Orders" : "AOV"} by Time Round
              </h2>
              {showRounds ? <ChevronUp className="w-4 h-4 text-gray-400" /> : <ChevronDown className="w-4 h-4 text-gray-400" />}
            </button>
            {showRounds && (
              <>
                <div className="overflow-x-auto">
                  <table className="w-full text-xs">
                    <thead>
                      <tr className="border-b border-gray-100">
                        <th className="text-left py-2 pr-4 font-medium text-gray-500">Round</th>
                        {data.periods.map((p, i) => (
                          <th key={i} className="text-right py-2 px-3 font-medium" style={{ color: PERIOD_COLORS[i] }}>
                            {p.label}
                          </th>
                        ))}
                        {data.periods.length > 1 && (
                          <th className="text-right py-2 pl-3 font-medium text-gray-500">vs Base</th>
                        )}
                      </tr>
                    </thead>
                    <tbody>
                      {data.periods[0].rounds.map((r, ri) => (
                        <tr key={r.key} className="border-b border-gray-50">
                          <td className="py-2 pr-4 font-medium text-gray-700">{r.label}</td>
                          {data.periods.map((p, pi) => {
                            const pr = p.rounds[ri];
                            const val = metric === "revenue" ? pr.revenue : metric === "orders" ? pr.orders : pr.aov;
                            return (
                              <td key={pi} className="text-right py-2 px-3 text-gray-700 tabular-nums">
                                {metric === "revenue" || metric === "aov" ? fmtRM(val) : val}
                              </td>
                            );
                          })}
                          {data.periods.length > 1 && (() => {
                            const baseVal = metric === "revenue" ? data.periods[0].rounds[ri].revenue : metric === "orders" ? data.periods[0].rounds[ri].orders : data.periods[0].rounds[ri].aov;
                            const lastVal = metric === "revenue" ? data.periods[data.periods.length - 1].rounds[ri].revenue : metric === "orders" ? data.periods[data.periods.length - 1].rounds[ri].orders : data.periods[data.periods.length - 1].rounds[ri].aov;
                            const ch = pctChange(baseVal, lastVal);
                            return <td className={`text-right py-2 pl-3 font-medium ${ch.color}`}>{ch.label}</td>;
                          })()}
                        </tr>
                      ))}
                      {/* Totals row */}
                      <tr className="border-t-2 border-gray-200 font-semibold">
                        <td className="py-2 pr-4 text-gray-900">Total</td>
                        {data.periods.map((p, pi) => {
                          const val = metric === "revenue" ? p.summary.revenue : metric === "orders" ? p.summary.orders : p.summary.aov;
                          return (
                            <td key={pi} className="text-right py-2 px-3 text-gray-900 tabular-nums">
                              {metric === "revenue" || metric === "aov" ? fmtRM(val) : val}
                            </td>
                          );
                        })}
                        {data.periods.length > 1 && (() => {
                          const baseVal = metric === "revenue" ? data.periods[0].summary.revenue : metric === "orders" ? data.periods[0].summary.orders : data.periods[0].summary.aov;
                          const lastVal = metric === "revenue" ? data.periods[data.periods.length - 1].summary.revenue : metric === "orders" ? data.periods[data.periods.length - 1].summary.orders : data.periods[data.periods.length - 1].summary.aov;
                          const ch = pctChange(baseVal, lastVal);
                          return <td className={`text-right py-2 pl-3 font-semibold ${ch.color}`}>{ch.label}</td>;
                        })()}
                      </tr>
                    </tbody>
                  </table>
                </div>
              </>
            )}
          </div>

          {/* Channel Mix */}
          <div className="bg-white rounded-xl border border-gray-200 p-4">
            <button
              onClick={() => setShowChannels(!showChannels)}
              className="flex items-center justify-between w-full mb-3"
            >
              <h2 className="text-sm font-semibold text-gray-900">Channel Breakdown</h2>
              {showChannels ? <ChevronUp className="w-4 h-4 text-gray-400" /> : <ChevronDown className="w-4 h-4 text-gray-400" />}
            </button>
            {showChannels && (
              <div className="overflow-x-auto">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="border-b border-gray-100">
                      <th className="text-left py-2 pr-4 font-medium text-gray-500">Period</th>
                      <th className="text-right py-2 px-3 font-medium text-blue-600">Dine In</th>
                      <th className="text-right py-2 px-3 font-medium text-amber-600">Takeaway</th>
                      <th className="text-right py-2 px-3 font-medium text-purple-600">Delivery</th>
                      <th className="text-right py-2 pl-3 font-medium text-gray-700">Total</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.periods.map((p, i) => {
                      const di = metric === "revenue" ? p.channels.dineIn.revenue : p.channels.dineIn.orders;
                      const ta = metric === "revenue" ? p.channels.takeaway.revenue : p.channels.takeaway.orders;
                      const del = metric === "revenue" ? p.channels.delivery.revenue : p.channels.delivery.orders;
                      const total = metric === "revenue" ? p.summary.revenue : p.summary.orders;
                      const fmt = (v: number) => metric === "revenue" ? fmtRM(v) : v.toString();
                      return (
                        <tr key={i} className="border-b border-gray-50">
                          <td className="py-2 pr-4">
                            <div className="flex items-center gap-2">
                              <div className="w-2 h-2 rounded-full" style={{ backgroundColor: PERIOD_COLORS[i] }} />
                              <span className="font-medium text-gray-700">{p.label}</span>
                            </div>
                          </td>
                          <td className="text-right py-2 px-3 text-gray-700 tabular-nums">{fmt(di)}</td>
                          <td className="text-right py-2 px-3 text-gray-700 tabular-nums">{fmt(ta)}</td>
                          <td className="text-right py-2 px-3 text-gray-700 tabular-nums">{fmt(del)}</td>
                          <td className="text-right py-2 pl-3 font-medium text-gray-900 tabular-nums">{fmt(total)}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </div>

        </>
      )}
    </div>
  );
}

function formatSlotLabel(from: string, to: string): string {
  const f = new Date(from + "T12:00:00+08:00");
  const t = new Date(to + "T12:00:00+08:00");
  const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  const days = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
  if (from === to) return `${days[f.getDay()]} ${f.getDate()} ${months[f.getMonth()]}`;
  if (f.getMonth() === t.getMonth()) return `${f.getDate()}-${t.getDate()} ${months[f.getMonth()]}`;
  return `${f.getDate()} ${months[f.getMonth()]} - ${t.getDate()} ${months[t.getMonth()]}`;
}
