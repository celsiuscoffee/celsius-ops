"use client";

import { useState, useEffect, useCallback } from "react";
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
} from "recharts";
import { Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";

// ─── Types (subset of the /api/sales/compare response) ───────────────────
type Hourly = { hour: number; revenue: number; orders: number };
type Daily = { date: string; revenue: number; orders: number };
type Period = { from: string; to: string; label: string; hourly: Hourly[]; dailyTotals: Daily[] };
type CompareResp = { periods: Period[]; warnings?: string[] };

type Mode = "day" | "week" | "month";
type Metric = "revenue" | "orders";

// ─── MYT date helpers ────────────────────────────────────────────────────
function mytToday(): string {
  return new Date(Date.now() + 8 * 60 * 60 * 1000).toISOString().split("T")[0];
}
function mytHourNow(): number {
  return new Date(Date.now() + 8 * 60 * 60 * 1000).getUTCHours();
}
function shiftDate(dateStr: string, days: number): string {
  const d = new Date(dateStr + "T12:00:00+08:00");
  d.setDate(d.getDate() + days);
  return d.toISOString().split("T")[0];
}
function dayOfWeek(dateStr: string): number {
  return new Date(dateStr + "T12:00:00+08:00").getDay(); // 0=Sun … 6=Sat
}
function monthStart(dateStr: string): string {
  const d = new Date(dateStr + "T12:00:00+08:00");
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-01`;
}
function monthEnd(dateStr: string): string {
  const d = new Date(dateStr + "T12:00:00+08:00");
  const last = new Date(d.getFullYear(), d.getMonth() + 1, 0);
  return `${last.getFullYear()}-${String(last.getMonth() + 1).padStart(2, "0")}-${String(last.getDate()).padStart(2, "0")}`;
}

const WEEKDAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const MONTHS_FULL = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

function weekdayLabel(dateStr: string): string {
  return WEEKDAYS[dayOfWeek(dateStr)];
}
function dayMonthLabel(dateStr: string): string {
  const d = new Date(dateStr + "T12:00:00+08:00");
  return `${String(d.getDate()).padStart(2, "0")} ${MONTHS_FULL[d.getMonth()]}`;
}
function fmtRM(v: number): string {
  return `RM ${v.toLocaleString("en-MY", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}
function fmtAxis(v: number): string {
  return Math.abs(v) >= 1000 ? `${(v / 1000).toFixed(0)}K` : `${v}`;
}
function round2(v: number): number {
  return Math.round(v * 100) / 100;
}

const CUR_COLOR = "#F97316"; // orange — current period
const PREV_COLOR = "#3B82F6"; // blue — previous period

const MODE_META: Record<Mode, { cur: string; prev: string }> = {
  day: { cur: "Today", prev: "Yesterday" },
  week: { cur: "This Week", prev: "Last Week" },
  month: { cur: "This Month", prev: "Last Month" },
};

/** The current + previous calendar period (from:to) for each mode. */
function periodsForMode(mode: Mode): { cur: [string, string]; prev: [string, string] } {
  const today = mytToday();
  if (mode === "day") {
    const y = shiftDate(today, -1);
    return { cur: [today, today], prev: [y, y] };
  }
  if (mode === "week") {
    const sun = shiftDate(today, -dayOfWeek(today)); // week starts Sunday
    return { cur: [sun, shiftDate(sun, 6)], prev: [shiftDate(sun, -7), shiftDate(sun, -1)] };
  }
  // month
  const mStart = monthStart(today);
  const lastEnd = shiftDate(mStart, -1);
  return { cur: [mStart, monthEnd(today)], prev: [monthStart(lastEnd), lastEnd] };
}

export function AccumulativeChart({ outletId }: { outletId: string }) {
  const [mode, setMode] = useState<Mode>("day");
  const [metric, setMetric] = useState<Metric>("revenue");
  const [data, setData] = useState<CompareResp | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async (m: Mode, outlet: string) => {
    setLoading(true);
    setError(null);
    try {
      const { cur, prev } = periodsForMode(m);
      const periods = `${cur[0]}:${cur[1]},${prev[0]}:${prev[1]}`;
      let url = `/api/sales/compare?periods=${periods}`;
      if (outlet && outlet !== "all") url += `&outletId=${outlet}`;
      const res = await fetch(url, { credentials: "include" });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error || `HTTP ${res.status}`);
      }
      setData(await res.json());
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(mode, outletId); }, [mode, outletId, load]);

  const meta = MODE_META[mode];
  const pick = (o: { revenue: number; orders: number }) => (metric === "revenue" ? o.revenue : o.orders);

  // Build the two cumulative ("running total") series. The current line stops
  // at the live point (current hour for Day, today for Week/Month); the
  // previous line spans its full period.
  let chartData: { label: string; current: number | null; previous: number | null }[] = [];
  if (data && data.periods.length >= 2) {
    const today = mytToday();
    const cur = data.periods[0];
    const prev = data.periods[1];
    if (mode === "day") {
      const nowHour = mytHourNow();
      let cc = 0, pc = 0;
      chartData = Array.from({ length: 24 }, (_, h) => {
        pc += pick(prev.hourly[h] ?? { revenue: 0, orders: 0 });
        let current: number | null = null;
        if (h <= nowHour) { cc += pick(cur.hourly[h] ?? { revenue: 0, orders: 0 }); current = round2(cc); }
        return { label: `${String(h).padStart(2, "0")}:00`, current, previous: round2(pc) };
      });
    } else {
      // Week/Month: cumulative by day, aligned by day index (weekday / day-of-month).
      let cc = 0, pc = 0;
      chartData = cur.dailyTotals.map((cd, i) => {
        const pd = prev.dailyTotals[i];
        if (pd) pc += pick(pd);
        let current: number | null = null;
        if (cd.date <= today) { cc += pick(cd); current = round2(cc); }
        return {
          label: mode === "week" ? weekdayLabel(cd.date) : dayMonthLabel(cd.date),
          current,
          previous: pd ? round2(pc) : null,
        };
      });
    }
  }

  const toggle = (active: boolean) =>
    cn(
      "px-2.5 py-1 rounded-md text-xs font-medium capitalize transition-colors",
      active ? "bg-[#C2452D] text-white" : "text-gray-500 hover:text-gray-700",
    );

  return (
    <div className="rounded-xl border border-gray-200 bg-white shadow-sm p-4 sm:p-5">
      <div className="mb-4 flex items-start justify-between gap-3 flex-wrap">
        <div className="min-w-0">
          <h2 className="text-sm font-semibold text-gray-900">
            Total Accumulative {metric === "revenue" ? "Sales" : "Orders"}
            {metric === "revenue" && <span className="font-normal text-gray-400"> (RM)</span>}
          </h2>
          <p className="mt-0.5 text-xs text-gray-500">{meta.cur} vs {meta.prev} · running total</p>
        </div>
        <div className="flex items-center gap-2">
          <div className="flex gap-1 rounded-lg border border-gray-200 bg-gray-50 p-1">
            {(["day", "week", "month"] as Mode[]).map((mt) => (
              <button key={mt} onClick={() => setMode(mt)} className={toggle(mode === mt)}>{mt}</button>
            ))}
          </div>
          <div className="flex gap-1 rounded-lg border border-gray-200 bg-gray-50 p-1">
            {(["revenue", "orders"] as Metric[]).map((mt) => (
              <button key={mt} onClick={() => setMetric(mt)} className={toggle(metric === mt)}>{mt}</button>
            ))}
          </div>
        </div>
      </div>

      {loading ? (
        <div className="flex items-center justify-center" style={{ height: 300 }}>
          <Loader2 className="h-6 w-6 animate-spin text-[#C2452D]" />
        </div>
      ) : error ? (
        <div className="flex items-center justify-center text-sm text-red-500" style={{ height: 300 }}>{error}</div>
      ) : (
        <ResponsiveContainer width="100%" height={300}>
          <LineChart data={chartData} margin={{ top: 5, right: 12, left: -8, bottom: 0 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
            <XAxis
              dataKey="label"
              tick={{ fontSize: 11 }}
              tickLine={false}
              axisLine={false}
              interval="preserveStartEnd"
              minTickGap={mode === "month" ? 24 : 8}
            />
            <YAxis
              tick={{ fontSize: 11 }}
              tickLine={false}
              axisLine={false}
              width={46}
              tickFormatter={(v) => (metric === "revenue" ? fmtAxis(v as number) : `${v}`)}
            />
            <Tooltip
              formatter={(value, name) => [value == null ? "—" : metric === "revenue" ? fmtRM(value as number) : value, name]}
              contentStyle={{ borderRadius: 10, border: "1px solid #e5e7eb", fontSize: 12 }}
            />
            <Legend wrapperStyle={{ fontSize: 12, paddingTop: 8 }} />
            <Line type="monotone" dataKey="previous" name={meta.prev} stroke={PREV_COLOR} strokeWidth={2} dot={{ r: 3, strokeWidth: 1.5, fill: "#fff", stroke: PREV_COLOR }} connectNulls={false} />
            <Line type="monotone" dataKey="current" name={meta.cur} stroke={CUR_COLOR} strokeWidth={2.5} dot={{ r: 3, strokeWidth: 1.5, fill: "#fff", stroke: CUR_COLOR }} connectNulls={false} />
          </LineChart>
        </ResponsiveContainer>
      )}
    </div>
  );
}
