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
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ReferenceLine,
  ResponsiveContainer,
} from "recharts";

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

type PeriodSource = {
  key: string;
  label: string;
  revenue: number;
  orders: number;
  aov: number;
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
  // Sales-channel breakdown (till / QR table / pickup app / GrabFood /
  // consignment …). Optional so a stale client survives an older API.
  sources?: PeriodSource[];
  hourly: { hour: number; revenue: number; orders: number }[];
  dailyTotals: { date: string; revenue: number; orders: number; rounds: { key: string; revenue: number; orders: number }[] }[];
  // Server-side DOW projection — only populated when today falls inside
  // the period. Uses 4 weeks of pre-period data + same-period last month.
  projection: { projected: number; projectedOrders: number; daysElapsed: number; totalDays: number; method: string } | null;
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
  // Prefer the server-computed projection (DOW × 4 weeks, with cold-start
  // blend toward last month's revenue). Falls back to the legacy client
  // compute below for safety — covers periods with no SalesTransaction
  // history (e.g. brand-new outlets) where the server returns null.
  if (p.projection) return p.projection;

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

  // Use only completed days (exclude today's partial data) as the base
  const completedDays = p.dailyTotals.filter((d) => d.date < today && d.date >= p.from);
  const completedCount = completedDays.length;
  const completedRev = completedDays.reduce((s, d) => s + d.revenue, 0);
  const completedOrd = completedDays.reduce((s, d) => s + d.orders, 0);
  const daysRemaining = totalDays - completedCount; // today + future days
  let method = "avg";

  // Use last 7 completed days' average if available
  const last7 = completedDays.slice(-7);
  if (last7.length >= 3) {
    const l7Rev = last7.reduce((s, d) => s + d.revenue, 0) / last7.length;
    const l7Ord = last7.reduce((s, d) => s + d.orders, 0) / last7.length;
    method = `${last7.length}d MA`;
    return {
      projected: Math.round((completedRev + l7Rev * daysRemaining) * 100) / 100,
      projectedOrders: Math.round(completedOrd + l7Ord * daysRemaining),
      daysElapsed,
      totalDays,
      method,
    };
  }

  if (completedCount === 0) return null;
  const dailyAvgRev = completedRev / completedCount;
  const dailyAvgOrd = completedOrd / completedCount;
  return {
    projected: Math.round(dailyAvgRev * totalDays * 100) / 100,
    projectedOrders: Math.round(dailyAvgOrd * totalDays),
    daysElapsed,
    totalDays,
    method,
  };
}

/**
 * Like-for-like pace when a PARTIAL period (contains today) is compared
 * against a longer one — e.g. Jul 1-18 vs the whole of June. The headline
 * delta ("-42.3%") compares 18 days against 30 and reads as a crash; this
 * compares the first K completed days of each period instead.
 * Returns null when the comparison period doesn't extend beyond K days
 * (headline is already fair) or when there's nothing to compare yet.
 */
function getAlignedPace(
  p: PeriodResult,
  prev: PeriodResult,
): { days: number; revenue: number; orders: number; prevRevenue: number; prevOrders: number } | null {
  const today = getMYTToday();
  if (today < p.from || today > p.to) return null; // p is complete — headline is fair
  const completed = p.dailyTotals.filter((d) => d.date < today);
  const k = Math.min(completed.length, prev.dailyTotals.length);
  if (k < 1) return null;
  if (prev.dailyTotals.length <= k) return null; // same span — nothing extra to say
  const sum = (arr: { revenue: number; orders: number }[]) =>
    arr.reduce((s, d) => ({ revenue: s.revenue + d.revenue, orders: s.orders + d.orders }), { revenue: 0, orders: 0 });
  const cur = sum(completed.slice(0, k));
  const prv = sum(prev.dailyTotals.slice(0, k));
  return { days: k, revenue: cur.revenue, orders: cur.orders, prevRevenue: prv.revenue, prevOrders: prv.orders };
}

const DOW_NAMES = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

