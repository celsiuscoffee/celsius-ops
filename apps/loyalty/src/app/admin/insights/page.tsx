"use client";

import { useState, useEffect, useCallback } from "react";
import Link from "next/link";
import {
  Sparkles,
  RefreshCw,
  TrendingUp,
  TrendingDown,
  Users,
  Gift,
  Zap,
  AlertCircle,
  CheckCircle,
  Info,
  ArrowRight,
  Star,
  Clock,
  Target,
  ShoppingBag,
} from "lucide-react";
import { cn } from "@/lib/utils";

const BRAND_ID = "brand-celsius";

// ─── Types ────────────────────────────────────────────────────────────────────

interface MemberInsight {
  type: string;
  priority: "high" | "medium" | "low" | "info";
  title: string;
  metric: number;
  metric_label: string;
  description: string;
  recommendation: string;
  data: Record<string, number>;
}

interface RewardItem {
  id: string;
  name: string;
  category: string;
  points_required: number;
  redeemCount: number;
  redemptionRate: number;
}

interface RewardInsight {
  type: string;
  priority: "high" | "medium" | "low" | "info";
  title: string;
  description: string;
  recommendation: string;
  rewards?: RewardItem[];
  missing_categories?: string[];
  existing_categories?: string[];
}

interface PricingRecommendation {
  label: string;
  suggested_points: number;
  rationale: string;
}

interface PricingInsights {
  title: string;
  current_median_points: number;
  avg_points_per_visit: number;
  avg_visits_to_redeem: number;
  recommendations: PricingRecommendation[];
  insight: string;
}

interface ProductRecommendation {
  priority: "high" | "medium" | "low";
  title: string;
  description: string;
  recommendation: string;
}

interface QuickAction {
  action: string;
  label: string;
  href: string;
  priority: "high" | "medium" | "low";
}

interface InsightsData {
  generated_at: string;
  brand_id: string;
  summary: {
    total_members: number;
    active_members_30d: number;
    inactive_members_90d: number;
    new_members: number;
    vip_members: number;
    avg_points_balance: number;
    total_floating_points: number;
    earn_redeem_ratio_pct: number;
    weekly_redemption_rate: number;
    total_active_rewards: number;
    peak_redemption_day: string | null;
  };
  member_insights: MemberInsight[];
  reward_insights: RewardInsight[];
  pricing_insights: PricingInsights;
  product_recommendations: ProductRecommendation[];
  quick_actions: QuickAction[];
}

// ─── Helper Components ────────────────────────────────────────────────────────

function PriorityBadge({ priority }: { priority: string }) {
  const styles: Record<string, string> = {
    high: "bg-red-50 text-red-600 dark:bg-red-500/10 dark:text-red-400 border-red-100 dark:border-red-500/20",
    medium: "bg-amber-50 text-amber-600 dark:bg-amber-500/10 dark:text-amber-400 border-amber-100 dark:border-amber-500/20",
    low: "bg-blue-50 text-blue-600 dark:bg-blue-500/10 dark:text-blue-400 border-blue-100 dark:border-blue-500/20",
    info: "bg-gray-50 text-gray-500 dark:bg-neutral-700 dark:text-neutral-400 border-gray-100 dark:border-neutral-600",
  };
  const labels: Record<string, string> = { high: "High", medium: "Medium", low: "Low", info: "Info" };
  return (
    <span className={cn("inline-flex items-center rounded-full border px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide", styles[priority] || styles.info)}>
      {labels[priority] || priority}
    </span>
  );
}

function PriorityIcon({ priority, type }: { priority: string; type?: string }) {
  if (type === "opportunity" || type === "top_performer" || type === "growth" || type === "vip") {
    return <TrendingUp className="h-4 w-4 text-emerald-500" />;
  }
  if (priority === "high") return <AlertCircle className="h-4 w-4 text-red-500" />;
  if (priority === "medium") return <Info className="h-4 w-4 text-amber-500" />;
  if (type === "underperformer" || type === "risk") return <TrendingDown className="h-4 w-4 text-red-400" />;
  return <CheckCircle className="h-4 w-4 text-blue-500" />;
}

