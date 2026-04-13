"use client";

import { useState, useCallback, useEffect, useRef } from "react";
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

const PERIOD_COLORS = [
  "#C2452D", "#3B82F6", "#10B981", "#F59E0B",
  "#8B5CF6", "#EC4899", "#06B6D4", "#84CC16",
];
const PERIOD_BG = [
  "bg-red-50", "bg-blue-50", "bg-emerald-50", "bg-amber-50",
  "bg-violet-50", "bg-pink-50", "bg-cyan-50", "bg-lime-50",
];
const PERIOD_BORDER = [
  "border-red-200", "border-blue-200", "border-emerald-200", "border-amber-200",
  "border-violet-200", "border-pink-200", "border-cyan-200", "border-lime-200",
];
const PERIOD_TEXT = [
  "text-red-700", "text-blue-700", "text-emerald-700", "text-amber-700",
  "text-violet-700", "text-pink-700", "text-cyan-700", "text-lime-700",
];

const MAX_SLOTS = 8;

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

function getSunday(mondayStr: string): string {
  return addDays(mondayStr, 6);
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

function formatSlotLabel(from: string, to: string): string {
  const f = new Date(from + "T12:00:00+08:00");
  const t = new Date(to + "T12:00:00+08:00");
  const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  const days = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
  if (from === to) return `${days[f.getDay()]} ${f.getDate()} ${months[f.getMonth()]}`;
  if (f.getMonth() === t.getMonth()) return `${f.getDate()}-${t.getDate()} ${months[f.getMonth()]}`;
  return `${f.getDate()} ${months[f.getMonth()]} - ${t.getDate()} ${months[t.getMonth()]}`;
}

/** Check if a period is partial (includes today, meaning it's not yet complete) */
function getProjection(p: PeriodResult): { projected: number; projectedOrders: number; daysElapsed: number; totalDays: number; method: string } | null {
  const today = getMYTToday();
  if (p.from === p.to) return null;
  if (today < p.from || today > p.to) return null;

  const fromD = new Date(p.from + "T12:00:00+08:00");
  const toD = new Date(p.to + "T12:00:00+08:00");
  const todayD = new Date(today + "T12:00:00+08:00");
  const totalDays = Math.round((toD.getTime() - fromD.getTime()) / (1000 * 60 * 60 * 24)) + 1;
  const daysElapsed = Math.round((todayD.getTime() - fromD.getTime()) / (1000 * 60 * 60 * 24)) + 1;

  if (daysElapsed >= totalDays) return null;
  if (daysElapsed === 0) return null;

  // Use last 7 days' average if available (more accurate), else simple average
  const daily = p.dailyTotals.filter((d) => d.date <= today && d.date >= p.from);
  const last7 = daily.slice(-7);
  const daysRemaining = totalDays - daysElapsed;
  let method = "avg";

  if (last7.length >= 3) {
    const l7Rev = last7.reduce((s, d) => s + d.revenue, 0) / last7.length;
    const l7Ord = last7.reduce((s, d) => s + d.orders, 0) / last7.length;
    method = `${last7.length}d MA`;
    return {
      projected: Math.round((p.summary.revenue + l7Rev * daysRemaining) * 100) / 100,
      projectedOrders: Math.round(p.summary.orders + l7Ord * daysRemaining),
      daysElapsed,
      totalDays,
      method,
    };
  }

  const dailyAvgRev = p.summary.revenue / daysElapsed;
  const dailyAvgOrd = p.summary.orders / daysElapsed;
  return {
    projected: Math.round(dailyAvgRev * totalDays * 100) / 100,
    projectedOrders: Math.round(dailyAvgOrd * totalDays),
    daysElapsed,
    totalDays,
    method,
  };
}

const DOW_NAMES = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

/** Compute average revenue/orders per day-of-week for a period */
function getDowAverages(p: PeriodResult): { dow: string; avgRevenue: number; avgOrders: number; count: number }[] {
  // Group daily totals by day of week (0=Mon .. 6=Sun)
  const buckets: { revenue: number; orders: number; count: number }[] = Array.from({ length: 7 }, () => ({ revenue: 0, orders: 0, count: 0 }));
  for (const d of p.dailyTotals) {
    const date = new Date(d.date + "T12:00:00+08:00");
    let dow = date.getDay() - 1; // JS: 0=Sun, we want 0=Mon
    if (dow < 0) dow = 6;
    buckets[dow].revenue += d.revenue;
    buckets[dow].orders += d.orders;
    if (d.revenue > 0 || d.orders > 0) buckets[dow].count += 1;
  }
  return buckets.map((b, i) => ({
    dow: DOW_NAMES[i],
    avgRevenue: b.count > 0 ? Math.round((b.revenue / b.count) * 100) / 100 : 0,
    avgOrders: b.count > 0 ? Math.round(b.orders / b.count) : 0,
    count: b.count,
  }));
}

/** Compute 7-day trailing moving average for daily totals */
function getDailyWithMA(p: PeriodResult): { date: string; label: string; revenue: number; orders: number; maRevenue: number | null; maOrders: number | null }[] {
  const today = getMYTToday();
  return p.dailyTotals
    .filter((d) => d.date <= today) // Don't show future dates
    .map((d, i, arr) => {
      const date = new Date(d.date + "T12:00:00+08:00");
      const days = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
      const label = `${days[date.getDay()]} ${date.getDate()}`;

      // 7-day trailing MA
      let maRevenue: number | null = null;
      let maOrders: number | null = null;
      if (i >= 6) {
        const window = arr.slice(i - 6, i + 1);
        maRevenue = Math.round((window.reduce((s, w) => s + w.revenue, 0) / 7) * 100) / 100;
        maOrders = Math.round((window.reduce((s, w) => s + w.orders, 0) / 7) * 100) / 100;
      }
      return { date: d.date, label, revenue: d.revenue, orders: d.orders, maRevenue, maOrders };
    });
}

function getDayLabel(dateStr: string): string {
  const d = new Date(dateStr + "T12:00:00+08:00");
  const days = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
  const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  return `${days[d.getDay()]} ${d.getDate()} ${months[d.getMonth()]}`;
}

function getWeekLabel(mondayStr: string): string {
  const sundayStr = getSunday(mondayStr);
  const f = new Date(mondayStr + "T12:00:00+08:00");
  const t = new Date(sundayStr + "T12:00:00+08:00");
  const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  if (f.getMonth() === t.getMonth()) return `${f.getDate()}-${t.getDate()} ${months[f.getMonth()]}`;
  return `${f.getDate()} ${months[f.getMonth()]} - ${t.getDate()} ${months[t.getMonth()]}`;
}

// ─── Presets ─────────────────────────────────────────────────────────────

function subtractMonths(dateStr: string, months: number): string {
  const d = new Date(dateStr + "T12:00:00+08:00");
  d.setMonth(d.getMonth() - months);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function getPresets(): { label: string; slots: ComparisonSlot[] }[] {
  const today = getMYTToday();
  const thisMonday = getMonday(today);
  const thisMonthStart = getMonthStart(today);
  const lastMonthEnd = addDays(thisMonthStart, -1);
  const lastMonthStart = getMonthStart(lastMonthEnd);

  return [
    {
      label: "Today vs Same Day Last Week",
      slots: [
        { id: uid(), from: today, to: today },
        { id: uid(), from: addDays(today, -7), to: addDays(today, -7) },
      ],
    },
    {
      label: "Last 7 Days (daily)",
      slots: Array.from({ length: 7 }, (_, i) => ({
        id: uid(),
        from: addDays(today, -6 + i),
        to: addDays(today, -6 + i),
      })),
    },
    {
      label: "This Week vs Last Week",
      slots: [
        { id: uid(), from: thisMonday, to: getSunday(thisMonday) },
        { id: uid(), from: addDays(thisMonday, -7), to: addDays(thisMonday, -1) },
      ],
    },
    {
      label: "Last 4 Weeks",
      slots: Array.from({ length: 4 }, (_, i) => {
        const mon = addDays(thisMonday, -7 * i);
        return { id: uid(), from: mon, to: getSunday(mon) };
      }),
    },
    {
      label: "Last 8 Weeks",
      slots: Array.from({ length: 8 }, (_, i) => {
        const mon = addDays(thisMonday, -7 * i);
        return { id: uid(), from: mon, to: getSunday(mon) };
      }),
    },
    {
      label: "This Month vs Last Month",
      slots: [
        { id: uid(), from: thisMonthStart, to: getMonthEnd(today) },
        { id: uid(), from: lastMonthStart, to: lastMonthEnd },
      ],
    },
    {
      label: "Last 3 Months",
      slots: Array.from({ length: 3 }, (_, i) => {
        const mStart = getMonthStart(subtractMonths(today, i));
        const mEnd = i === 0 ? getMonthEnd(today) : getMonthEnd(mStart);
        return { id: uid(), from: mStart, to: mEnd };
      }),
    },
    {
      label: "Last 6 Months",
      slots: Array.from({ length: 6 }, (_, i) => {
        const mStart = getMonthStart(subtractMonths(today, i));
        const mEnd = i === 0 ? getMonthEnd(today) : getMonthEnd(mStart);
        return { id: uid(), from: mStart, to: mEnd };
      }),
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
  const [pickerTab, setPickerTab] = useState<"day" | "week" | "range">("day");
  const [pickerDate, setPickerDate] = useState(getMYTToday());
  const [pickerFrom, setPickerFrom] = useState(getMYTToday());
  const [pickerTo, setPickerTo] = useState(getMYTToday());
  const [metric, setMetric] = useState<"revenue" | "orders" | "aov">("revenue");
  const [showRounds, setShowRounds] = useState(true);
  const [showChannels, setShowChannels] = useState(true);
  const [showDow, setShowDow] = useState(true);
  const [showDaily, setShowDaily] = useState(false);
  const pickerRef = useRef<HTMLDivElement>(null);

  // Close picker on outside click
  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (pickerRef.current && !pickerRef.current.contains(e.target as Node)) {
        setShowPicker(false);
      }
    }
    if (showPicker) document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, [showPicker]);

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
    if (slots.length >= MAX_SLOTS) return;
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

  const clearAll = () => {
    setSlots([]);
    setData(null);
  };

  const applyPreset = (preset: { slots: ComparisonSlot[] }) => {
    const capped = preset.slots.slice(0, MAX_SLOTS);
    setSlots(capped);
    fetchData(capped, outletId);
  };

  const changeOutlet = (v: string) => {
    setOutletId(v);
    fetchData(slots, v);
  };

  const presets = getPresets();

  // Generate week options for the week picker (last 12 weeks)
  const weekOptions = Array.from({ length: 12 }, (_, i) => {
    const mon = addDays(getMonday(getMYTToday()), -7 * i);
    return { monday: mon, label: getWeekLabel(mon) };
  });

  // Generate day options (last 14 days)
  const dayOptions = Array.from({ length: 14 }, (_, i) => {
    const d = addDays(getMYTToday(), -i);
    return { date: d, label: getDayLabel(d) };
  });

  return (
    <div className="min-h-screen bg-[#f5f3f0] p-4 sm:p-6 space-y-4">
      {/* Header */}
      <div className="flex items-center gap-3">
        <div className="flex items-center justify-center w-10 h-10 rounded-xl bg-[#C2452D]/10 shrink-0">
          <ArrowLeftRight className="w-5 h-5 text-[#C2452D]" />
        </div>
        <div className="min-w-0">
          <h1 className="text-xl font-bold text-gray-900">Sales Compare</h1>
          <p className="text-sm text-gray-500">Compare sales across different periods</p>
        </div>
      </div>

      {/* Quick Presets */}
      <div className="flex flex-wrap gap-1.5">
        {presets.map((p) => (
          <button
            key={p.label}
            onClick={() => applyPreset(p)}
            className="px-2.5 py-1.5 text-xs font-medium rounded-lg border border-gray-200 bg-white text-gray-700 hover:border-[#C2452D] hover:text-[#C2452D] transition-colors whitespace-nowrap"
          >
            {p.label}
          </button>
        ))}
      </div>

      {/* Slot Bar + Controls */}
      <div className="space-y-3">
        {/* Period Slots — scrollable row */}
        {slots.length > 0 && (
          <div className="flex items-center gap-2">
            <div className="flex-1 overflow-x-auto scrollbar-thin">
              <div className="flex items-center gap-2 pb-1">
                {slots.map((slot, i) => {
                  const ci = i % PERIOD_COLORS.length;
                  const periodResult = data?.periods[i];
                  const label = periodResult?.label || formatSlotLabel(slot.from, slot.to);
                  return (
                    <div
                      key={slot.id}
                      className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg border shrink-0 ${PERIOD_BORDER[ci]} ${PERIOD_BG[ci]}`}
                    >
                      <div
                        className="w-2.5 h-2.5 rounded-full shrink-0"
                        style={{ backgroundColor: PERIOD_COLORS[ci] }}
                      />
                      <span className={`text-xs font-medium whitespace-nowrap ${PERIOD_TEXT[ci]}`}>{label}</span>
                      <button
                        onClick={() => removeSlot(slot.id)}
                        className="p-0.5 rounded hover:bg-black/10 shrink-0"
                      >
                        <X className="w-3 h-3 text-gray-400" />
                      </button>
                    </div>
                  );
                })}
              </div>
            </div>
            <button
              onClick={clearAll}
              className="text-xs text-gray-400 hover:text-red-500 whitespace-nowrap shrink-0"
            >
              Clear all
            </button>
          </div>
        )}

        {/* Add Period + Outlet Filter */}
        <div className="flex items-center gap-2 flex-wrap">
          {slots.length < MAX_SLOTS && (
            <div className="relative" ref={pickerRef}>
              <button
                onClick={() => setShowPicker(!showPicker)}
                className="flex items-center gap-1.5 px-3 py-2 rounded-lg border border-dashed border-gray-300 text-sm text-gray-500 hover:border-[#C2452D] hover:text-[#C2452D] transition-colors"
              >
                <Plus className="w-4 h-4" />
                Add Period
              </button>

              {showPicker && (
                <div className="absolute top-full left-0 mt-2 z-50 bg-white rounded-xl shadow-xl border border-gray-200 w-80">
                  {/* Tabs */}
                  <div className="flex border-b border-gray-100">
                    {([
                      { key: "day" as const, label: "Day" },
                      { key: "week" as const, label: "Week" },
                      { key: "range" as const, label: "Custom Range" },
                    ]).map((tab) => (
                      <button
                        key={tab.key}
                        onClick={() => setPickerTab(tab.key)}
                        className={`flex-1 py-2.5 text-xs font-medium transition-colors ${
                          pickerTab === tab.key
                            ? "text-[#C2452D] border-b-2 border-[#C2452D]"
                            : "text-gray-400 hover:text-gray-600"
                        }`}
                      >
                        {tab.label}
                      </button>
                    ))}
                  </div>

                  <div className="p-3">
                    {/* Day Tab */}
                    {pickerTab === "day" && (
                      <div className="space-y-2">
                        <div className="grid grid-cols-2 gap-1.5 max-h-52 overflow-y-auto">
                          {dayOptions.map((d) => (
                            <button
                              key={d.date}
                              onClick={() => addSlot(d.date, d.date)}
                              className="px-2 py-2 text-xs rounded-md bg-gray-50 hover:bg-[#C2452D]/10 hover:text-[#C2452D] text-gray-700 transition-colors text-left truncate"
                            >
                              {d.label}
                            </button>
                          ))}
                        </div>
                        <div className="border-t border-gray-100 pt-2">
                          <p className="text-[10px] text-gray-400 mb-1">Or pick a specific date</p>
                          <div className="flex gap-2">
                            <input
                              type="date"
                              value={pickerDate}
                              onChange={(e) => setPickerDate(e.target.value)}
                              className="flex-1 text-xs border border-gray-200 rounded-md px-2 py-1.5"
                            />
                            <button
                              onClick={() => addSlot(pickerDate, pickerDate)}
                              className="px-3 py-1.5 text-xs font-medium rounded-md bg-[#C2452D] text-white hover:bg-[#A33822] transition-colors"
                            >
                              Add
                            </button>
                          </div>
                        </div>
                      </div>
                    )}

                    {/* Week Tab */}
                    {pickerTab === "week" && (
                      <div className="grid grid-cols-2 gap-1.5 max-h-64 overflow-y-auto">
                        {weekOptions.map((w) => (
                          <button
                            key={w.monday}
                            onClick={() => addSlot(w.monday, getSunday(w.monday))}
                            className="px-2 py-2 text-xs rounded-md bg-gray-50 hover:bg-[#C2452D]/10 hover:text-[#C2452D] text-gray-700 transition-colors text-left truncate"
                          >
                            {w.label}
                          </button>
                        ))}
                      </div>
                    )}

                    {/* Custom Range Tab */}
                    {pickerTab === "range" && (
                      <div className="space-y-2">
                        <div className="flex gap-2 items-center">
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
                          className="w-full py-2 text-xs font-medium rounded-md bg-[#C2452D] text-white hover:bg-[#A33822] transition-colors"
                        >
                          Add Range
                        </button>
                      </div>
                    )}
                  </div>
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
      </div>

      {/* Loading */}
      {loading && (
        <div className="flex items-center justify-center py-16">
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

          {/* Summary Cards — scrollable on mobile */}
          <div className="overflow-x-auto scrollbar-thin -mx-4 px-4 sm:mx-0 sm:px-0">
            <div className={`grid gap-3 ${data.periods.length <= 4 ? `grid-cols-2 sm:grid-cols-${Math.min(data.periods.length, 4)}` : "flex"}`} style={data.periods.length > 4 ? { display: "flex" } : undefined}>
              {data.periods.map((p, i) => {
                const ci = i % PERIOD_COLORS.length;
                const base = data.periods[0];
                const isBase = i === 0;
                const val = metric === "revenue" ? p.summary.revenue : metric === "orders" ? p.summary.orders : p.summary.aov;
                const baseVal = metric === "revenue" ? base.summary.revenue : metric === "orders" ? base.summary.orders : base.summary.aov;
                const change = !isBase ? pctChange(val, baseVal) : null;
                const proj = getProjection(p);
                const projVal = proj && metric === "revenue" ? proj.projected : proj && metric === "orders" ? proj.projectedOrders : null;
                return (
                  <div
                    key={i}
                    className={`bg-white rounded-xl border p-3 ${PERIOD_BORDER[ci]} ${data.periods.length > 4 ? "min-w-[160px] shrink-0" : ""}`}
                  >
                    <div className="flex items-center gap-1.5 mb-1.5">
                      <div
                        className="w-2 h-2 rounded-full shrink-0"
                        style={{ backgroundColor: PERIOD_COLORS[ci] }}
                      />
                      <span className="text-[11px] font-medium text-gray-500 truncate">{p.label}</span>
                      {isBase && <span className="text-[9px] bg-gray-100 text-gray-500 px-1 py-0.5 rounded shrink-0">Base</span>}
                    </div>
                    <div className="text-lg font-bold text-gray-900 tabular-nums">
                      {metric === "revenue" || metric === "aov" ? fmtRM(val) : val.toLocaleString()}
                    </div>
                    <div className="flex items-center gap-2 mt-0.5 text-[11px] text-gray-500">
                      <span>{p.summary.orders} orders</span>
                      {change && (
                        <span className={`font-medium ${change.color}`}>{change.label}</span>
                      )}
                    </div>
                    {proj && projVal !== null && metric !== "aov" && (
                      <div className="mt-1.5 pt-1.5 border-t border-gray-100">
                        <div className="text-[10px] text-gray-400">
                          Projected ({proj.daysElapsed}/{proj.totalDays} days, {proj.method})
                        </div>
                        <div className="text-sm font-semibold text-gray-600 tabular-nums">
                          {metric === "revenue" ? fmtRM(projVal) : `${projVal} orders`}
                        </div>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>

          {/* By Time Round */}
          <div className="bg-white rounded-xl border border-gray-200 p-4 overflow-hidden">
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
              <div className="overflow-x-auto -mx-4 px-4">
                <table className="w-full text-xs" style={{ minWidth: Math.max(500, data.periods.length * 130 + 120) }}>
                  <thead>
                    <tr className="border-b border-gray-100">
                      <th className="text-left py-2 pr-3 font-medium text-gray-500 sticky left-0 bg-white z-10 whitespace-nowrap">Round</th>
                      {data.periods.map((p, i) => (
                        <th key={i} className="text-right py-2 px-2 font-medium whitespace-nowrap" style={{ color: PERIOD_COLORS[i % PERIOD_COLORS.length] }}>
                          {p.label}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {data.periods[0].rounds.map((r, ri) => (
                      <tr key={r.key} className="border-b border-gray-50">
                        <td className="py-2 pr-3 font-medium text-gray-700 sticky left-0 bg-white z-10 whitespace-nowrap">{r.label}</td>
                        {data.periods.map((p, pi) => {
                          const pr = p.rounds[ri];
                          const val = metric === "revenue" ? pr.revenue : metric === "orders" ? pr.orders : pr.aov;
                          return (
                            <td key={pi} className="text-right py-2 px-2 text-gray-700 tabular-nums whitespace-nowrap">
                              {metric === "revenue" || metric === "aov" ? fmtRM(val) : val}
                            </td>
                          );
                        })}
                      </tr>
                    ))}
                    {/* Totals row */}
                    <tr className="border-t-2 border-gray-200 font-semibold">
                      <td className="py-2 pr-3 text-gray-900 sticky left-0 bg-white z-10">Total</td>
                      {data.periods.map((p, pi) => {
                        const val = metric === "revenue" ? p.summary.revenue : metric === "orders" ? p.summary.orders : p.summary.aov;
                        return (
                          <td key={pi} className="text-right py-2 px-2 text-gray-900 tabular-nums whitespace-nowrap">
                            {metric === "revenue" || metric === "aov" ? fmtRM(val) : val}
                          </td>
                        );
                      })}
                    </tr>
                  </tbody>
                </table>
              </div>
            )}
          </div>

          {/* Day-of-Week Averages */}
          <div className="bg-white rounded-xl border border-gray-200 p-4 overflow-hidden">
            <button
              onClick={() => setShowDow(!showDow)}
              className="flex items-center justify-between w-full mb-3"
            >
              <h2 className="text-sm font-semibold text-gray-900">
                Day-of-Week Averages ({metric === "revenue" ? "Revenue" : metric === "orders" ? "Orders" : "AOV"})
              </h2>
              {showDow ? <ChevronUp className="w-4 h-4 text-gray-400" /> : <ChevronDown className="w-4 h-4 text-gray-400" />}
            </button>
            {showDow && (
              <div className="overflow-x-auto -mx-4 px-4">
                <table className="w-full text-xs" style={{ minWidth: Math.max(500, data.periods.length * 100 + 80) }}>
                  <thead>
                    <tr className="border-b border-gray-100">
                      <th className="text-left py-2 pr-3 font-medium text-gray-500 sticky left-0 bg-white z-10 whitespace-nowrap">Day</th>
                      {data.periods.map((p, i) => (
                        <th key={i} className="text-right py-2 px-2 font-medium whitespace-nowrap" style={{ color: PERIOD_COLORS[i % PERIOD_COLORS.length] }}>
                          {p.label}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {DOW_NAMES.map((dow, di) => {
                      const allDow = data.periods.map((p) => getDowAverages(p)[di]);
                      // Find best value for highlighting
                      const vals = allDow.map((d) => metric === "revenue" ? d.avgRevenue : d.avgOrders);
                      const maxVal = Math.max(...vals);
                      return (
                        <tr key={dow} className={`border-b border-gray-50 ${di >= 5 ? "bg-amber-50/30" : ""}`}>
                          <td className={`py-2 pr-3 font-medium text-gray-700 sticky left-0 z-10 whitespace-nowrap ${di >= 5 ? "bg-amber-50/30" : "bg-white"}`}>
                            {dow} {di >= 5 && <span className="text-[9px] text-amber-500 ml-1">wknd</span>}
                          </td>
                          {allDow.map((d, pi) => {
                            const val = metric === "revenue" ? d.avgRevenue : metric === "orders" ? d.avgOrders : (d.avgOrders > 0 ? Math.round((d.avgRevenue / d.avgOrders) * 100) / 100 : 0);
                            const isBest = val === maxVal && maxVal > 0 && data.periods.length > 1;
                            return (
                              <td key={pi} className={`text-right py-2 px-2 tabular-nums whitespace-nowrap ${isBest ? "font-semibold text-green-700" : "text-gray-700"}`}>
                                {d.count === 0 ? <span className="text-gray-300">—</span> : metric === "revenue" || metric === "aov" ? fmtRM(val) : val}
                              </td>
                            );
                          })}
                        </tr>
                      );
                    })}
                    {/* Weekly average row */}
                    <tr className="border-t-2 border-gray-200 font-semibold">
                      <td className="py-2 pr-3 text-gray-900 sticky left-0 bg-white z-10">Avg/day</td>
                      {data.periods.map((p, pi) => {
                        const daysWithData = p.dailyTotals.filter((d) => d.revenue > 0 || d.orders > 0).length;
                        const val = metric === "revenue"
                          ? (daysWithData > 0 ? Math.round((p.summary.revenue / daysWithData) * 100) / 100 : 0)
                          : metric === "orders"
                          ? (daysWithData > 0 ? Math.round(p.summary.orders / daysWithData) : 0)
                          : p.summary.aov;
                        return (
                          <td key={pi} className="text-right py-2 px-2 text-gray-900 tabular-nums whitespace-nowrap">
                            {metric === "revenue" || metric === "aov" ? fmtRM(val) : val}
                          </td>
                        );
                      })}
                    </tr>
                  </tbody>
                </table>
              </div>
            )}
          </div>

          {/* Channel Mix */}
          <div className="bg-white rounded-xl border border-gray-200 p-4 overflow-hidden">
            <button
              onClick={() => setShowChannels(!showChannels)}
              className="flex items-center justify-between w-full mb-3"
            >
              <h2 className="text-sm font-semibold text-gray-900">Channel Breakdown</h2>
              {showChannels ? <ChevronUp className="w-4 h-4 text-gray-400" /> : <ChevronDown className="w-4 h-4 text-gray-400" />}
            </button>
            {showChannels && (
              <div className="overflow-x-auto -mx-4 px-4">
                <table className="w-full text-xs" style={{ minWidth: 450 }}>
                  <thead>
                    <tr className="border-b border-gray-100">
                      <th className="text-left py-2 pr-3 font-medium text-gray-500 sticky left-0 bg-white z-10 whitespace-nowrap">Period</th>
                      <th className="text-right py-2 px-2 font-medium text-blue-600 whitespace-nowrap">Dine In</th>
                      <th className="text-right py-2 px-2 font-medium text-amber-600 whitespace-nowrap">Takeaway</th>
                      <th className="text-right py-2 px-2 font-medium text-purple-600 whitespace-nowrap">Delivery</th>
                      <th className="text-right py-2 pl-2 font-medium text-gray-700 whitespace-nowrap">Total</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.periods.map((p, i) => {
                      const ci = i % PERIOD_COLORS.length;
                      const di = metric === "revenue" ? p.channels.dineIn.revenue : p.channels.dineIn.orders;
                      const ta = metric === "revenue" ? p.channels.takeaway.revenue : p.channels.takeaway.orders;
                      const del = metric === "revenue" ? p.channels.delivery.revenue : p.channels.delivery.orders;
                      const total = metric === "revenue" ? p.summary.revenue : p.summary.orders;
                      const fmt = (v: number) => metric === "revenue" ? fmtRM(v) : v.toString();
                      return (
                        <tr key={i} className="border-b border-gray-50">
                          <td className="py-2 pr-3 sticky left-0 bg-white z-10">
                            <div className="flex items-center gap-1.5">
                              <div className="w-2 h-2 rounded-full shrink-0" style={{ backgroundColor: PERIOD_COLORS[ci] }} />
                              <span className="font-medium text-gray-700 whitespace-nowrap">{p.label}</span>
                            </div>
                          </td>
                          <td className="text-right py-2 px-2 text-gray-700 tabular-nums whitespace-nowrap">{fmt(di)}</td>
                          <td className="text-right py-2 px-2 text-gray-700 tabular-nums whitespace-nowrap">{fmt(ta)}</td>
                          <td className="text-right py-2 px-2 text-gray-700 tabular-nums whitespace-nowrap">{fmt(del)}</td>
                          <td className="text-right py-2 pl-2 font-medium text-gray-900 tabular-nums whitespace-nowrap">{fmt(total)}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          {/* Daily Breakdown with 7-day MA */}
          {data.periods.some((p) => p.dailyTotals.length > 1) && (
            <div className="bg-white rounded-xl border border-gray-200 p-4 overflow-hidden">
              <button
                onClick={() => setShowDaily(!showDaily)}
                className="flex items-center justify-between w-full mb-3"
              >
                <h2 className="text-sm font-semibold text-gray-900">
                  Daily Breakdown with 7-day MA
                </h2>
                {showDaily ? <ChevronUp className="w-4 h-4 text-gray-400" /> : <ChevronDown className="w-4 h-4 text-gray-400" />}
              </button>
              {showDaily && (
                <div className="space-y-4">
                  {data.periods.map((p, i) => {
                    const ci = i % PERIOD_COLORS.length;
                    const daily = getDailyWithMA(p);
                    if (daily.length <= 1) return null;
                    return (
                      <div key={i}>
                        <div className="flex items-center gap-1.5 mb-2">
                          <div className="w-2 h-2 rounded-full shrink-0" style={{ backgroundColor: PERIOD_COLORS[ci] }} />
                          <span className="text-xs font-semibold" style={{ color: PERIOD_COLORS[ci] }}>{p.label}</span>
                        </div>
                        <div className="overflow-x-auto -mx-4 px-4">
                          <table className="w-full text-xs" style={{ minWidth: 400 }}>
                            <thead>
                              <tr className="border-b border-gray-100">
                                <th className="text-left py-1.5 pr-3 font-medium text-gray-500 sticky left-0 bg-white z-10">Date</th>
                                <th className="text-right py-1.5 px-2 font-medium text-gray-500">{metric === "revenue" ? "Revenue" : "Orders"}</th>
                                <th className="text-right py-1.5 px-2 font-medium text-blue-500">7d MA</th>
                                <th className="text-right py-1.5 px-2 font-medium text-gray-400">vs MA</th>
                              </tr>
                            </thead>
                            <tbody>
                              {daily.map((d) => {
                                const val = metric === "revenue" ? d.revenue : d.orders;
                                const ma = metric === "revenue" ? d.maRevenue : d.maOrders;
                                const vsMa = ma !== null && ma > 0 ? pctChange(val, ma) : null;
                                return (
                                  <tr key={d.date} className="border-b border-gray-50">
                                    <td className="py-1.5 pr-3 font-medium text-gray-700 sticky left-0 bg-white z-10 whitespace-nowrap">{d.label}</td>
                                    <td className="text-right py-1.5 px-2 text-gray-700 tabular-nums">
                                      {metric === "revenue" ? fmtRM(val) : val}
                                    </td>
                                    <td className="text-right py-1.5 px-2 text-blue-600 tabular-nums">
                                      {ma !== null ? (metric === "revenue" ? fmtRM(ma) : Math.round(ma as number)) : <span className="text-gray-300">—</span>}
                                    </td>
                                    <td className="text-right py-1.5 px-2 tabular-nums">
                                      {vsMa ? <span className={vsMa.color}>{vsMa.label}</span> : <span className="text-gray-300">—</span>}
                                    </td>
                                  </tr>
                                );
                              })}
                            </tbody>
                          </table>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          )}
        </>
      )}
    </div>
  );
}
