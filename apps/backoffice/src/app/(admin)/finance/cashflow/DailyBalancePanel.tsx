"use client";

import { useMemo, useState } from "react";
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ReferenceDot, ResponsiveContainer,
} from "recharts";
import { Wallet, TrendingDown, TrendingUp } from "lucide-react";

// Daily bank-balance hero for the Cashflow page. Reads the reconstructed
// daily-balance series (consolidated + per-account + forward projection) and
// offers two views, the bank-balance analogue of Sales Compare:
//   • Timeline  — continuous end-of-day balance over a window, with the
//                 forward projection bridged on and the lowest point marked.
//   • Compare   — overlay calendar periods (months or weeks) aligned by
//                 day-index, so you can eyeball this month's cash curve vs
//                 last month's.
// All filtering is client-side over the 12-month series the API already sends.

export type DailyBalance = {
  asOf: string | null;
  accounts: string[];
  consolidated: { date: string; balance: number }[];
  perAccount: { account: string; points: { date: string; balance: number }[] }[];
  projected: { date: string; balance: number }[];
  minPoint: { date: string; balance: number } | null;
};

const PALETTE = ["#C2452D", "#3B82F6", "#10B981", "#F59E0B", "#8B5CF6", "#EC4899", "#06B6D4", "#84CC16"];
const fmtRM = (n: number) => `RM ${n.toLocaleString("en-MY", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const fmtRMk = (n: number) => (Math.abs(n) >= 1000 ? `${(n / 1000).toFixed(0)}K` : `${n}`);
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const DOW = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

function fmtDay(d: string) {
  const dt = new Date(d + "T12:00:00+08:00");
  return `${dt.getDate()} ${MONTHS[dt.getMonth()]}`;
}
function todayMyt() {
  return new Date(Date.now() + 8 * 3600_000).toISOString().slice(0, 10);
}
function addDays(d: string, n: number) {
  const dt = new Date(d + "T12:00:00+08:00");
  dt.setDate(dt.getDate() + n);
  return dt.toISOString().slice(0, 10);
}
// Monday-based weekday index 0..6.
function dowIndex(d: string) {
  const day = new Date(d + "T12:00:00+08:00").getDay();
  return day === 0 ? 6 : day - 1;
}

type Mode = "timeline" | "compare";
type Source = "combined" | "each" | string; // "each" = per-account lines
type CompareKey = "mom" | "m3" | "wow" | "w4";

const COMPARES: { key: CompareKey; label: string; unit: "month" | "week"; count: number }[] = [
  { key: "mom", label: "Month vs last", unit: "month", count: 2 },
  { key: "m3", label: "Last 3 months", unit: "month", count: 3 },
  { key: "wow", label: "Week vs last", unit: "week", count: 2 },
  { key: "w4", label: "Last 4 weeks", unit: "week", count: 4 },
];

// Account and period are CONTROLLED by the page's single control bar, so the
// chart, the KPIs and the table all describe the same slice of money. Only
// genuinely chart-shaped options (view mode, per-account overlay, projection)
// stay local — they have no table equivalent.
export default function DailyBalancePanel({
  db,
  account,
  startDate,
  endDate,
}: {
  db: DailyBalance;
  account: string;   // "" = all accounts combined
  startDate: string; // "" = from the beginning
  endDate: string;   // "" = up to the latest point
}) {
  const [mode, setMode] = useState<Mode>("timeline");
  const [splitByAccount, setSplitByAccount] = useState(false);
  const [compareKey, setCompareKey] = useState<CompareKey>("mom");
  const [showProjection, setShowProjection] = useState(true);

  // Overlay-by-account only makes sense on the timeline with no single account
  // already selected; otherwise fall back to whatever the control bar says.
  const source: Source =
    splitByAccount && !account && mode === "timeline" ? "each" : account || "combined";

  const hasData = db.consolidated.length > 0 || db.perAccount.some((a) => a.points.length > 0);

  // The single active series for combined / single-account selections.
  const activeSeries = useMemo<{ date: string; balance: number }[]>(() => {
    if (source === "combined" || source === "each") return db.consolidated;
    return db.perAccount.find((a) => a.account === source)?.points ?? [];
  }, [db, source]);

  // ── Timeline rows ────────────────────────────────────────────────────────
  const timeline = useMemo(() => {
    // Window comes from the page's control bar, as a real date range, so the
    // chart shows exactly the slice the KPIs and table are describing.
    const start = startDate || "0000-00-00";
    const end = endDate || "9999-12-31";

    if (source === "each") {
      const byDate = new Map<string, Record<string, number | string>>();
      for (const acc of db.perAccount) {
        for (const p of acc.points) {
          if (p.date < start || p.date > end) continue;
          const row = byDate.get(p.date) ?? { date: p.date };
          row[acc.account] = p.balance;
          byDate.set(p.date, row);
        }
      }
      const rows = [...byDate.values()].sort((a, b) => String(a.date).localeCompare(String(b.date)));
      const series = db.accounts.map((a, i) => ({ key: a, name: a, color: PALETTE[i % PALETTE.length], dashed: false }));
      return { rows, series, projectedMin: null as null };
    }

    // Combined or single account → one "actual" line, optional projection.
    const byDate = new Map<string, { date: string; actual: number | null; projected: number | null }>();
    for (const p of activeSeries) {
      if (p.date < start || p.date > end) continue;
      byDate.set(p.date, { date: p.date, actual: p.balance, projected: null });
    }
    const series = [{ key: "actual", name: source === "combined" ? "Actual" : source, color: "#C2452D", dashed: false }];
    // Projection only meaningful for the combined position.
    if (showProjection && source === "combined" && activeSeries.length && db.projected.length) {
      const lastActual = activeSeries[activeSeries.length - 1];
      byDate.set(lastActual.date, { date: lastActual.date, actual: lastActual.balance, projected: lastActual.balance });
      for (const p of db.projected) {
        const row = byDate.get(p.date) ?? { date: p.date, actual: null, projected: null };
        row.projected = p.balance;
        byDate.set(p.date, row);
      }
      series.push({ key: "projected", name: "Projected", color: "#9CA3AF", dashed: true });
    }
    const rows = [...byDate.values()].sort((a, b) => a.date.localeCompare(b.date));
    return { rows, series, projectedMin: null };
  }, [db, source, activeSeries, startDate, endDate, showProjection]);

  // ── Compare rows (period overlay aligned by day-index) ───────────────────
  const compare = useMemo(() => {
    // Compare needs a single base series; "each" falls back to combined.
    const series = source === "each" || source === "combined"
      ? db.consolidated
      : (db.perAccount.find((a) => a.account === source)?.points ?? []);
    const cfg = COMPARES.find((c) => c.key === compareKey)!;
    const today = todayMyt();
    const byDate = new Map(series.map((p) => [p.date, p.balance]));

    // Build the period buckets (most recent first), each a label + its date range.
    type Period = { label: string; color: string; from: string; to: string };
    const periods: Period[] = [];
    if (cfg.unit === "month") {
      const now = new Date(today + "T12:00:00+08:00");
      for (let i = 0; i < cfg.count; i++) {
        const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
        const from = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-01`;
        const last = new Date(d.getFullYear(), d.getMonth() + 1, 0);
        const to = `${last.getFullYear()}-${String(last.getMonth() + 1).padStart(2, "0")}-${String(last.getDate()).padStart(2, "0")}`;
        periods.push({ label: `${MONTHS[d.getMonth()]} ${d.getFullYear()}`, color: PALETTE[i % PALETTE.length], from, to });
      }
    } else {
      // Weeks (Mon–Sun).
      let monday = today;
      while (dowIndex(monday) !== 0) monday = addDays(monday, -1);
      for (let i = 0; i < cfg.count; i++) {
        const from = addDays(monday, -7 * i);
        const to = addDays(from, 6);
        periods.push({ label: `${fmtDay(from)}`, color: PALETTE[i % PALETTE.length], from, to });
      }
    }

    const axisLen = cfg.unit === "month" ? 31 : 7;
    const rows: Record<string, number | string | null>[] = [];
    for (let idx = 0; idx < axisLen; idx++) {
      const row: Record<string, number | string | null> = { idx: cfg.unit === "month" ? idx + 1 : DOW[idx] };
      for (const p of periods) {
        const date = cfg.unit === "month"
          ? `${p.from.slice(0, 8)}${String(idx + 1).padStart(2, "0")}`
          : addDays(p.from, idx);
        const inRange = date >= p.from && date <= p.to && date <= today;
        row[p.label] = inRange && byDate.has(date) ? byDate.get(date)! : null;
      }
      rows.push(row);
    }
    return { rows, periods };
  }, [db, source, compareKey]);

  // ── Summary chips (from the active series, within the timeline window) ────
  const stats = useMemo(() => {
    const start = startDate || "0000-00-00";
    const end = endDate || "9999-12-31";
    const pts = activeSeries.filter((p) => p.date >= start && p.date <= end);
    if (pts.length === 0) return null;
    const latest = pts[pts.length - 1];
    const first = pts[0];
    let min = pts[0];
    for (const p of pts) if (p.balance < min.balance) min = p;
    const change = latest.balance - first.balance;
    return { latest, min, change };
  }, [activeSeries, startDate, endDate]);

  const segBtn = (active: boolean) =>
    `rounded-md px-2.5 py-1 text-xs font-medium transition-colors ${active ? "bg-terracotta text-white" : "text-gray-600 hover:bg-gray-50"}`;

  return (
    <div className="rounded-xl border border-gray-200 bg-white p-4">
      {/* Title + mode */}
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-terracotta/10">
            <Wallet className="h-4 w-4 text-terracotta" />
          </div>
          <div>
            <h3 className="text-sm font-semibold text-gray-900">Daily bank balance</h3>
            <p className="text-[11px] text-gray-400">
              Reconstructed end-of-day cash position{db.asOf ? `, actuals through ${fmtDay(db.asOf)}` : ""}. Follows the account and period above; bank-account level, so the outlet filter doesn&apos;t apply.
            </p>
          </div>
        </div>
        <div className="flex rounded-lg border border-gray-200 bg-white p-0.5">
          <button onClick={() => setMode("timeline")} className={segBtn(mode === "timeline")}>Timeline</button>
          <button onClick={() => setMode("compare")} className={segBtn(mode === "compare")}>Compare</button>
        </div>
      </div>

      {/* Chart-only view options. Account and period live in the page's control
          bar so every panel on the page reads the same slice. */}
      <div className="mb-3 flex flex-wrap items-center gap-2">
        {mode === "timeline" ? (
          <>
            {!account && (
              <button onClick={() => setSplitByAccount((s) => !s)} className={segBtn(splitByAccount)}>
                By account
              </button>
            )}
            {source === "combined" && (
              <label className="flex items-center gap-1.5 text-xs text-gray-600">
                <input type="checkbox" checked={showProjection} onChange={(e) => setShowProjection(e.target.checked)} className="rounded border-gray-300 text-terracotta focus:ring-terracotta" />
                Projection
              </label>
            )}
          </>
        ) : (
          <div className="flex flex-wrap rounded-lg border border-gray-200 bg-white p-0.5">
            {COMPARES.map((c) => (
              <button key={c.key} onClick={() => setCompareKey(c.key)} className={segBtn(compareKey === c.key)}>{c.label}</button>
            ))}
          </div>
        )}
      </div>

      {/* Summary chips */}
      {stats && (
        <div className="mb-3 flex flex-wrap gap-x-5 gap-y-1 text-[11px] text-gray-500">
          <span>Latest: <span className="font-mono font-semibold text-gray-800">{fmtRM(stats.latest.balance)}</span></span>
          <span>
            Lowest: <span className={`font-mono font-semibold ${stats.min.balance < 10000 ? "text-amber-600" : "text-gray-800"}`}>{fmtRM(stats.min.balance)}</span>{" "}
            <span className="text-gray-400">({fmtDay(stats.min.date)})</span>
          </span>
          <span className="flex items-center gap-1">
            Change:
            <span className={`font-mono font-semibold ${stats.change >= 0 ? "text-green-600" : "text-red-600"}`}>
              {stats.change >= 0 ? <TrendingUp className="inline h-3 w-3" /> : <TrendingDown className="inline h-3 w-3" />} {stats.change >= 0 ? "+" : ""}{fmtRM(stats.change)}
            </span>
          </span>
        </div>
      )}

      {!hasData ? (
        <div className="py-12 text-center text-sm text-gray-400">No bank-statement data yet.</div>
      ) : mode === "timeline" ? (
        <ResponsiveContainer width="100%" height={320}>
          <LineChart data={timeline.rows} margin={{ top: 5, right: 12, left: 4, bottom: 0 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
            <XAxis dataKey="date" tickFormatter={(d) => fmtDay(String(d))} tick={{ fontSize: 11 }} tickLine={false} axisLine={false} interval="preserveStartEnd" minTickGap={36} />
            <YAxis tick={{ fontSize: 11 }} tickLine={false} axisLine={false} width={52} tickFormatter={(v) => fmtRMk(Number(v))} />
            <Tooltip labelFormatter={(l) => fmtDay(String(l))} formatter={(v, n) => [v == null ? "—" : fmtRM(v as number), n]} contentStyle={{ borderRadius: 10, border: "1px solid #e5e7eb", fontSize: 12 }} />
            <Legend wrapperStyle={{ fontSize: 12, paddingTop: 8 }} />
            {timeline.series.map((s) => (
              <Line key={s.key} type="monotone" dataKey={s.key} name={s.name} stroke={s.color} strokeWidth={2} strokeDasharray={s.dashed ? "5 4" : undefined} dot={false} connectNulls />
            ))}
            {source === "combined" && db.minPoint && (
              <ReferenceDot x={db.minPoint.date} y={db.minPoint.balance} r={4} fill={db.minPoint.balance < 0 ? "#dc2626" : "#F59E0B"} stroke="white" strokeWidth={1.5} />
            )}
          </LineChart>
        </ResponsiveContainer>
      ) : (
        <ResponsiveContainer width="100%" height={320}>
          <LineChart data={compare.rows} margin={{ top: 5, right: 12, left: 4, bottom: 0 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
            <XAxis dataKey="idx" tick={{ fontSize: 11 }} tickLine={false} axisLine={false} minTickGap={12} />
            <YAxis tick={{ fontSize: 11 }} tickLine={false} axisLine={false} width={52} tickFormatter={(v) => fmtRMk(Number(v))} />
            <Tooltip formatter={(v, n) => [v == null ? "—" : fmtRM(v as number), n]} contentStyle={{ borderRadius: 10, border: "1px solid #e5e7eb", fontSize: 12 }} />
            <Legend wrapperStyle={{ fontSize: 12, paddingTop: 8 }} />
            {compare.periods.map((p) => (
              <Line key={p.label} type="monotone" dataKey={p.label} name={p.label} stroke={p.color} strokeWidth={2} dot={false} connectNulls />
            ))}
          </LineChart>
        </ResponsiveContainer>
      )}
    </div>
  );
}