function InsightCard({
  icon,
  title,
  priority,
  type,
  description,
  recommendation,
  children,
}: {
  icon?: React.ReactNode;
  title: string;
  priority: string;
  type?: string;
  description: string;
  recommendation: string;
  children?: React.ReactNode;
}) {
  return (
    <div className="rounded-xl border border-gray-200 dark:border-neutral-700 bg-white dark:bg-neutral-800 p-5 flex flex-col gap-4">
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-center gap-2.5">
          {icon || <PriorityIcon priority={priority} type={type} />}
          <h3 className="font-semibold text-gray-900 dark:text-white text-sm">{title}</h3>
        </div>
        <PriorityBadge priority={priority} />
      </div>
      <p className="text-sm text-gray-600 dark:text-neutral-400 leading-relaxed">{description}</p>
      {children}
      <div className="rounded-lg bg-[#C2452D]/5 dark:bg-[#C2452D]/10 border border-[#C2452D]/10 dark:border-[#C2452D]/20 p-3">
        <p className="text-xs font-semibold text-[#C2452D] mb-0.5">Recommendation</p>
        <p className="text-xs text-gray-700 dark:text-neutral-300 leading-relaxed">{recommendation}</p>
      </div>
    </div>
  );
}

function SummaryCard({
  label,
  value,
  sub,
  icon: Icon,
  highlight,
}: {
  label: string;
  value: string | number;
  sub?: string;
  icon: React.ElementType;
  highlight?: boolean;
}) {
  return (
    <div className={cn(
      "rounded-xl border p-4 flex items-start gap-3",
      highlight
        ? "border-[#C2452D]/20 bg-[#C2452D]/5 dark:bg-[#C2452D]/10 dark:border-[#C2452D]/20"
        : "border-gray-200 dark:border-neutral-700 bg-white dark:bg-neutral-800"
    )}>
      <div className={cn(
        "flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-lg",
        highlight ? "bg-[#C2452D]/10" : "bg-gray-100 dark:bg-neutral-700"
      )}>
        <Icon className={cn("h-4 w-4", highlight ? "text-[#C2452D]" : "text-gray-500 dark:text-neutral-400")} />
      </div>
      <div className="min-w-0">
        <p className="text-[11px] font-medium text-gray-500 dark:text-neutral-400 uppercase tracking-wide truncate">{label}</p>
        <p className={cn("text-xl font-bold mt-0.5", highlight ? "text-[#C2452D]" : "text-gray-900 dark:text-white")}>{value}</p>
        {sub && <p className="text-[11px] text-gray-400 dark:text-neutral-500 mt-0.5">{sub}</p>}
      </div>
    </div>
  );
}

// ─── Main Page ────────────────────────────────────────────────────────────────

