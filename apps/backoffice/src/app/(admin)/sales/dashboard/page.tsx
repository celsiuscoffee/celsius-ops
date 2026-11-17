"use client";

import { useState, useEffect, useCallback } from "react";
import {
  DollarSign,
  ShoppingCart,
  TrendingUp,
  Loader2,
  UtensilsCrossed,
  ShoppingBag,
  Truck,
  Sparkles,
  AlertTriangle,
  Lightbulb,
  Zap,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { useLatestRequest } from "@/lib/use-latest-request";
import { AccumulativeChart } from "./AccumulativeChart";
import { KeyNumber } from "@/components/ui/key-number";
import { DateRangePicker } from "@/components/date-range-picker";

// ─── Types ──────────────────────────────────────────────────────────────

type Period = "daily" | "yesterday" | "last7days" | "last30days" | "weekly" | "monthly" | "custom";

type OutletOption = { id: string; name: string };

type ChannelBreakdown = { revenue: number; orders: number };

type DayTarget = { revenue: number; orders: number; aov: number };

type DailyCell = {
  date: string;
  revenue: number;
  orders: number;
  aov: number;
  dineIn: ChannelBreakdown;
  takeaway: ChannelBreakdown;
  delivery: ChannelBreakdown;
  target: DayTarget;
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
  target: DayTarget;
};

type PreviousPeriod = {
  revenue: number;
  orders: number;
  aov: number;
  takeaway: ChannelBreakdown;
  delivery: ChannelBreakdown;
  pickupDeliveryRevenue: number;
  pickupDeliveryOrders: number;
  periodFrom: string;
  periodTo: string;
  // true when the previous period was capped to the same elapsed point (the
  // current period is still running) — deltas are a like-for-like to-now read.
  sameTime?: boolean;
};

type TargetsMeta = {
  lastUpdated: string | null;
  source: string;
  reasoning: string | null;
};

type DashboardData = {
  period: { from: string; to: string; type: string };
  dates: string[];
  summary: { revenue: number; orders: number; aov: number; ownSalesRevenue?: number; ownSalesOrders?: number };
  previous: PreviousPeriod;
  rounds: RoundData[];
  outsideRounds: { revenue: number; orders: number };
  deliveryTarget: DayTarget;
  deliveryQR?: { revenue: number; orders: number };
  channelBreakdown?: Record<string, { count: number; revenue: number }>;
  availableOutlets: OutletOption[];
  targetsMeta?: TargetsMeta;
  warnings?: string[];
};

type Recommendation = {
  type: "opportunity" | "warning" | "insight" | "action";
  title: string;
  description: string;
  impact: "high" | "medium" | "low";
  category: string;
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
  { key: "last7days", label: "Last 7 days" },
  { key: "last30days", label: "Last 30 days" },
  { key: "weekly", label: "This week" },
  { key: "monthly", label: "This month" },
  { key: "custom", label: "Custom" },
];

/** Color for % of target */
function targetColor(pct: number): { bg: string; text: string; label: string } {
  if (pct >= 100) return { bg: "bg-ok-soft", text: "text-ok-text", label: "On Target" };
  if (pct >= 80) return { bg: "bg-warn-soft", text: "text-warn-text", label: "Near Target" };
  if (pct >= 50) return { bg: "bg-warn-soft", text: "text-warn-text", label: "Below Target" };
  return { bg: "bg-danger-soft", text: "text-danger-text", label: "Critical" };
}

/** % change between current and previous */
function pctChange(current: number, previous: number): { pct: number; label: string; color: string; diff: number; diffLabel: string } {
  const diff = current - previous;
  const diffAbs = Math.abs(diff);
  const fmtDiff = diffAbs >= 1000 ? `${(diffAbs / 1000).toFixed(1)}k` : diffAbs.toLocaleString("en-MY", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const diffLabel = diff > 0 ? `+RM ${fmtDiff}` : diff < 0 ? `-RM ${fmtDiff}` : "";
  if (current === 0 && previous === 0) return { pct: 0, label: "\u2014", color: "text-text-3", diff: 0, diffLabel: "" };
  if (previous === 0) return { pct: 0, label: "New", color: "text-ok-text", diff, diffLabel };
  if (current === 0) return { pct: -100, label: "-100%", color: "text-danger-text", diff, diffLabel };
  const pct = Math.round(((current - previous) / previous) * 100);
  if (pct > 0) return { pct, label: `+${pct}%`, color: "text-ok-text", diff, diffLabel };
  if (pct < 0) return { pct, label: `${pct}%`, color: "text-danger-text", diff, diffLabel };
  return { pct: 0, label: "0%", color: "text-text-3", diff: 0, diffLabel: "" };
}

/** Color for a cell value vs daily target */
function cellColor(val: number, target: number): string {
  if (val === 0) return "text-text-3";
  if (target <= 0) return "text-text-2";
  const pct = (val / target) * 100;
  if (pct >= 100) return "font-semibold text-ok-text";
  if (pct >= 80) return "text-warn-text";
  if (pct >= 50) return "text-warn-text";
  return "text-danger-text";
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

  // AI recommendations
  const [recommendations, setRecommendations] = useState<Recommendation[]>([]);
  const [aiLoading, setAiLoading] = useState(false);
  const [aiError, setAiError] = useState<string | null>(null);

  // AI targets recompute
  const [recomputingTargets, setRecomputingTargets] = useState(false);
  const [targetsRecomputeError, setTargetsRecomputeError] = useState<string | null>(null);
  const [showReasoning, setShowReasoning] = useState(false);

  const recomputeTargets = useCallback(async () => {
    setRecomputingTargets(true);
    setTargetsRecomputeError(null);
    try {
      const res = await fetch("/api/sales/targets/recompute", {
        method: "POST",
        credentials: "include",
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error || `HTTP ${res.status}`);
      }
      // Trigger dashboard reload to pick up new targets
      window.location.reload();
    } catch (err) {
      setTargetsRecomputeError(err instanceof Error ? err.message : "Failed to recompute");
      setRecomputingTargets(false);
    }
  }, []);

  const loadRecommendations = useCallback(async (outlet: string) => {
    setAiLoading(true);
    setAiError(null);
    try {
      let url = "/api/sales/recommendations";
      if (outlet !== "all") url += `?outletId=${outlet}`;
      const res = await fetch(url, { credentials: "include" });
      if (!res.ok) throw new Error("Failed to load");
      const body = await res.json();
      setRecommendations(body.recommendations || []);
    } catch {
      setAiError("Could not load AI recommendations");
    }
    setAiLoading(false);
  }, []);

  const beginRequest = useLatestRequest();
  const loadData = useCallback(
    async (p: Period, outlet: string, cFrom?: string, cTo?: string) => {
      // Stale-response guard: "All Outlets" is much slower than a single outlet,
      // so switching All→one could let the old All response land last and
      // overwrite the filtered data. Only the latest request writes state.
      const { signal, isCurrent } = beginRequest();
      setLoading(true);
      setError(null);
      try {
        let url = `/api/sales/dashboard?period=${p}`;
        if (outlet !== "all") url += `&outletId=${outlet}`;
        if (p === "custom" && cFrom && cTo) {
          url += `&from=${cFrom}&to=${cTo}`;
        }
        const res = await fetch(url, { credentials: "include", signal });
        if (!isCurrent()) return;
        if (!res.ok) {
          const body = await res.json().catch(() => ({}));
          throw new Error(body.error || `HTTP ${res.status}`);
        }
        setData(await res.json());
      } catch (err) {
        if (!isCurrent()) return;
        setError(err instanceof Error ? err.message : "Failed to load");
      }
      if (isCurrent()) setLoading(false);
    },
    [beginRequest],
  );

  useEffect(() => {
    if (period === "custom") {
      loadData(period, outletId, customFrom, customTo);
    } else {
      loadData(period, outletId);
    }
  }, [period, outletId, customFrom, customTo, loadData]);

  // Auto-load AI insights when outlet changes (debounced mount)
  useEffect(() => {
    loadRecommendations(outletId);
  }, [outletId, loadRecommendations]);

  // ─── Render ─────────────────────────────────────────────────────────

  const periodText = data ? (data.period.from === data.period.to ? formatDate(data.period.from) : `${formatDate(data.period.from)} – ${formatDate(data.period.to)}`) : "";
  const ctl = "h-10 rounded-ctl border border-line bg-surface px-3 text-sm text-text focus:border-ink focus:outline-none";

  return (
    <div className="w-full max-w-[1240px] px-4 pt-6 pb-10 md:px-8">
      <div className="mb-5 flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
        <div>
          <h1 className="text-2xl font-semibold leading-[30px] tracking-[-0.01em] text-text">Sales</h1>
          <p className="mt-0.5 text-sm text-text-2">How much we sold{periodText ? `, ${periodText}` : ""}, against the period before and against each round&apos;s target.</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {data?.availableOutlets && data.availableOutlets.length > 1 && (
            <select value={outletId} onChange={(e) => setOutletId(e.target.value)} className={ctl} aria-label="Outlet">
              <option value="all">All outlets</option>
              {data.availableOutlets.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}
            </select>
          )}
          <select value={period} onChange={(e) => setPeriod(e.target.value as Period)} className={ctl} aria-label="Period">
            {PERIOD_OPTIONS.map((p) => <option key={p.key} value={p.key}>{p.label}</option>)}
          </select>
          {period === "custom" && (
            <DateRangePicker start={customFrom} end={customTo} onChange={(a, b) => { setCustomFrom(a); setCustomTo(b); }} />
          )}
        </div>
      </div>

      {/* Loading / Error */}
      {loading && (
        <div className="flex items-center justify-center h-64">
          <div className="flex flex-col items-center gap-3">
            <Loader2 className="h-8 w-8 animate-spin text-brand-text" />
            <p className="text-sm text-text-2">Loading sales data...</p>
          </div>
        </div>
      )}

      {error && !loading && (
        <div className="rounded-xl border border-line bg-danger-soft p-6 text-center">
          <p className="text-sm text-danger-text">{error}</p>
        </div>
      )}

      {data && !loading && (
        <div className="flex flex-col gap-6">
          {/* Warnings from StoreHub API */}
          {data.warnings && data.warnings.length > 0 && (
            <div className="rounded-xl border border-line bg-warn-soft p-4">
              <div className="flex items-center gap-2 mb-1">
                <AlertTriangle className="h-4 w-4 text-warn-text" />
                <p className="text-sm font-medium text-warn-text">Some sales data could not be read</p>
              </div>
              {data.warnings.map((w, i) => (
                <p key={i} className="text-xs text-warn-text ml-6">{w}</p>
              ))}
            </div>
          )}
          {/* ─── Key numbers, each against the period before ─── */}
          {(() => {
            const prev = data.previous;
            const revChange = pctChange(data.summary.revenue, prev.revenue);
            const ordChange = pctChange(data.summary.orders, prev.orders);
            const aovChange = pctChange(data.summary.aov, prev.aov);
            // For an in-progress period the previous one is capped to the same
            // elapsed point, so the delta is a like-for-like to-now read.
            const vsLabel = prev.sameTime ? "vs same time last period" : "vs last period";
            const targeted = data.rounds.filter((r) => r.totals.pctOfTarget > 0);
            const behind = targeted.filter((r) => r.totals.pctOfTarget < 80);
            const Delta = ({ c }: { c: ReturnType<typeof pctChange> }) => <b className={cn("font-semibold", c.color)}>{c.label}</b>;
            return (
              <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
                <KeyNumber label="Sales" value={`RM ${data.summary.revenue.toLocaleString("en-MY", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`}
                  note={<><Delta c={revChange} /> {vsLabel}{data.deliveryQR && data.deliveryQR.orders > 0 ? <>; RM {data.deliveryQR.revenue.toLocaleString("en-MY", { maximumFractionDigits: 0 })} delivery and QR</> : null}</>} />
                <KeyNumber label="Orders" value={data.summary.orders.toLocaleString("en-MY")} note={<><Delta c={ordChange} /> {vsLabel}</>} />
                <KeyNumber label="Average order" value={`RM ${data.summary.aov.toFixed(2)}`} note={<><Delta c={aovChange} /> {vsLabel}</>} />
                <KeyNumber label="Rounds behind target" value={targeted.length ? `${behind.length} of ${targeted.length}` : "–"} word tone={behind.length > 0 ? "warn" : undefined}
                  note={behind.length ? <>under 80%: {behind.map((r) => r.label).join(", ")}</> : targeted.length ? "every round at 80% or more" : "no targets set"} />
              </div>
            );
          })()}

          {/* ─── Accumulative Sales — granularity follows the Period filter ─── */}
          <AccumulativeChart outletId={outletId} period={period} customFrom={customFrom} customTo={customTo} />

          {/* ─── AI Sales Targets (progressive) ─── */}
          {(() => {
            const tm = data.targetsMeta;
            const isDefault = !tm || tm.source === "default" || !tm.lastUpdated;
            let daysAgo: number | null = null;
            if (tm?.lastUpdated) {
              const then = new Date(tm.lastUpdated).getTime();
              daysAgo = Math.max(0, Math.floor((Date.now() - then) / 86_400_000));
            }
            const stale = daysAgo !== null && daysAgo >= 14;
            return (
              <div className="rounded-xl border border-line bg-surface shadow-sm p-4">
                <div className="flex items-start justify-between gap-3 flex-wrap">
                  <div className="flex items-start gap-2.5 min-w-0">
                    <div className={cn(
                      "flex h-8 w-8 shrink-0 items-center justify-center rounded-full",
                      isDefault ? "bg-sunken" : stale ? "bg-warn-soft" : "bg-ok-soft",
                    )}>
                      <TrendingUp className={cn(
                        "h-4 w-4",
                        isDefault ? "text-text-2" : stale ? "text-warn-text" : "text-ok-text",
                      )} />
                    </div>
                    <div className="min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <p className="text-sm font-semibold text-text">AI Sales Targets</p>
                        <span className={cn(
                          "text-[10px] px-1.5 py-0.5 rounded font-medium",
                          isDefault ? "bg-sunken text-text-2" : stale ? "bg-warn-soft text-warn-text" : "bg-ok-soft text-ok-text",
                        )}>
                          {isDefault ? "Using defaults" : stale ? `Stale · ${daysAgo}d ago` : daysAgo === 0 ? "Updated today" : `Updated ${daysAgo}d ago`}
                        </span>
                      </div>
                      <p className="text-[11px] text-text-2 mt-0.5">
                        {isDefault
                          ? "No AI-set targets yet. Click Recompute to have AI set progressive targets from your trailing 28-day performance."
                          : "Targets auto-scale from trailing actuals. Only move up — never down."}
                      </p>
                      {tm?.reasoning && showReasoning && (
                        <p className="text-[11px] text-text-2 mt-2 p-2 bg-sunken rounded border border-line leading-relaxed">
                          {tm.reasoning.split(" | ")[0]}
                        </p>
                      )}
                      {targetsRecomputeError && (
                        <p className="text-[11px] text-danger-text mt-1">{targetsRecomputeError}</p>
                      )}
                    </div>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    {tm?.reasoning && (
                      <button
                        onClick={() => setShowReasoning((s) => !s)}
                        className="text-[11px] text-text-2 hover:text-text-2 underline underline-offset-2"
                      >
                        {showReasoning ? "Hide reasoning" : "Why"}
                      </button>
                    )}
                    <button
                      onClick={recomputeTargets}
                      disabled={recomputingTargets}
                      className={cn(
                        "flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-medium transition-colors",
                        recomputingTargets
                          ? "bg-sunken text-text-3 cursor-not-allowed"
                          : "bg-surface border border-line text-text-2 hover:bg-sunken",
                      )}
                    >
                      {recomputingTargets ? (
                        <>
                          <Loader2 className="h-3.5 w-3.5 animate-spin" />
                          Recomputing...
                        </>
                      ) : (
                        <>
                          <Sparkles className="h-3.5 w-3.5" />
                          {isDefault ? "Set Targets" : "Recompute"}
                        </>
                      )}
                    </button>
                  </div>
                </div>
              </div>
            );
          })()}

          {/* ─── AI Recommendations (moved to top) ─── */}
          <div className="rounded-xl border border-line bg-surface shadow-sm p-5">
            <div className="flex items-center justify-between mb-4">
              <div className="flex items-center gap-2">
                <Sparkles className="h-5 w-5 text-brand-text" />
                <h3 className="text-sm font-semibold text-text">AI Sales Coach</h3>
                <span className="text-[10px] bg-brand-soft text-brand-text px-1.5 py-0.5 rounded font-medium">
                  Beta
                </span>
              </div>
              <button
                onClick={() => loadRecommendations(outletId)}
                disabled={aiLoading}
                className={cn(
                  "flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-medium transition-colors",
                  aiLoading
                    ? "bg-sunken text-text-3 cursor-not-allowed"
                    : "bg-surface text-text-2 border border-line hover:bg-sunken",
                )}
              >
                {aiLoading ? (
                  <>
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    Analyzing...
                  </>
                ) : (
                  <>
                    <Sparkles className="h-3.5 w-3.5" />
                    Refresh
                  </>
                )}
              </button>
            </div>

            {aiError && (
              <p className="text-xs text-danger-text mb-3">{aiError}</p>
            )}

            {aiLoading && recommendations.length === 0 && (
              <div className="flex items-center justify-center py-8 text-text-3">
                <Loader2 className="h-5 w-5 animate-spin mr-2" />
                <span className="text-xs">Reading last 30 days of sales…</span>
              </div>
            )}

            {recommendations.length > 0 && (
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                {recommendations.map((rec, idx) => {
                  const iconMap: Record<string, React.ReactNode> = {
                    opportunity: <Sparkles className="h-4 w-4 text-ok-text" />,
                    warning: <AlertTriangle className="h-4 w-4 text-warn-text" />,
                    insight: <Lightbulb className="h-4 w-4 text-info-text" />,
                    action: <Zap className="h-4 w-4 text-info-text" />,
                  };
                  const borderMap: Record<string, string> = {
                    opportunity: "border-l-ok",
                    warning: "border-l-warn",
                    insight: "border-l-info",
                    action: "border-l-info",
                  };
                  const impactBadge: Record<string, string> = {
                    high: "bg-danger-soft text-danger-text",
                    medium: "bg-warn-soft text-warn-text",
                    low: "bg-sunken text-text-2",
                  };
                  return (
                    <div
                      key={idx}
                      className={cn(
                        "rounded-lg border border-line border-l-4 p-3",
                        borderMap[rec.type] || "border-l-line-2",
                      )}
                    >
                      <div className="flex items-start gap-2">
                        <div className="mt-0.5 shrink-0">
                          {iconMap[rec.type] || <Lightbulb className="h-4 w-4 text-text-3" />}
                        </div>
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2 mb-1">
                            <p className="text-xs font-semibold text-text truncate">{rec.title}</p>
                            <span className={cn("text-[10px] px-1.5 py-0.5 rounded font-medium shrink-0", impactBadge[rec.impact] || impactBadge.low)}>
                              {rec.impact}
                            </span>
                          </div>
                          <p className="text-[11px] text-text-2 leading-relaxed">{rec.description}</p>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          {/* ─── Metric Toggle ─── */}
          <div className="flex items-center gap-2">
            <span className="text-xs font-medium text-text-2 mr-1">View:</span>
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
                    ? "bg-ink text-on-ink"
                    : "bg-surface text-text-2 border border-line hover:bg-sunken",
                )}
              >
                <m.icon className="h-3.5 w-3.5" />
                {m.label}
              </button>
            ))}
          </div>

          {/* ─── Rounds Grid Table ─── */}
          <div className="rounded-xl border border-line bg-surface shadow-sm overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="bg-sunken border-b border-line">
                    <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider text-text-2 sticky left-0 bg-sunken z-10 min-w-[140px]">
                      Round
                    </th>
                    {data.dates.map((d) => (
                      <th
                        key={d}
                        className="px-3 py-3 text-center text-xs font-medium text-text-2 min-w-[90px]"
                      >
                        {data.dates.length === 1 ? formatDate(d) : formatDateShort(d)}
                      </th>
                    ))}
                    <th className="px-3 py-3 text-center text-xs font-semibold uppercase tracking-wider text-text-2 min-w-[80px] bg-sunken">
                      Total
                    </th>
                    <th className="px-3 py-3 text-center text-xs font-semibold uppercase tracking-wider text-text-2 min-w-[80px] bg-sunken">
                      Avg
                    </th>
                    <th className="px-2 py-3 text-center text-xs font-semibold uppercase tracking-wider min-w-[60px] bg-info-soft text-info-text" title="Dine-In">
                      <UtensilsCrossed className="h-3.5 w-3.5 mx-auto" />
                    </th>
                    <th className="px-2 py-3 text-center text-xs font-semibold uppercase tracking-wider min-w-[60px] bg-warn-soft text-warn-text" title="Takeaway">
                      <ShoppingBag className="h-3.5 w-3.5 mx-auto" />
                    </th>
                    <th className="px-2 py-3 text-center text-xs font-semibold uppercase tracking-wider min-w-[60px] bg-info-soft text-info-text" title="Delivery">
                      <Truck className="h-3.5 w-3.5 mx-auto" />
                    </th>
                    <th className="px-3 py-3 text-center text-xs font-semibold uppercase tracking-wider min-w-[70px] bg-sunken text-text-2">
                      %
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-line">
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

                    const formatValue = (v: number) => {
                      if (activeMetric === "revenue") return v > 0 ? formatRM(v) : "-";
                      if (activeMetric === "orders") return v > 0 ? v.toString() : "-";
                      return v > 0 ? v.toFixed(1) : "-";
                    };

                    const totalVal = getTotal();
                    const pct = round.totals.pctOfTarget;
                    const tc = targetColor(pct);

                    // Channel values for totals row
                    const chDineIn = activeMetric === "revenue" ? round.totals.dineIn.revenue : round.totals.dineIn.orders;
                    const chTakeaway = activeMetric === "revenue" ? round.totals.takeaway.revenue : round.totals.takeaway.orders;
                    const chDelivery = activeMetric === "revenue" ? round.totals.delivery.revenue : round.totals.delivery.orders;

                    return (
                      <tr key={round.key} className="hover:bg-sunken/50 transition-colors">
                        <td className="px-4 py-3 sticky left-0 bg-surface z-10">
                          <div>
                            <p className="font-medium text-text">{round.label}</p>
                            <p className="text-[11px] text-text-3">{round.timeRange}</p>
                          </div>
                        </td>
                        {round.daily.map((cell) => {
                          const val = getValue(cell);
                          // Use per-day target for color coding
                          const dayTarget = activeMetric === "revenue" ? cell.target.revenue
                            : activeMetric === "orders" ? cell.target.orders
                            : cell.target.aov;
                          return (
                            <td key={cell.date} className="px-3 py-3 text-center">
                              <span
                                className={cn(
                                  "font-sans text-sm",
                                  cellColor(val, dayTarget),
                                )}
                              >
                                {formatValue(val)}
                              </span>
                            </td>
                          );
                        })}
                        <td className="px-3 py-3 text-center bg-sunken">
                          <span className="font-sans font-bold text-text">
                            {typeof totalVal === "number" ? formatValue(totalVal) : totalVal}
                          </span>
                        </td>
                        <td className="px-3 py-3 text-center bg-sunken">
                          <span className="font-sans font-medium text-text-2">
                            {typeof getAvg() === "number"
                              ? formatValue(getAvg() as number)
                              : getAvg()}
                          </span>
                        </td>
                        {/* Channel columns */}
                        <td className="px-2 py-3 text-center bg-info-soft">
                          <span className="font-sans text-xs text-text-2">
                            {activeMetric === "aov" ? "-" : chDineIn > 0 ? (activeMetric === "revenue" ? formatRM(chDineIn) : chDineIn) : "-"}
                          </span>
                        </td>
                        <td className="px-2 py-3 text-center bg-warn-soft">
                          <span className="font-sans text-xs text-text-2">
                            {activeMetric === "aov" ? "-" : chTakeaway > 0 ? (activeMetric === "revenue" ? formatRM(chTakeaway) : chTakeaway) : "-"}
                          </span>
                        </td>
                        <td className="px-2 py-3 text-center bg-info-soft">
                          <span className="font-sans text-xs text-text-2">
                            {activeMetric === "aov" ? "-" : chDelivery > 0 ? (activeMetric === "revenue" ? formatRM(chDelivery) : chDelivery) : "-"}
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
                  <tr className="bg-sunken font-semibold border-t-2 border-line-2">
                    <td className="px-4 py-3 sticky left-0 bg-sunken z-10 text-text">
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
                        <td key={d} className="px-3 py-3 text-center text-text">
                          {displayVal}
                        </td>
                      );
                    })}
                    <td className="px-3 py-3 text-center bg-line text-text">
                      {activeMetric === "revenue"
                        ? `RM ${data.summary.revenue.toLocaleString("en-MY", { minimumFractionDigits: 0 })}`
                        : activeMetric === "orders"
                          ? data.summary.orders.toLocaleString()
                          : data.summary.aov.toFixed(1)}
                    </td>
                    <td className="px-3 py-3 text-center bg-line text-text-2">-</td>
                    {/* Grand total channels */}
                    {(() => {
                      const gtDineIn = data.rounds.reduce((s, r) => s + (activeMetric === "revenue" ? r.totals.dineIn.revenue : r.totals.dineIn.orders), 0);
                      const gtTakeaway = data.rounds.reduce((s, r) => s + (activeMetric === "revenue" ? r.totals.takeaway.revenue : r.totals.takeaway.orders), 0);
                      const gtDelivery = data.rounds.reduce((s, r) => s + (activeMetric === "revenue" ? r.totals.delivery.revenue : r.totals.delivery.orders), 0);
                      return (
                        <>
                          <td className="px-2 py-3 text-center bg-info-soft text-text text-xs font-bold">
                            {activeMetric === "aov" ? "-" : gtDineIn > 0 ? (activeMetric === "revenue" ? formatRM(gtDineIn) : gtDineIn) : "-"}
                          </td>
                          <td className="px-2 py-3 text-center bg-warn-soft text-text text-xs font-bold">
                            {activeMetric === "aov" ? "-" : gtTakeaway > 0 ? (activeMetric === "revenue" ? formatRM(gtTakeaway) : gtTakeaway) : "-"}
                          </td>
                          <td className="px-2 py-3 text-center bg-info-soft text-text text-xs font-bold">
                            {activeMetric === "aov" ? "-" : gtDelivery > 0 ? (activeMetric === "revenue" ? formatRM(gtDelivery) : gtDelivery) : "-"}
                          </td>
                        </>
                      );
                    })()}
                    <td className="px-3 py-3 text-center bg-line">
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

          {/* ─── Outside-round info ─── */}
          {data.outsideRounds.orders > 0 && (
            <div className="rounded-lg border border-line bg-sunken px-4 py-3 text-xs text-text-2">
              <span className="font-medium text-text-2">
                {data.outsideRounds.orders} order{data.outsideRounds.orders !== 1 ? "s" : ""}
              </span>{" "}
              outside tracked rounds (before 8AM or after 11PM) totalling{" "}
              <span className="font-medium text-text-2">
                RM {data.outsideRounds.revenue.toLocaleString("en-MY", { minimumFractionDigits: 2 })}
              </span>
            </div>
          )}

          {/* ─── Pickup & Delivery ─── */}
          {(() => {
            const totTakeaway = data.rounds.reduce((s, r) => s + r.totals.takeaway.orders, 0);
            const totDelivery = data.rounds.reduce((s, r) => s + r.totals.delivery.orders, 0);
            const revTakeaway = data.rounds.reduce((s, r) => s + r.totals.takeaway.revenue, 0);
            const revDelivery = data.rounds.reduce((s, r) => s + r.totals.delivery.revenue, 0);
            const totalPickupDelivery = revTakeaway + revDelivery;
            const pdOrders = totTakeaway + totDelivery;
            const pdAov = pdOrders > 0 ? totalPickupDelivery / pdOrders : 0;

            const pctOfSales = data.summary.revenue > 0 ? Math.round((totalPickupDelivery / data.summary.revenue) * 100) : 0;
            const pctOfOrders = data.summary.orders > 0 ? Math.round((pdOrders / data.summary.orders) * 100) : 0;

            const dt = data.deliveryTarget;
            const pctTarget = dt && dt.revenue > 0 ? Math.round((totalPickupDelivery / dt.revenue) * 100) : 0;
            const tc = targetColor(pctTarget);

            const prev = data.previous;
            const prevPdRev = prev.pickupDeliveryRevenue;
            const prevPdOrd = prev.pickupDeliveryOrders;
            const prevPdAov = prevPdOrd > 0 ? prevPdRev / prevPdOrd : 0;
            const revCh = pctChange(totalPickupDelivery, prevPdRev);
            const ordCh = pctChange(pdOrders, prevPdOrd);
            const aovCh = pctChange(pdAov, prevPdAov);

            const prevTaRev = prev.takeaway.revenue;
            const prevDelRev = prev.delivery.revenue;
            const taCh = pctChange(revTakeaway, prevTaRev);
            const delCh = pctChange(revDelivery, prevDelRev);

            return (
              <div className="rounded-xl border border-line bg-warn-soft shadow-sm p-4">
                <div className="flex items-center gap-2 mb-3 flex-wrap">
                  <ShoppingBag className="h-4 w-4 text-warn-text" />
                  <h3 className="text-xs font-semibold text-text-2 uppercase tracking-wide">Pickup & Delivery</h3>
                  <div className="flex items-center gap-2 ml-auto flex-wrap">
                    <span className="text-[10px] bg-sunken text-text-2 px-1.5 py-0.5 rounded font-medium">
                      {pctOfSales}% of sales
                    </span>
                    <span className="text-[10px] bg-sunken text-text-2 px-1.5 py-0.5 rounded font-medium">
                      {pctOfOrders}% of orders
                    </span>
                    {pctTarget > 0 && (
                      <span className={cn("text-[10px] font-bold px-1.5 py-0.5 rounded", tc.bg, tc.text)}>
                        {pctTarget}% of target
                      </span>
                    )}
                  </div>
                </div>

                <div className="grid grid-cols-3 gap-3 mb-3">
                  <div className="rounded-lg border border-line bg-surface p-2.5 text-center">
                    <p className="text-[10px] text-text-3 uppercase font-medium mb-0.5">Revenue</p>
                    <p className="text-sm font-bold text-text">RM {totalPickupDelivery.toLocaleString("en-MY", { minimumFractionDigits: 0 })}</p>
                    <span className={cn("text-[10px] font-semibold", revCh.color)}>{revCh.label}</span>
                  </div>
                  <div className="rounded-lg border border-line bg-surface p-2.5 text-center">
                    <p className="text-[10px] text-text-3 uppercase font-medium mb-0.5">Orders</p>
                    <p className="text-sm font-bold text-text">{pdOrders}</p>
                    <span className={cn("text-[10px] font-semibold", ordCh.color)}>{ordCh.label}</span>
                  </div>
                  <div className="rounded-lg border border-line bg-surface p-2.5 text-center">
                    <p className="text-[10px] text-text-3 uppercase font-medium mb-0.5">AOV</p>
                    <p className="text-sm font-bold text-text">RM {pdAov.toFixed(2)}</p>
                    <span className={cn("text-[10px] font-semibold", aovCh.color)}>{aovCh.label}</span>
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <div className="rounded-lg border border-line bg-surface p-3">
                    <div className="flex items-center gap-1.5 mb-1.5">
                      <ShoppingBag className="h-3.5 w-3.5 text-warn-text" />
                      <span className="text-[11px] font-semibold text-text-2 uppercase">Takeaway</span>
                      <span className={cn("text-[10px] font-semibold ml-auto", taCh.color)}>{taCh.label}</span>
                    </div>
                    <p className="text-lg font-bold text-text">RM {revTakeaway.toLocaleString("en-MY", { minimumFractionDigits: 0 })}</p>
                    <p className="text-[11px] text-text-3">{totTakeaway} {totTakeaway === 1 ? 'order' : 'orders'}</p>
                  </div>
                  <div className="rounded-lg border border-line bg-surface p-3">
                    <div className="flex items-center gap-1.5 mb-1.5">
                      <Truck className="h-3.5 w-3.5 text-info-text" />
                      <span className="text-[11px] font-semibold text-text-2 uppercase">Delivery</span>
                      <span className={cn("text-[10px] font-semibold ml-auto", delCh.color)}>{delCh.label}</span>
                    </div>
                    <p className="text-lg font-bold text-text">RM {revDelivery.toLocaleString("en-MY", { minimumFractionDigits: 0 })}</p>
                    <p className="text-[11px] text-text-3">{totDelivery} {totDelivery === 1 ? 'order' : 'orders'}</p>
                  </div>
                </div>
                {dt && (
                  <div className="mt-2 text-[11px] text-text-3 text-right">
                    Target: RM {dt.revenue}/day &middot; {dt.orders} {dt.orders === 1 ? 'order' : 'orders'} &middot; AOV RM {dt.aov}
                  </div>
                )}
              </div>
            );
          })()}

        </div>
      )}
    </div>
  );
}