/** Compute average revenue/orders per day-of-week for a period (exclude today's partial data) */
function getDowAverages(p: PeriodResult): { dow: string; avgRevenue: number; avgOrders: number; count: number }[] {
  const today = getMYTToday();
  const buckets: { revenue: number; orders: number; count: number }[] = Array.from({ length: 7 }, () => ({ revenue: 0, orders: 0, count: 0 }));
  for (const d of p.dailyTotals) {
    if (d.date === today) continue; // Skip today — partial data skews averages
    const date = new Date(d.date + "T12:00:00+08:00");
    let dow = date.getDay() - 1;
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

type RoundMA = { key: string; value: number; ma: number | null };

/** Compute 7-day trailing moving average for daily totals including per-round */
function getDailyWithMA(p: PeriodResult): { date: string; label: string; revenue: number; orders: number; maRevenue: number | null; maOrders: number | null; roundMAs: RoundMA[] }[] {
  const today = getMYTToday();
  return p.dailyTotals
    .filter((d) => d.date <= today)
    .map((d, i, arr) => {
      const date = new Date(d.date + "T12:00:00+08:00");
      const days = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
      const label = `${days[date.getDay()]} ${date.getDate()}`;

      // 7-day trailing MA — for today use previous 7 days (exclude partial today)
      let maRevenue: number | null = null;
      let maOrders: number | null = null;
      const isToday = d.date === today;
      if (isToday && i >= 7) {
        // Today is partial — MA from 7 completed days before today
        const window = arr.slice(i - 7, i);
        maRevenue = Math.round((window.reduce((s, w) => s + w.revenue, 0) / 7) * 100) / 100;
        maOrders = Math.round((window.reduce((s, w) => s + w.orders, 0) / 7) * 100) / 100;
      } else if (!isToday && i >= 6) {
        const window = arr.slice(i - 6, i + 1);
        maRevenue = Math.round((window.reduce((s, w) => s + w.revenue, 0) / 7) * 100) / 100;
        maOrders = Math.round((window.reduce((s, w) => s + w.orders, 0) / 7) * 100) / 100;
      }

      // Per-round MA — same logic: exclude today from its own MA
      const roundMAs: RoundMA[] = (d.rounds || []).map((r, ri) => {
        let ma: number | null = null;
        if (isToday && i >= 7) {
          const window = arr.slice(i - 7, i);
          const sum = window.reduce((s, w) => s + (w.rounds?.[ri]?.revenue || 0), 0);
          ma = Math.round((sum / 7) * 100) / 100;
        } else if (!isToday && i >= 6) {
          const window = arr.slice(i - 6, i + 1);
          const sum = window.reduce((s, w) => s + (w.rounds?.[ri]?.revenue || 0), 0);
          ma = Math.round((sum / 7) * 100) / 100;
        }
        return { key: r.key, value: r.revenue, ma };
      });

      return { date: d.date, label, revenue: d.revenue, orders: d.orders, maRevenue, maOrders, roundMAs };
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
  // Anchor to the 1st before shifting months. Keeping the original day (e.g. 31)
  // makes setMonth overflow into the wrong month when the target has fewer days
  // (Apr 31 → May 1), which duplicated/skipped months in the multi-month presets.
  d.setDate(1);
  d.setMonth(d.getMonth() - months);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function getPresets(): { label: string; slots: ComparisonSlot[] }[] {
  const today = getMYTToday();
  const thisMonday = getMonday(today);
  const thisMonthStart = getMonthStart(today);
  const lastMonthEnd = addDays(thisMonthStart, -1);
  const lastMonthStart = getMonthStart(lastMonthEnd);
  // Deterministic id counter — keeps server-rendered HTML byte-identical to
  // the client's first render. Math.random() here was producing different
  // ids on the server vs client and tripping React's hydration check.
  let _id = 0;
  const pid = () => `p${_id++}`;

  return [
    {
      label: "Today vs Same Day Last Week",
      slots: [
        { id: pid(), from: today, to: today },
        { id: pid(), from: addDays(today, -7), to: addDays(today, -7) },
      ],
    },
    {
      label: "Last 7 Days (daily)",
      slots: Array.from({ length: 7 }, (_, i) => ({
        id: pid(),
        from: addDays(today, -6 + i),
        to: addDays(today, -6 + i),
      })),
    },
    {
      label: "This Week vs Last Week",
      slots: [
        { id: pid(), from: thisMonday, to: getSunday(thisMonday) },
        { id: pid(), from: addDays(thisMonday, -7), to: addDays(thisMonday, -1) },
      ],
    },
    {
      label: "Last 4 Weeks",
      slots: Array.from({ length: 4 }, (_, i) => {
        const mon = addDays(thisMonday, -7 * i);
        return { id: pid(), from: mon, to: getSunday(mon) };
      }),
    },
    {
      label: "Last 8 Weeks",
      slots: Array.from({ length: 8 }, (_, i) => {
        const mon = addDays(thisMonday, -7 * i);
        return { id: pid(), from: mon, to: getSunday(mon) };
      }),
    },
    {
      label: "This Month vs Last Month",
      slots: [
        { id: pid(), from: thisMonthStart, to: getMonthEnd(today) },
        { id: pid(), from: lastMonthStart, to: lastMonthEnd },
      ],
    },
    {
      label: "Last 3 Months",
      slots: Array.from({ length: 3 }, (_, i) => {
        const mStart = getMonthStart(subtractMonths(today, i));
        const mEnd = i === 0 ? getMonthEnd(today) : getMonthEnd(mStart);
        return { id: pid(), from: mStart, to: mEnd };
      }),
    },
    {
      label: "Last 6 Months",
      slots: Array.from({ length: 6 }, (_, i) => {
        const mStart = getMonthStart(subtractMonths(today, i));
        const mEnd = i === 0 ? getMonthEnd(today) : getMonthEnd(mStart);
        return { id: pid(), from: mStart, to: mEnd };
      }),
    },
  ];
}

// ─── Component ───────────────────────────────────────────────────────────

export default function SalesComparePage() {
  const [slots, setSlots] = useState<ComparisonSlot[]>([]);
  // Selected outlet ids; empty = all outlets. Any subset is allowed —
  // e.g. Putrajaya + Shah Alam together without Tamarind.
  const [outletIds, setOutletIds] = useState<string[]>([]);
  const [showOutletPicker, setShowOutletPicker] = useState(false);
  const [data, setData] = useState<CompareResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [outlets, setOutlets] = useState<{ id: string; name: string }[]>([]);
  const [showPicker, setShowPicker] = useState(false);
  const [pickerTab, setPickerTab] = useState<"day" | "week" | "month" | "range">("day");
  const [pickerDate, setPickerDate] = useState(getMYTToday());
  const [pickerFrom, setPickerFrom] = useState(getMYTToday());
  const [pickerTo, setPickerTo] = useState(getMYTToday());
  const [metric, setMetric] = useState<"revenue" | "orders" | "aov">("revenue");
  const [showRounds, setShowRounds] = useState(true);
  const [showChannels, setShowChannels] = useState(true);
  const [showSources, setShowSources] = useState(true);
  const [showDow, setShowDow] = useState(true);
  const [showDaily, setShowDaily] = useState(false);
  // Guards the URL-sync effect until the mount effect has restored state
  const [booted, setBooted] = useState(false);
  const pickerRef = useRef<HTMLDivElement>(null);
  const outletPickerRef = useRef<HTMLDivElement>(null);

  // Close pickers on outside click
  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (pickerRef.current && !pickerRef.current.contains(e.target as Node)) {
        setShowPicker(false);
      }
      if (outletPickerRef.current && !outletPickerRef.current.contains(e.target as Node)) {
        setShowOutletPicker(false);
      }
    }
    if (showPicker || showOutletPicker) document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, [showPicker, showOutletPicker]);

  const fetchData = useCallback(
    async (currentSlots: ComparisonSlot[], outletSel: string[]) => {
      if (currentSlots.length === 0) {
        setData(null);
        return;
      }
      setLoading(true);
      setError(null);
      try {
        const periodsStr = currentSlots.map((s) => `${s.from}:${s.to}`).join(",");
        let url = `/api/sales/compare?periods=${periodsStr}`;
        if (outletSel.length > 0) url += `&outletIds=${outletSel.join(",")}`;
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

  // On mount: restore state from the URL (?p=from:to,…&o=id,id&m=metric) so a
  // view survives reload and can be shared as a link. With no URL state, open
  // on This Month vs Last Month instead of an empty page.
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const isDate = (s: string) => /^\d{4}-\d{2}-\d{2}$/.test(s);
    const urlSlots: ComparisonSlot[] = (params.get("p") ?? "")
      .split(",")
      .map((pair) => pair.trim())
      .filter(Boolean)
      .map((pair) => {
        const [from, to] = pair.split(":");
        return { id: uid(), from, to: to || from };
      })
      .filter((s) => isDate(s.from) && isDate(s.to))
      .slice(0, MAX_SLOTS);
    const urlOutlets = (params.get("o") ?? "").split(",").map((s) => s.trim()).filter(Boolean);
    const m = params.get("m");
    if (m === "orders" || m === "aov") setMetric(m);

    const initialSlots = urlSlots.length > 0
      ? urlSlots
      : getPresets().find((p) => p.label === "This Month vs Last Month")?.slots ?? [];
    setSlots(initialSlots);
    setOutletIds(urlOutlets);
    fetchData(initialSlots, urlOutlets);
    setBooted(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Keep the URL in sync (replace, not push — Back shouldn't walk every click)
  useEffect(() => {
    if (!booted) return;
    const params = new URLSearchParams();
    if (slots.length > 0) params.set("p", slots.map((s) => `${s.from}:${s.to}`).join(","));
    if (outletIds.length > 0) params.set("o", outletIds.join(","));
    if (metric !== "revenue") params.set("m", metric);
    const qs = params.toString();
    window.history.replaceState(null, "", qs ? `?${qs}` : window.location.pathname);
  }, [booted, slots, outletIds, metric]);

  const addSlot = (from: string, to: string) => {
    if (slots.length >= MAX_SLOTS) return;
    const next = [...slots, { id: uid(), from, to }];
    setSlots(next);
    setShowPicker(false);
    fetchData(next, outletIds);
  };

  const removeSlot = (id: string) => {
    const next = slots.filter((s) => s.id !== id);
    setSlots(next);
    fetchData(next, outletIds);
  };

  const clearAll = () => {
    setSlots([]);
    setData(null);
  };

  const applyPreset = (preset: { slots: ComparisonSlot[] }) => {
    const capped = preset.slots.slice(0, MAX_SLOTS);
    setSlots(capped);
    fetchData(capped, outletIds);
  };

  const toggleOutlet = (id: string) => {
    const next = outletIds.includes(id)
      ? outletIds.filter((o) => o !== id)
      : [...outletIds, id];
    // Selecting every outlet is the same as "all" — collapse to the default
    const normalized = next.length === outlets.length ? [] : next;
    setOutletIds(normalized);
    fetchData(slots, normalized);
  };

  const selectAllOutlets = () => {
    setOutletIds([]);
    fetchData(slots, []);
  };

  const outletButtonLabel =
    outletIds.length === 0
      ? "All Outlets"
      : outletIds.length === 1
        ? (outlets.find((o) => o.id === outletIds[0])?.name ?? "1 outlet")
        : `${outletIds.length} outlets`;

  const presets = getPresets();

  // Signature = the period list; used to highlight the active preset chip
  const slotsSignature = slots.map((s) => `${s.from}:${s.to}`).join(",");
  const presetSignature = (p: { slots: ComparisonSlot[] }) =>
    p.slots.map((s) => `${s.from}:${s.to}`).join(",");

  // Which outlets the numbers cover — shown beside the results so a
  // screenshot or shared link is self-explanatory
  const outletContextLabel =
    outletIds.length === 0
      ? "All outlets"
      : outletIds.length <= 2
        ? outletIds
            .map((id) => outlets.find((o) => o.id === id)?.name?.replace(/^Celsius Coffee\s+/i, "") ?? "?")
            .join(" + ")
        : `${outletIds.length} outlets`;

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

  // Generate month options (last 12 months)
  const MONTH_NAMES = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  const monthOptions = Array.from({ length: 12 }, (_, i) => {
    const mStart = getMonthStart(subtractMonths(getMYTToday(), i));
    const d = new Date(mStart + "T12:00:00+08:00");
    return {
      from: mStart,
      to: getMonthEnd(mStart),
      label: `${MONTH_NAMES[d.getMonth()]} ${d.getFullYear()}`,
    };
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

      {/* Quick Presets — visible chips beat a blank dropdown; active one highlighted */}
      <div className="overflow-x-auto scrollbar-thin -mx-4 px-4 sm:mx-0 sm:px-0">
        <div className="flex items-center gap-1.5 pb-1">
          {presets.map((p) => {
            const isActive = slotsSignature === presetSignature(p);
            return (
              <button
                key={p.label}
                onClick={() => applyPreset(p)}
                className={`px-2.5 py-1.5 text-xs rounded-full border whitespace-nowrap shrink-0 transition-colors ${
                  isActive
                    ? "bg-[#C2452D] border-[#C2452D] text-white"
                    : "bg-white border-gray-200 text-gray-600 hover:border-[#C2452D]/50 hover:text-[#C2452D]"
                }`}
              >
                {p.label}
              </button>
            );
          })}
        </div>
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
                      <span className="text-[9px] font-bold rounded-full w-4 h-4 flex items-center justify-center shrink-0 text-white" style={{ backgroundColor: PERIOD_COLORS[ci] }}>{i + 1}</span>
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
                      { key: "month" as const, label: "Month" },
                      { key: "range" as const, label: "Custom" },
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

                    {/* Month Tab */}
                    {pickerTab === "month" && (
                      <div className="grid grid-cols-2 gap-1.5 max-h-64 overflow-y-auto">
                        {monthOptions.map((mo) => (
                          <button
                            key={mo.from}
                            onClick={() => addSlot(mo.from, mo.to)}
                            className="px-2 py-2 text-xs rounded-md bg-gray-50 hover:bg-[#C2452D]/10 hover:text-[#C2452D] text-gray-700 transition-colors text-left truncate"
                          >
                            {mo.label}
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

          {/* Outlet Filter — multi-select: any subset of outlets */}
          <div className="relative ml-auto" ref={outletPickerRef}>
            <button
              onClick={() => setShowOutletPicker(!showOutletPicker)}
              className={`flex items-center gap-1.5 px-3 py-2 text-sm rounded-lg border bg-white transition-colors ${
                outletIds.length > 0 ? "border-[#C2452D] text-[#C2452D]" : "border-gray-200 text-gray-700"
              }`}
            >
              {outletButtonLabel}
              <ChevronDown className="w-3.5 h-3.5" />
            </button>
            {showOutletPicker && (
              <div className="absolute top-full right-0 mt-2 z-50 bg-white rounded-xl shadow-xl border border-gray-200 w-60 p-2">
                <button
                  onClick={selectAllOutlets}
                  className={`w-full text-left px-2.5 py-2 text-xs rounded-md transition-colors ${
                    outletIds.length === 0
                      ? "bg-[#C2452D]/10 text-[#C2452D] font-medium"
                      : "text-gray-700 hover:bg-gray-50"
                  }`}
                >
                  All Outlets
                </button>
                <div className="my-1 border-t border-gray-100" />
                {outlets.map((o) => {
                  const checked = outletIds.includes(o.id);
                  return (
                    <label
                      key={o.id}
                      className="flex items-center gap-2 px-2.5 py-2 text-xs rounded-md text-gray-700 hover:bg-gray-50 cursor-pointer"
                    >
                      <input
                        type="checkbox"
                        checked={checked}
                        onChange={() => toggleOutlet(o.id)}
                        className="w-3.5 h-3.5 rounded border-gray-300 accent-[#C2452D]"
                      />
                      <span className={checked ? "font-medium text-gray-900" : ""}>{o.name}</span>
                    </label>
                  );
                })}
                {outletIds.length > 0 && (
                  <p className="px-2.5 pt-1.5 pb-0.5 text-[10px] text-gray-400 border-t border-gray-100 mt-1">
                    Comparing {outletIds.length === 1 ? "1 outlet" : `${outletIds.length} outlets combined`}
                  </p>
                )}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Loading — full spinner only on first load; refetches keep the old
          results visible (dimmed) so the page never blanks and flashes */}
      {loading && !data && (
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
      {!loading && !error && slots.length === 0 && booted && (
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
      {data && data.periods.length > 0 && (
        <div className={`space-y-4 transition-opacity ${loading ? "opacity-40 pointer-events-none" : ""}`}>
          {/* Metric Toggle + context (which outlets these numbers cover) */}
          <div className="flex items-center gap-3 flex-wrap">
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
            <span className="text-xs text-gray-400">
              {outletContextLabel}
              {loading && <Loader2 className="inline w-3.5 h-3.5 ml-2 animate-spin text-[#C2452D]" />}
            </span>
          </div>

          {/* Accumulative Overlay Chart — the hero comparison graph */}
          {data.periods[0]?.hourly && (() => {
            const chartMetric: "revenue" | "orders" = metric === "orders" ? "orders" : "revenue";
            const today = getMYTToday();
            const nowHour = new Date(Date.now() + 8 * 60 * 60 * 1000).getUTCHours();
            // Single-day periods → hourly cumulative (StoreHub-style). Any
            // multi-day period → daily cumulative aligned by day index.
            const allSingleDay = data.periods.every((p) => p.from === p.to);
            let chartData: Record<string, number | string | null>[];
            let xMode: "hour" | "day";
            // Where "now" sits on the x-axis — a dashed marker so it's obvious
            // why the latest period's line stops where it does
            let nowLabel: string | null = null;
            if (allSingleDay) {
              xMode = "hour";
              const cum = data.periods.map((p) => {
                const isToday = p.to === today;
                let c = 0;
                return p.hourly.map((h) => {
                  if (isToday && h.hour > nowHour) return null;
                  c += chartMetric === "revenue" ? h.revenue : h.orders;
                  return Math.round(c * 100) / 100;
                });
              });
              chartData = Array.from({ length: 24 }, (_, hr) => {
                const row: Record<string, number | string | null> = { label: `${String(hr).padStart(2, "0")}:00` };
                data.periods.forEach((_, i) => { row[`p${i}`] = cum[i][hr]; });
                return row;
              });
              if (data.periods.some((p) => p.to === today)) {
                nowLabel = `${String(nowHour).padStart(2, "0")}:00`;
              }
            } else {
              xMode = "day";
              const cum = data.periods.map((p) => {
                let c = 0;
                return p.dailyTotals.map((d) => {
                  if (d.date > today) return null; // stop at today; future dates flatline otherwise
                  c += chartMetric === "revenue" ? d.revenue : d.orders;
                  return Math.round(c * 100) / 100;
                });
              });
              const maxDays = Math.max(...data.periods.map((p) => p.dailyTotals.length));
              chartData = Array.from({ length: maxDays }, (_, di) => {
                const row: Record<string, number | string | null> = { label: `Day ${di + 1}` };
                data.periods.forEach((_, i) => { row[`p${i}`] = di < cum[i].length ? cum[i][di] : null; });
                return row;
              });
              const partial = data.periods.find((p) => p.from <= today && today <= p.to);
              if (partial) {
                const idx = partial.dailyTotals.findIndex((d) => d.date === today);
                if (idx >= 0) nowLabel = `Day ${idx + 1}`;
              }
            }
            return (
              <div className="bg-white rounded-xl border border-gray-200 p-4">
                <div className="mb-3">
                  <h2 className="text-sm font-semibold text-gray-900">
                    Accumulative {chartMetric === "revenue" ? "Revenue" : "Orders"}
                    {chartMetric === "revenue" && <span className="font-normal text-gray-400"> (RM)</span>}
                  </h2>
                  <p className="mt-0.5 text-xs text-gray-500">
                    Running total by {xMode === "hour" ? "hour" : "day"}
                    {metric === "aov" && " · AOV isn't cumulative — showing revenue"}
                  </p>
                </div>
                <ResponsiveContainer width="100%" height={320}>
                  <LineChart data={chartData} margin={{ top: 5, right: 12, left: -8, bottom: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                    <XAxis dataKey="label" tick={{ fontSize: 11 }} tickLine={false} axisLine={false} interval="preserveStartEnd" minTickGap={8} />
                    <YAxis
                      tick={{ fontSize: 11 }}
                      tickLine={false}
                      axisLine={false}
                      width={46}
                      tickFormatter={(v) => {
                        const n = Number(v);
                        if (chartMetric !== "revenue" || n < 1000) return `${v}`;
                        // ≥100k → whole-K ("320K"); below → 1dp ("9.5K")
                        return n >= 100000 ? `${Math.round(n / 1000)}K` : `${(n / 1000).toFixed(1)}K`;
                      }}
                    />
                    {nowLabel && (
                      <ReferenceLine
                        x={nowLabel}
                        stroke="#9ca3af"
                        strokeDasharray="4 3"
                        label={{ value: "now", position: "top", fontSize: 10, fill: "#9ca3af" }}
                      />
                    )}
                    <Tooltip
                      formatter={(value, name) => [
                        value == null ? "—" : chartMetric === "revenue" ? fmtRM(value as number) : value,
                        name,
                      ]}
                      contentStyle={{ borderRadius: 10, border: "1px solid #e5e7eb", fontSize: 12 }}
                    />
                    <Legend wrapperStyle={{ fontSize: 12, paddingTop: 8 }} />
                    {data.periods.map((p, i) => (
                      <Line
                        key={i}
                        type="monotone"
                        dataKey={`p${i}`}
                        name={p.label}
                        stroke={PERIOD_COLORS[i % PERIOD_COLORS.length]}
                        strokeWidth={2}
                        dot={false}
                        connectNulls={false}
                      />
                    ))}
                  </LineChart>
                </ResponsiveContainer>
              </div>
            );
          })()}

          {/* Summary Cards — scrollable on mobile. NOTE: Tailwind can't JIT a
              template-string class (`sm:grid-cols-${n}` never generated), so
              the column count maps to static classes. */}
          <div className="overflow-x-auto scrollbar-thin -mx-4 px-4 sm:mx-0 sm:px-0">
            <div
              className={`gap-3 ${
                data.periods.length > 4
                  ? "flex"
                  : `grid grid-cols-2 ${
                      ["sm:grid-cols-1", "sm:grid-cols-2", "sm:grid-cols-3", "sm:grid-cols-4"][data.periods.length - 1] ?? "sm:grid-cols-4"
                    }`
              }`}
            >
              {data.periods.map((p, i) => {
                const ci = i % PERIOD_COLORS.length;
                const val = metric === "revenue" ? p.summary.revenue : metric === "orders" ? p.summary.orders : p.summary.aov;
                // Compare against the next (older) period
                const prev = i < data.periods.length - 1 ? data.periods[i + 1] : null;
                const prevVal = prev ? (metric === "revenue" ? prev.summary.revenue : metric === "orders" ? prev.summary.orders : prev.summary.aov) : null;
                const change = prevVal !== null ? pctChange(val, prevVal) : null;
                const isLatest = i === 0;
                const proj = getProjection(p);
                const projVal = proj && metric === "revenue" ? proj.projected : proj && metric === "orders" ? proj.projectedOrders : null;
                return (
                  <div
                    key={i}
                    className={`bg-white rounded-xl border p-3 ${PERIOD_BORDER[ci]} ${data.periods.length > 4 ? "min-w-[160px] shrink-0" : ""}`}
                  >
                    <div className="flex items-center gap-1.5 mb-1.5">
                      <span className="text-[9px] font-bold rounded-full w-4 h-4 flex items-center justify-center shrink-0 text-white" style={{ backgroundColor: PERIOD_COLORS[ci] }}>{i + 1}</span>
                      <span className="text-[11px] font-medium text-gray-500 truncate">{p.label}</span>
                      {isLatest && <span className="text-[9px] bg-gray-100 text-gray-500 px-1 py-0.5 rounded shrink-0">Latest</span>}
                    </div>
                    <div className="text-lg font-bold text-gray-900 tabular-nums">
                      {metric === "revenue" || metric === "aov" ? fmtRM(val) : val.toLocaleString()}
                    </div>
                    <div className="flex items-center gap-2 mt-0.5 text-[11px] text-gray-500">
                      <span>{p.summary.orders.toLocaleString()} orders</span>
                      {change && prev && (
                        <span>
                          <span className={`font-medium ${change.color}`}>{change.label}</span>
                          <span className="text-[9px] text-gray-400 ml-1">vs {prev.label}</span>
                        </span>
                      )}
                    </div>
                    {prev && prevVal !== null && (
                      <div className="flex flex-wrap gap-x-3 gap-y-0.5 mt-1 text-[10px] text-gray-400">
                        {(() => {
                          const revDiff = p.summary.revenue - prev.summary.revenue;
                          const ordDiff = p.summary.orders - prev.summary.orders;
                          const aovDiff = p.summary.aov - prev.summary.aov;
                          return (
                            <>
                              <span className={revDiff >= 0 ? "text-green-600" : "text-red-500"}>
                                {revDiff >= 0 ? "+" : ""}RM {revDiff.toLocaleString("en-MY", { minimumFractionDigits: 0, maximumFractionDigits: 0 })}
                              </span>
                              <span className={ordDiff >= 0 ? "text-green-600" : "text-red-500"}>
                                {ordDiff >= 0 ? "+" : ""}{ordDiff} orders
                              </span>
                              <span className={aovDiff >= 0 ? "text-green-600" : "text-red-500"}>
                                {aovDiff >= 0 ? "+" : ""}RM {aovDiff.toFixed(2)} AOV
                              </span>
                            </>
                          );
                        })()}
                      </div>
                    )}
                    {prev && (() => {
                      const pace = getAlignedPace(p, prev);
                      if (!pace) return null;
                      const cur = metric === "revenue" ? pace.revenue : metric === "orders" ? pace.orders : pace.orders > 0 ? pace.revenue / pace.orders : 0;
                      const base = metric === "revenue" ? pace.prevRevenue : metric === "orders" ? pace.prevOrders : pace.prevOrders > 0 ? pace.prevRevenue / pace.prevOrders : 0;
                      const change = pctChange(cur, base);
                      const fmt = (v: number) => (metric === "orders" ? Math.round(v).toLocaleString() : fmtRM(Math.round(v * 100) / 100));
                      return (
                        <div className="mt-1.5 pt-1.5 border-t border-gray-100">
                          <div className="text-[10px] text-gray-400">
                            Pace · first {pace.days}d vs {prev.label}
                          </div>
                          <div className="text-[11px] text-gray-600 tabular-nums">
                            {fmt(cur)} vs {fmt(base)}{" "}
                            <span className={`font-medium ${change.color}`}>{change.label}</span>
                          </div>
                        </div>
                      );
                    })()}
                    {proj && projVal !== null && metric !== "aov" && (
                      <div className="mt-1.5 pt-1.5 border-t border-gray-100">
                        <div className="text-[10px] text-gray-400">
                          Projected (day {proj.daysElapsed}/{proj.totalDays} · {proj.method})
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
    {/* Sales at 23:00–08:00 belong to no round — without this row the
                        Total visibly doesn't match the rows above it */}
                    {(() => {
                      const others = data.periods.map((p) => {
                        const rev = p.summary.revenue - p.rounds.reduce((s, r) => s + r.revenue, 0);
                        const ord = p.summary.orders - p.rounds.reduce((s, r) => s + r.orders, 0);
                        return { rev: Math.round(rev * 100) / 100, ord };
                      });
                      if (!others.some((o) => Math.abs(o.rev) >= 0.01 || o.ord !== 0)) return null;
                      return (
                        <tr className="border-b border-gray-50">
                          <td className="py-2 pr-3 text-gray-400 sticky left-0 bg-white z-10 whitespace-nowrap">Other hours (11pm-8am)</td>
                          {others.map((o, pi) => {
                            const val = metric === "revenue" ? o.rev : metric === "orders" ? o.ord : o.ord > 0 ? Math.round((o.rev / o.ord) * 100) / 100 : 0;
                            return (
                              <td key={pi} className="text-right py-2 px-2 text-gray-400 tabular-nums whitespace-nowrap">
                                {metric === "revenue" || metric === "aov" ? fmtRM(val) : val}
                              </td>
                            );
                          })}
                        </tr>
                      );
                    })()}
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
                        const today = getMYTToday();
                        const completedDays = p.dailyTotals.filter((d) => d.date < today && (d.revenue > 0 || d.orders > 0));
                        const daysCount = completedDays.length;
                        const completedRevenue = completedDays.reduce((s, d) => s + d.revenue, 0);
                        const completedOrders = completedDays.reduce((s, d) => s + d.orders, 0);
                        const val = metric === "revenue"
                          ? (daysCount > 0 ? Math.round((completedRevenue / daysCount) * 100) / 100 : 0)
                          : metric === "orders"
                          ? (daysCount > 0 ? Math.round(completedOrders / daysCount) : 0)
                          : (completedOrders > 0 ? Math.round((completedRevenue / completedOrders) * 100) / 100 : 0);
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

          {/* Sales Channel Mix — which pipe the order arrived through */}
          {data.periods.some((p) => p.sources && p.sources.length > 0) && (() => {
            // Server emits every key for every period in a stable order —
            // take the first period's order, hide rows that are zero everywhere.
            const template = data.periods.find((p) => p.sources && p.sources.length > 0)!.sources!;
            const activeKeys = template
              .map((s) => s.key)
              .filter((key) =>
                data.periods.some((p) => {
                  const src = p.sources?.find((s) => s.key === key);
                  return src && (src.revenue > 0 || src.orders > 0);
                }),
              );
            if (activeKeys.length === 0) return null;
            return (
              <div className="bg-white rounded-xl border border-gray-200 p-4 overflow-hidden">
                <button
                  onClick={() => setShowSources(!showSources)}
                  className="flex items-center justify-between w-full mb-3"
                >
                  <div className="text-left">
                    <h2 className="text-sm font-semibold text-gray-900">Sales Channel Breakdown</h2>
                    <p className="text-[11px] text-gray-400">Till · QR table · pickup app · GrabFood · consignment</p>
                  </div>
                  {showSources ? <ChevronUp className="w-4 h-4 text-gray-400" /> : <ChevronDown className="w-4 h-4 text-gray-400" />}
                </button>
                {showSources && (
                  <div className="overflow-x-auto -mx-4 px-4">
                    <table className="w-full text-xs" style={{ minWidth: Math.max(500, data.periods.length * 130 + 120) }}>
                      <thead>
                        <tr className="border-b border-gray-100">
                          <th className="text-left py-2 pr-3 font-medium text-gray-500 sticky left-0 bg-white z-10 whitespace-nowrap">Channel</th>
                          {data.periods.map((p, i) => (
                            <th key={i} className="text-right py-2 px-2 font-medium whitespace-nowrap" style={{ color: PERIOD_COLORS[i % PERIOD_COLORS.length] }}>
                              {p.label}
                            </th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {activeKeys.map((key) => {
                          const label = template.find((s) => s.key === key)?.label ?? key;
                          return (
                            <tr key={key} className="border-b border-gray-50">
                              <td className="py-2 pr-3 font-medium text-gray-700 sticky left-0 bg-white z-10 whitespace-nowrap">{label}</td>
                              {data.periods.map((p, pi) => {
                                const src = p.sources?.find((s) => s.key === key);
                                if (!src) return <td key={pi} className="text-right py-2 px-2 text-gray-300">—</td>;
                                const val = metric === "revenue" ? src.revenue : metric === "orders" ? src.orders : src.aov;
                                const totalForShare = metric === "orders" ? p.summary.orders : p.summary.revenue;
                                const shareBase = metric === "orders" ? src.orders : src.revenue;
                                const share = metric !== "aov" && totalForShare > 0 ? (shareBase / totalForShare) * 100 : null;
                                // Δ vs the next (older) period, same channel
                                const nextSrc = pi < data.periods.length - 1 ? data.periods[pi + 1].sources?.find((s) => s.key === key) : undefined;
                                const nextVal = nextSrc ? (metric === "revenue" ? nextSrc.revenue : metric === "orders" ? nextSrc.orders : nextSrc.aov) : null;
                                const change = nextVal !== null && nextVal !== undefined ? pctChange(val, nextVal) : null;
                                return (
                                  <td key={pi} className="text-right py-2 px-2 tabular-nums whitespace-nowrap">
                                    <span className="text-gray-700">
                                      {val === 0 ? <span className="text-gray-300">—</span> : metric === "revenue" || metric === "aov" ? fmtRM(val) : val.toLocaleString()}
                                    </span>
                                    {(share !== null && val !== 0) || change ? (
                                      <span className="ml-1.5 text-[10px]">
                                        {share !== null && val !== 0 && <span className="text-gray-400">{share.toFixed(0)}%</span>}
                                        {change && val !== 0 && <span className={`ml-1 ${change.color}`}>{change.label}</span>}
                                      </span>
                                    ) : null}
                                  </td>
                                );
                              })}
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            );
          })()}

          {/* Order Type Mix (dine-in / takeaway / delivery) */}
          <div className="bg-white rounded-xl border border-gray-200 p-4 overflow-hidden">
            <button
              onClick={() => setShowChannels(!showChannels)}
              className="flex items-center justify-between w-full mb-3"
            >
              <h2 className="text-sm font-semibold text-gray-900">Order Type Breakdown</h2>
              {showChannels ? <ChevronUp className="w-4 h-4 text-gray-400" /> : <ChevronDown className="w-4 h-4 text-gray-400" />}
            </button>
            {showChannels && (
              <div className="overflow-x-auto -mx-4 px-4">
                {/* Same orientation as every other table: rows = dimension,
                    columns = periods */}
                <table className="w-full text-xs" style={{ minWidth: Math.max(450, data.periods.length * 130 + 120) }}>
                  <thead>
                    <tr className="border-b border-gray-100">
                      <th className="text-left py-2 pr-3 font-medium text-gray-500 sticky left-0 bg-white z-10 whitespace-nowrap">Order Type</th>
                      {data.periods.map((p, i) => (
                        <th key={i} className="text-right py-2 px-2 font-medium whitespace-nowrap" style={{ color: PERIOD_COLORS[i % PERIOD_COLORS.length] }}>
                          {p.label}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {([
                      { key: "dineIn" as const, label: "Dine In", cls: "text-blue-600" },
                      { key: "takeaway" as const, label: "Takeaway", cls: "text-amber-600" },
                      { key: "delivery" as const, label: "Delivery", cls: "text-purple-600" },
                    ]).map((ch) => (
                      <tr key={ch.key} className="border-b border-gray-50">
                        <td className={`py-2 pr-3 font-medium sticky left-0 bg-white z-10 whitespace-nowrap ${ch.cls}`}>{ch.label}</td>
                        {data.periods.map((p, pi) => {
                          const c = p.channels[ch.key];
                          const val = metric === "revenue" ? c.revenue : metric === "orders" ? c.orders : c.orders > 0 ? Math.round((c.revenue / c.orders) * 100) / 100 : 0;
                          const totalForShare = metric === "orders" ? p.summary.orders : p.summary.revenue;
                          const shareBase = metric === "orders" ? c.orders : c.revenue;
                          const share = metric !== "aov" && totalForShare > 0 ? (shareBase / totalForShare) * 100 : null;
                          return (
                            <td key={pi} className="text-right py-2 px-2 text-gray-700 tabular-nums whitespace-nowrap">
                              {val === 0 ? (
                                <span className="text-gray-300">—</span>
                              ) : (
                                <>
                                  {metric === "revenue" || metric === "aov" ? fmtRM(val) : val.toLocaleString()}
                                  {share !== null && <span className="ml-1.5 text-[10px] text-gray-400">{share.toFixed(0)}%</span>}
                                </>
                              )}
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
                            {metric === "revenue" || metric === "aov" ? fmtRM(val) : val.toLocaleString()}
                          </td>
                        );
                      })}
                    </tr>
                  </tbody>
                </table>
              </div>
            )}
          </div>

          {/* Daily Breakdown with 7-day MA by Round */}
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
                    const roundLabels = p.rounds.map((r) => r.label);
                    return (
                      <div key={i}>
                        <div className="flex items-center gap-1.5 mb-2">
                          <div className="w-2 h-2 rounded-full shrink-0" style={{ backgroundColor: PERIOD_COLORS[ci] }} />
                          <span className="text-xs font-semibold" style={{ color: PERIOD_COLORS[ci] }}>{p.label}</span>
                        </div>
                        <div className="overflow-x-auto -mx-4 px-4">
                          <table className="w-full text-xs" style={{ minWidth: 600 + roundLabels.length * 80 }}>
                            <thead>
                              <tr className="border-b border-gray-100">
                                <th className="text-left py-1.5 pr-3 font-medium text-gray-500 sticky left-0 bg-white z-10">Date</th>
                                <th className="text-right py-1.5 px-2 font-medium text-gray-700">Total</th>
                                <th className="text-right py-1.5 px-2 font-medium text-blue-500">7d MA</th>
                                {roundLabels.map((rl) => (
                                  <th key={rl} className="text-right py-1.5 px-1.5 font-medium text-gray-400 whitespace-nowrap">{rl}</th>
                                ))}
                              </tr>
                            </thead>
                            <tbody>
                              {daily.map((d) => {
                                const val = metric === "revenue" ? d.revenue : d.orders;
                                const ma = metric === "revenue" ? d.maRevenue : d.maOrders;
                                const vsMa = ma !== null && ma > 0 ? pctChange(val, ma) : null;
                                return (
                                  <tr key={d.date} className="border-b border-gray-50">
                                    <td className="py-1.5 pr-3 font-medium text-gray-700 sticky left-0 bg-white z-10 whitespace-nowrap">
                                      {d.label}
                                      {vsMa && <span className={`ml-1.5 text-[10px] ${vsMa.color}`}>{vsMa.label}</span>}
                                    </td>
                                    <td className="text-right py-1.5 px-2 text-gray-700 tabular-nums font-medium">
                                      {metric === "revenue" ? fmtRM(val) : val}
                                    </td>
                                    <td className="text-right py-1.5 px-2 text-blue-600 tabular-nums">
                                      {ma !== null ? (metric === "revenue" ? fmtRM(ma) : Math.round(ma as number)) : <span className="text-gray-300">—</span>}
                                    </td>
                                    {d.roundMAs.map((rm) => {
                                      const rv = metric === "revenue" ? rm.value : 0;
                                      const rma = rm.ma;
                                      const aboveMA = rma !== null && rma > 0 && rv > rma;
                                      const belowMA = rma !== null && rma > 0 && rv < rma * 0.85;
                                      return (
                                        <td key={rm.key} className={`text-right py-1.5 px-1.5 tabular-nums whitespace-nowrap ${belowMA ? "text-red-500" : aboveMA ? "text-green-600" : "text-gray-500"}`}>
                                          {metric === "revenue" ? fmtRM(rv) : rm.value}
                                        </td>
                                      );
                                    })}
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
        </div>
      )}
    </div>
  );
}