export default function InsightsPage() {
  const [data, setData] = useState<InsightsData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  const fetchInsights = useCallback(async (isRefresh = false) => {
    if (isRefresh) setRefreshing(true);
    else setLoading(true);
    setError(null);

    try {
      const res = await fetch(`/api/admin/ai-insights?brand_id=${BRAND_ID}`);
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error || `HTTP ${res.status}`);
      }
      const json = await res.json();
      setData(json);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load insights");
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => { fetchInsights(); }, [fetchInsights]);

  // ─── Loading State ────────────────────────────────────────────────────────
  if (loading) {
    return (
      <div className="flex min-h-[60vh] items-center justify-center">
        <div className="flex flex-col items-center gap-3">
          <div className="relative">
            <Sparkles className="h-8 w-8 text-[#C2452D] animate-pulse" />
          </div>
          <p className="text-sm font-medium text-gray-500 dark:text-neutral-400">Analyzing your loyalty data…</p>
        </div>
      </div>
    );
  }

  // ─── Error State ──────────────────────────────────────────────────────────
  if (error || !data) {
    return (
      <div className="flex min-h-[60vh] items-center justify-center">
        <div className="flex flex-col items-center gap-4 text-center max-w-sm">
          <AlertCircle className="h-10 w-10 text-red-400" />
          <div>
            <p className="font-semibold text-gray-900 dark:text-white">Failed to load insights</p>
            <p className="text-sm text-gray-500 dark:text-neutral-400 mt-1">{error}</p>
          </div>
          <button
            onClick={() => fetchInsights()}
            className="rounded-lg bg-[#C2452D] text-white px-4 py-2 text-sm font-medium hover:bg-[#A93B26] transition-colors"
          >
            Try Again
          </button>
        </div>
      </div>
    );
  }

  const { summary, member_insights, reward_insights, pricing_insights, product_recommendations, quick_actions } = data;
  const generatedAt = new Date(data.generated_at);
  const highPriorityActions = quick_actions.filter(a => a.priority === "high");
  const otherActions = quick_actions.filter(a => a.priority !== "high");

  return (
    <div className="space-y-8">
      {/* ─── Header ─── */}
      <div className="flex items-start justify-between gap-4">
        <div>
          <div className="flex items-center gap-2 mb-1">
            <Sparkles className="h-5 w-5 text-[#C2452D]" />
            <h1 className="text-xl font-bold text-gray-900 dark:text-white">AI Insights</h1>
          </div>
          <p className="text-sm text-gray-500 dark:text-neutral-400">
            Smart recommendations based on your loyalty program data
          </p>
          <p className="text-xs text-gray-400 dark:text-neutral-500 mt-1">
            Last updated: {generatedAt.toLocaleTimeString()} · {generatedAt.toLocaleDateString()}
          </p>
        </div>
        <button
          onClick={() => fetchInsights(true)}
          disabled={refreshing}
          className="flex items-center gap-2 rounded-lg border border-gray-200 dark:border-neutral-700 bg-white dark:bg-neutral-800 px-3 py-2 text-sm font-medium text-gray-600 dark:text-neutral-300 hover:bg-gray-50 dark:hover:bg-neutral-700 transition-colors disabled:opacity-60"
        >
          <RefreshCw className={cn("h-4 w-4", refreshing && "animate-spin")} />
          {refreshing ? "Refreshing…" : "Refresh"}
        </button>
      </div>

      {/* ─── Summary Cards ─── */}
      <section>
        <h2 className="text-sm font-semibold text-gray-500 dark:text-neutral-400 uppercase tracking-wide mb-3">Snapshot</h2>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <SummaryCard label="Total Members" value={summary.total_members.toLocaleString()} icon={Users} />
          <SummaryCard label="Active (30d)" value={summary.active_members_30d.toLocaleString()} sub={`${Math.round((summary.active_members_30d / Math.max(1, summary.total_members)) * 100)}% of base`} icon={TrendingUp} highlight />
          <SummaryCard label="Inactive (90d)" value={summary.inactive_members_90d.toLocaleString()} sub="need re-engagement" icon={Clock} />
          <SummaryCard label="Floating Points" value={summary.total_floating_points.toLocaleString()} sub="unredeemed liability" icon={Zap} />
          <SummaryCard label="Avg Points Balance" value={summary.avg_points_balance.toLocaleString()} icon={Star} />
          <SummaryCard label="Earn/Redeem Ratio" value={`${summary.earn_redeem_ratio_pct}%`} sub="of earned pts redeemed" icon={Target} />
          <SummaryCard label="Weekly Redemptions" value={summary.weekly_redemption_rate} sub="avg per week" icon={Gift} />
          <SummaryCard label="Peak Day" value={summary.peak_redemption_day || "—"} sub="most redemptions" icon={ShoppingBag} />
        </div>
      </section>

      {/* ─── Quick Actions ─── */}
      {quick_actions.length > 0 && (
        <section>
          <h2 className="text-sm font-semibold text-gray-500 dark:text-neutral-400 uppercase tracking-wide mb-3">Quick Actions</h2>
          <div className="rounded-xl border border-gray-200 dark:border-neutral-700 bg-white dark:bg-neutral-800 divide-y divide-gray-100 dark:divide-neutral-700 overflow-hidden">
            {highPriorityActions.map((action, i) => (
              <Link
                key={i}
                href={action.href}
                className="flex items-center justify-between gap-3 px-5 py-4 hover:bg-red-50/50 dark:hover:bg-red-500/5 transition-colors group"
              >
                <div className="flex items-center gap-3 min-w-0">
                  <div className="flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-full bg-red-100 dark:bg-red-500/10">
                    <AlertCircle className="h-3.5 w-3.5 text-red-500" />
                  </div>
                  <span className="text-sm font-medium text-gray-800 dark:text-neutral-200 truncate">{action.label}</span>
                </div>
                <ArrowRight className="h-4 w-4 text-gray-400 dark:text-neutral-500 flex-shrink-0 group-hover:text-[#C2452D] transition-colors" />
              </Link>
            ))}
            {otherActions.map((action, i) => (
              <Link
                key={i}
                href={action.href}
                className="flex items-center justify-between gap-3 px-5 py-3.5 hover:bg-gray-50 dark:hover:bg-neutral-700/50 transition-colors group"
              >
                <div className="flex items-center gap-3 min-w-0">
                  <div className={cn(
                    "flex h-6 w-6 flex-shrink-0 items-center justify-center rounded-full",
                    action.priority === "medium" ? "bg-amber-100 dark:bg-amber-500/10" : "bg-gray-100 dark:bg-neutral-700"
                  )}>
                    <ArrowRight className={cn("h-3 w-3", action.priority === "medium" ? "text-amber-500" : "text-gray-400 dark:text-neutral-500")} />
                  </div>
                  <span className="text-sm text-gray-700 dark:text-neutral-300 truncate">{action.label}</span>
                </div>
                <ArrowRight className="h-4 w-4 text-gray-300 dark:text-neutral-600 flex-shrink-0 group-hover:text-[#C2452D] transition-colors" />
              </Link>
            ))}
          </div>
        </section>
      )}

      {/* ─── Member Insights ─── */}
      <section>
        <h2 className="text-sm font-semibold text-gray-500 dark:text-neutral-400 uppercase tracking-wide mb-3">Member Insights</h2>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {member_insights.map((insight, i) => (
            <InsightCard
              key={i}
              title={insight.title}
              priority={insight.priority}
              type={insight.type}
              description={insight.description}
              recommendation={insight.recommendation}
            >
              <div className="flex items-baseline gap-1.5">
                <span className="text-3xl font-bold text-gray-900 dark:text-white">
                  {insight.metric.toLocaleString()}
                </span>
                <span className="text-sm text-gray-500 dark:text-neutral-400">{insight.metric_label}</span>
              </div>
            </InsightCard>
          ))}
        </div>
      </section>

      {/* ─── Reward Insights ─── */}
      <section>
        <h2 className="text-sm font-semibold text-gray-500 dark:text-neutral-400 uppercase tracking-wide mb-3">Reward Insights</h2>
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {reward_insights.map((insight, i) => (
            <InsightCard
              key={i}
              title={insight.title}
              priority={insight.priority}
              type={insight.type}
              description={insight.description}
              recommendation={insight.recommendation}
            >
              {insight.rewards && insight.rewards.length > 0 && (
                <div className="space-y-1.5">
                  {insight.rewards.map((r) => (
                    <div key={r.id} className="flex items-center justify-between rounded-lg bg-gray-50 dark:bg-neutral-700/50 px-3 py-2">
                      <div className="min-w-0">
                        <p className="text-xs font-medium text-gray-800 dark:text-neutral-200 truncate">{r.name}</p>
                        <p className="text-[11px] text-gray-400 dark:text-neutral-500 capitalize">{r.category} · {r.points_required} pts</p>
                      </div>
                      <div className="text-right flex-shrink-0 ml-2">
                        <p className="text-xs font-semibold text-gray-700 dark:text-neutral-300">{r.redeemCount}×</p>
                        <p className="text-[10px] text-gray-400 dark:text-neutral-500">{r.redemptionRate}% used</p>
                      </div>
                    </div>
                  ))}
                </div>
              )}
              {insight.missing_categories && insight.missing_categories.length > 0 && (
                <div className="flex flex-wrap gap-1.5">
                  {insight.missing_categories.map(c => (
                    <span key={c} className="rounded-full bg-red-50 dark:bg-red-500/10 border border-red-100 dark:border-red-500/20 px-2.5 py-0.5 text-[11px] font-medium text-red-600 dark:text-red-400 capitalize">
                      {c} missing
                    </span>
                  ))}
                  {(insight.existing_categories || []).map(c => (
                    <span key={c} className="rounded-full bg-emerald-50 dark:bg-emerald-500/10 border border-emerald-100 dark:border-emerald-500/20 px-2.5 py-0.5 text-[11px] font-medium text-emerald-600 dark:text-emerald-400 capitalize">
                      {c} ✓
                    </span>
                  ))}
                </div>
              )}
            </InsightCard>
          ))}
        </div>
      </section>

      {/* ─── Products to Push ─── */}
      {product_recommendations.length > 0 && (
        <section>
          <h2 className="text-sm font-semibold text-gray-500 dark:text-neutral-400 uppercase tracking-wide mb-3">Products to Push</h2>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {product_recommendations.map((rec, i) => (
              <InsightCard
                key={i}
                icon={<ShoppingBag className="h-4 w-4 text-violet-500" />}
                title={rec.title}
                priority={rec.priority}
                description={rec.description}
                recommendation={rec.recommendation}
              />
            ))}
          </div>
        </section>
      )}

      {/* ─── Points Pricing ─── */}
      <section>
        <h2 className="text-sm font-semibold text-gray-500 dark:text-neutral-400 uppercase tracking-wide mb-3">Optimal Points Pricing</h2>
        <div className="rounded-xl border border-gray-200 dark:border-neutral-700 bg-white dark:bg-neutral-800 p-5 space-y-5">
          {/* Insight text */}
          <div className="rounded-lg bg-blue-50 dark:bg-blue-500/10 border border-blue-100 dark:border-blue-500/20 p-3">
            <p className="text-sm text-blue-800 dark:text-blue-300">{pricing_insights.insight}</p>
          </div>

          {/* Stats row */}
          <div className="grid grid-cols-3 gap-3">
            <div className="text-center">
              <p className="text-2xl font-bold text-gray-900 dark:text-white">{pricing_insights.current_median_points}</p>
              <p className="text-[11px] text-gray-500 dark:text-neutral-400 mt-0.5">Median reward (pts)</p>
            </div>
            <div className="text-center">
              <p className="text-2xl font-bold text-gray-900 dark:text-white">{pricing_insights.avg_points_per_visit}</p>
              <p className="text-[11px] text-gray-500 dark:text-neutral-400 mt-0.5">Avg pts per visit</p>
            </div>
            <div className="text-center">
              <p className="text-2xl font-bold text-gray-900 dark:text-white">{pricing_insights.avg_visits_to_redeem}</p>
              <p className="text-[11px] text-gray-500 dark:text-neutral-400 mt-0.5">Visits to redeem</p>
            </div>
          </div>

          {/* Pricing tiers */}
          <div className="space-y-3">
            <p className="text-xs font-semibold text-gray-500 dark:text-neutral-400 uppercase tracking-wide">Suggested Pricing Tiers</p>
            {pricing_insights.recommendations.map((rec, i) => {
              const colors = [
                "border-emerald-200 dark:border-emerald-500/30 bg-emerald-50 dark:bg-emerald-500/10",
                "border-amber-200 dark:border-amber-500/30 bg-amber-50 dark:bg-amber-500/10",
                "border-violet-200 dark:border-violet-500/30 bg-violet-50 dark:bg-violet-500/10",
              ];
              const textColors = [
                "text-emerald-700 dark:text-emerald-400",
                "text-amber-700 dark:text-amber-400",
                "text-violet-700 dark:text-violet-400",
              ];
              return (
                <div key={i} className={cn("rounded-lg border p-3 flex items-start justify-between gap-3", colors[i])}>
                  <div className="min-w-0">
                    <p className={cn("text-xs font-semibold", textColors[i])}>{rec.label}</p>
                    <p className="text-xs text-gray-600 dark:text-neutral-400 mt-0.5">{rec.rationale}</p>
                  </div>
                  <div className="flex-shrink-0 text-right">
                    <p className={cn("text-xl font-bold", textColors[i])}>{rec.suggested_points.toLocaleString()}</p>
                    <p className="text-[10px] text-gray-400 dark:text-neutral-500">points</p>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </section>
    </div>
  );
}
