"use client";

import { useState, useEffect, useCallback } from "react";
import {
  DollarSign,
  ShoppingCart,
  TrendingUp,
  Loader2,
  CalendarDays,
  UtensilsCrossed,
  ShoppingBag,
  Truck,
  Sparkles,
  AlertTriangle,
  Lightbulb,
  Zap,
} from "lucide-react";
import { cn } from "@/lib/utils";

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

/** % change between current and previous */
function pctChange(current: number, previous: number): { pct: number; label: string; color: string; diff: number; diffLabel: string } {
  const diff = current - previous;
  const diffAbs = Math.abs(diff);
  const fmtDiff = diffAbs >= 1000 ? `${(diffAbs / 1000).toFixed(1)}k` : diffAbs.toLocaleString("en-MY", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const diffLabel = diff > 0 ? `+RM ${fmtDiff}` : diff < 0 ? `-RM ${fmtDiff}` : "";
  if (current === 0 && previous === 0) return { pct: 0, label: "\u2014", color: "text-gray-400", diff: 0, diffLabel: "" };
  if (previous === 0) return { pct: 0, label: "New", color: "text-green-600", diff, diffLabel };
  if (current === 0) return { pct: -100, label: "-100%", color: "text-red-500", diff, diffLabel };
  const pct = Math.round(((current - previous) / previous) * 100);
  if (pct > 0) return { pct, label: `+${pct}%`, color: "text-green-600", diff, diffLabel };
  if (pct < 0) return { pct, label: `${pct}%`, color: "text-red-500", diff, diffLabel };
  return { pct: 0, label: "0%", color: "text-gray-400", diff: 0, diffLabel: "" };
}

/** Color for a cell value vs daily target */
function cellColor(val: number, target: number): string {
  if (val === 0) return "text-gray-300";
  if (target <= 0) return "text-gray-700";
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

  // Auto-load AI insights when outlet changes (debounced mount)
  useEffect(() => {
    loadRecommendations(outletId);
  }, [outletId, loadRecommendations]);

  // ─── Render ─────────────────────────────────────────────────────────

  return (
    <div className="p-3 sm:p-6 pb-10 min-h-0 w-full">
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
            {/* Period dropdown */}
            <select
              value={period}
              onChange={(e) => setPeriod(e.target.value as Period)}
              className="rounded-lg border border-gray-200 bg-white px-2.5 py-1.5 text-xs font-medium text-gray-700 focus:outline-none focus:ring-1 focus:ring-[#C2452D]"
            >
              {PERIOD_OPTIONS.map((p) => (
                <option key={p.key} value={p.key}>
                  {p.label}
                </option>
              ))}
            </select>
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
          {/* Warnings from StoreHub API */}
          {data.warnings && data.warnings.length > 0 && (
            <div className="rounded-xl border border-amber-200 bg-amber-50 p-4">
              <div className="flex items-center gap-2 mb-1">
                <AlertTriangle className="h-4 w-4 text-amber-600" />
                <p className="text-sm font-medium text-amber-800">StoreHub API Issues</p>
              </div>
              {data.warnings.map((w, i) => (
                <p key={i} className="text-xs text-amber-700 ml-6">{w}</p>
              ))}
            </div>
          )}
          {/* ─── Summary Cards with comparison ─── */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            {(() => {
              const prev = data.previous;
              const revChange = pctChange(data.summary.revenue, prev.revenue);
              const ordChange = pctChange(data.summary.orders, prev.orders);
              const aovChange = pctChange(data.summary.aov, prev.aov);
              return (
                <>
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
                    <div className="flex items-center gap-2 mt-1">
                      <span className={cn("text-xs font-semibold", revChange.color)}>{revChange.label}</span>
                      {revChange.diffLabel && <span className={cn("text-xs", revChange.color)}>{revChange.diffLabel}</span>}
                      <span className="text-[10px] text-gray-400">vs prev period</span>
                    </div>
                    {data.deliveryQR && data.deliveryQR.orders > 0 && (
                      <p className="text-[10px] text-gray-400 mt-1.5">
                        Own sales: RM {(data.summary.ownSalesRevenue ?? data.summary.revenue).toLocaleString("en-MY", { minimumFractionDigits: 2 })}
                        {" · "}Delivery/QR: RM {data.deliveryQR.revenue.toLocaleString("en-MY", { minimumFractionDigits: 2 })}
                      </p>
                    )}
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
                    <div className="flex items-center gap-2 mt-1">
                      <span className={cn("text-xs font-semibold", ordChange.color)}>{ordChange.label}</span>
                      {ordChange.diff !== 0 && <span className={cn("text-xs", ordChange.color)}>{ordChange.diff > 0 ? "+" : ""}{ordChange.diff}</span>}
                      <span className="text-[10px] text-gray-400">vs prev period</span>
                    </div>
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
                    <div className="flex items-center gap-2 mt-1">
                      <span className={cn("text-xs font-semibold", aovChange.color)}>{aovChange.label}</span>
                      {aovChange.diffLabel && <span className={cn("text-xs", aovChange.color)}>{aovChange.diffLabel}</span>}
                      <span className="text-[10px] text-gray-400">vs prev period</span>
                    </div>
                  </div>
                </>
              );
            })()}
          </div>

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
              <div className="rounded-xl border border-gray-200 bg-white shadow-sm p-4">
                <div className="flex items-start justify-between gap-3 flex-wrap">
                  <div className="flex items-start gap-2.5 min-w-0">
                    <div className={cn(
                      "flex h-8 w-8 shrink-0 items-center justify-center rounded-full",
                      isDefault ? "bg-gray-100" : stale ? "bg-amber-100" : "bg-emerald-100",
                    )}>
                      <TrendingUp className={cn(
                        "h-4 w-4",
                        isDefault ? "text-gray-500" : stale ? "text-amber-600" : "text-emerald-600",
                      )} />
                    </div>
                    <div className="min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <p className="text-sm font-semibold text-gray-900">AI Sales Targets</p>
                        <span className={cn(
                          "text-[10px] px-1.5 py-0.5 rounded font-medium",
                          isDefault ? "bg-gray-100 text-gray-600" : stale ? "bg-amber-50 text-amber-700" : "bg-emerald-50 text-emerald-700",
                        )}>
                          {isDefault ? "Using defaults" : stale ? `Stale · ${daysAgo}d ago` : daysAgo === 0 ? "Updated today" : `Updated ${daysAgo}d ago`}
                        </span>
                      </div>
                      <p className="text-[11px] text-gray-500 mt-0.5">
                        {isDefault
                          ? "No AI-set targets yet. Click Recompute to have AI set progressive targets from your trailing 28-day performance."
                          : "Targets auto-scale from trailing actuals. Only move up — never down."}
                      </p>
                      {tm?.reasoning && showReasoning && (
                        <p className="text-[11px] text-gray-600 mt-2 p-2 bg-gray-50 rounded border border-gray-100 leading-relaxed">
                          {tm.reasoning.split(" | ")[0]}
                        </p>
                      )}
                      {targetsRecomputeError && (
                        <p className="text-[11px] text-red-500 mt-1">{targetsRecomputeError}</p>
                      )}
                    </div>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    {tm?.reasoning && (
                      <button
                        onClick={() => setShowReasoning((s) => !s)}
                        className="text-[11px] text-gray-500 hover:text-gray-700 underline underline-offset-2"
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
                          ? "bg-gray-100 text-gray-400 cursor-not-allowed"
                          : "bg-white border border-gray-200 text-gray-700 hover:bg-gray-50",
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
          <div className="rounded-xl border border-gray-200 bg-white shadow-sm p-5">
            <div className="flex items-center justify-between mb-4">
              <div className="flex items-center gap-2">
                <Sparkles className="h-5 w-5 text-[#C2452D]" />
                <h3 className="text-sm font-semibold text-gray-900">AI Sales Coach</h3>
                <span className="text-[10px] bg-[#C2452D]/10 text-[#C2452D] px-1.5 py-0.5 rounded font-medium">
                  Beta
                </span>
              </div>
              <button
                onClick={() => loadRecommendations(outletId)}
                disabled={aiLoading}
                className={cn(
                  "flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-medium transition-colors",
                  aiLoading
                    ? "bg-gray-100 text-gray-400 cursor-not-allowed"
                    : "bg-white text-gray-600 border border-gray-200 hover:bg-gray-50",
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
              <p className="text-xs text-red-500 mb-3">{aiError}</p>
            )}

            {aiLoading && recommendations.length === 0 && (
              <div className="flex items-center justify-center py-8 text-gray-400">
                <Loader2 className="h-5 w-5 animate-spin mr-2" />
                <span className="text-xs">Reading last 30 days of sales…</span>
              </div>
            )}

            {recommendations.length > 0 && (
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                {recommendations.map((rec, idx) => {
                  const iconMap: Record<string, React.ReactNode> = {
                    opportunity: <Sparkles className="h-4 w-4 text-green-500" />,
                    warning: <AlertTriangle className="h-4 w-4 text-amber-500" />,
                    insight: <Lightbulb className="h-4 w-4 text-blue-500" />,
                    action: <Zap className="h-4 w-4 text-purple-500" />,
                  };
                  const borderMap: Record<string, string> = {
                    opportunity: "border-l-green-400",
                    warning: "border-l-amber-400",
                    insight: "border-l-blue-400",
                    action: "border-l-purple-400",
                  };
                  const impactBadge: Record<string, string> = {
                    high: "bg-red-50 text-red-600",
                    medium: "bg-yellow-50 text-yellow-600",
                    low: "bg-gray-50 text-gray-500",
                  };
                  return (
                    <div
                      key={idx}
                      className={cn(
                        "rounded-lg border border-gray-100 border-l-4 p-3",
                        borderMap[rec.type] || "border-l-gray-300",
                      )}
                    >
                      <div className="flex items-start gap-2">
                        <div className="mt-0.5 shrink-0">
                          {iconMap[rec.type] || <Lightbulb className="h-4 w-4 text-gray-400" />}
                        </div>
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2 mb-1">
                            <p className="text-xs font-semibold text-gray-900 truncate">{rec.title}</p>
                            <span className={cn("text-[10px] px-1.5 py-0.5 rounded font-medium shrink-0", impactBadge[rec.impact] || impactBadge.low)}>
                              {rec.impact}
                            </span>
                          </div>
                          <p className="text-[11px] text-gray-500 leading-relaxed">{rec.description}</p>
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
                      <tr key={round.key} className="hover:bg-gray-50/50 transition-colors">
                        <td className="px-4 py-3 sticky left-0 bg-white z-10">
                          <div>
                            <p className="font-medium text-gray-900">{round.label}</p>
                            <p className="text-[11px] text-gray-400">{round.timeRange}</p>
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

          {/* ─── Outside-round info ─── */}
          {data.outsideRounds.orders > 0 && (
            <div className="rounded-lg border border-gray-100 bg-gray-50 px-4 py-3 text-xs text-gray-500">
              <span className="font-medium text-gray-700">
                {data.outsideRounds.orders} order{data.outsideRounds.orders !== 1 ? "s" : ""}
              </span>{" "}
              outside tracked rounds (before 8AM or after 11PM) totalling{" "}
              <span className="font-medium text-gray-700">
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
              <div className="rounded-xl border border-amber-200 bg-amber-50/30 shadow-sm p-4">
                <div className="flex items-center gap-2 mb-3 flex-wrap">
                  <ShoppingBag className="h-4 w-4 text-amber-600" />
                  <h3 className="text-xs font-semibold text-gray-700 uppercase tracking-wide">Pickup & Delivery</h3>
                  <div className="flex items-center gap-2 ml-auto flex-wrap">
                    <span className="text-[10px] bg-gray-100 text-gray-600 px-1.5 py-0.5 rounded font-medium">
                      {pctOfSales}% of sales
                    </span>
                    <span className="text-[10px] bg-gray-100 text-gray-600 px-1.5 py-0.5 rounded font-medium">
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
                  <div className="rounded-lg border border-gray-100 bg-white p-2.5 text-center">
                    <p className="text-[10px] text-gray-400 uppercase font-medium mb-0.5">Revenue</p>
                    <p className="text-sm font-bold text-gray-900">RM {totalPickupDelivery.toLocaleString("en-MY", { minimumFractionDigits: 0 })}</p>
                    <span className={cn("text-[10px] font-semibold", revCh.color)}>{revCh.label}</span>
                  </div>
                  <div className="rounded-lg border border-gray-100 bg-white p-2.5 text-center">
                    <p className="text-[10px] text-gray-400 uppercase font-medium mb-0.5">Orders</p>
                    <p className="text-sm font-bold text-gray-900">{pdOrders}</p>
                    <span className={cn("text-[10px] font-semibold", ordCh.color)}>{ordCh.label}</span>
                  </div>
                  <div className="rounded-lg border border-gray-100 bg-white p-2.5 text-center">
                    <p className="text-[10px] text-gray-400 uppercase font-medium mb-0.5">AOV</p>
                    <p className="text-sm font-bold text-gray-900">RM {pdAov.toFixed(2)}</p>
                    <span className={cn("text-[10px] font-semibold", aovCh.color)}>{aovCh.label}</span>
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <div className="rounded-lg border border-amber-100 bg-white p-3">
                    <div className="flex items-center gap-1.5 mb-1.5">
                      <ShoppingBag className="h-3.5 w-3.5 text-amber-500" />
                      <span className="text-[11px] font-semibold text-gray-600 uppercase">Takeaway</span>
                      <span className={cn("text-[10px] font-semibold ml-auto", taCh.color)}>{taCh.label}</span>
                    </div>
                    <p className="text-lg font-bold text-gray-900">RM {revTakeaway.toLocaleString("en-MY", { minimumFractionDigits: 0 })}</p>
                    <p className="text-[11px] text-gray-400">{totTakeaway} {totTakeaway === 1 ? 'order' : 'orders'}</p>
                  </div>
                  <div className="rounded-lg border border-purple-100 bg-white p-3">
                    <div className="flex items-center gap-1.5 mb-1.5">
                      <Truck className="h-3.5 w-3.5 text-purple-500" />
                      <span className="text-[11px] font-semibold text-gray-600 uppercase">Delivery</span>
                      <span className={cn("text-[10px] font-semibold ml-auto", delCh.color)}>{delCh.label}</span>
                    </div>
                    <p className="text-lg font-bold text-gray-900">RM {revDelivery.toLocaleString("en-MY", { minimumFractionDigits: 0 })}</p>
                    <p className="text-[11px] text-gray-400">{totDelivery} {totDelivery === 1 ? 'order' : 'orders'}</p>
                  </div>
                </div>
                {dt && (
                  <div className="mt-2 text-[11px] text-gray-400 text-right">
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
