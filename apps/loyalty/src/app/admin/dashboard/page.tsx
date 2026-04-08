"use client";

import { useState, useEffect, useCallback } from "react";
import {
  DollarSign,
  Users,
  Star,
  Gift,
  TrendingUp,
  Loader2,
  Activity as ActivityIcon,
  Crown,
  Target,
  UserCheck,
  Repeat,
} from "lucide-react";
import { fetchDashboardStats } from "@/lib/api";
import type { DashboardStats } from "@/types";
import { cn, formatPoints, formatPhone, getTimeAgo } from "@/lib/utils";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type KpiPeriod = "daily" | "weekly" | "monthly";

type KpiData = {
  period: { from: string; to: string; type: string };
  collection_rate: {
    pos_orders: number;
    loyalty_claims: number;
    rate: number;
    outlets: { outlet_name: string; pos_orders: number; loyalty_claims: number; claim_rate: number }[];
  };
  new_members: number;
  returning_members: number;
  returning_sales: number;
};

type Activity = {
  id: string;
  name: string;
  text: string;
  type: "earn" | "redeem" | "bonus";
  date: string;
};

// ---------------------------------------------------------------------------
// Activity color map
// ---------------------------------------------------------------------------

const activityColors: Record<string, string> = {
  earn: "bg-green-100 text-green-700",
  redeem: "bg-orange-100 text-orange-700",
  bonus: "bg-blue-100 text-blue-700",
};

const activityDotColors: Record<string, string> = {
  earn: "bg-green-500",
  redeem: "bg-orange-500",
  bonus: "bg-blue-500",
};

const PERIOD_LABELS: Record<KpiPeriod, string> = {
  daily: "Today",
  weekly: "This Week",
  monthly: "This Month",
};

// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Horizontal Bar Chart Component
// ---------------------------------------------------------------------------

function HorizontalBarChart({
  data,
  label,
  icon,
}: {
  data: { month: string; count: number }[];
  label: string;
  icon: React.ReactNode;
}) {
  const maxCount = Math.max(...data.map((d) => d.count), 1);

  return (
    <div className="rounded-xl border border-gray-200 dark:border-neutral-700 bg-white dark:bg-neutral-800 shadow-sm p-5">
      <div className="flex items-center gap-2 mb-4">
        {icon}
        <h3 className="text-sm font-semibold text-gray-900 dark:text-white">
          {label}
        </h3>
      </div>
      <div className="space-y-2.5">
        {data.map((item) => (
          <div key={item.month} className="flex items-center gap-3">
            <span className="text-xs font-medium text-gray-500 dark:text-neutral-400 w-16 shrink-0 text-right">
              {item.month}
            </span>
            <div className="flex-1 h-6 bg-gray-100 dark:bg-neutral-700 rounded-md overflow-hidden">
              <div
                className="h-full rounded-md transition-all duration-500"
                style={{
                  width: `${(item.count / maxCount) * 100}%`,
                  backgroundColor: "#C2452D",
                  minWidth: item.count > 0 ? "8px" : "0px",
                }}
              />
            </div>
            <span className="text-xs font-bold text-gray-700 dark:text-neutral-300 w-10 shrink-0">
              {formatPoints(item.count)}
            </span>
          </div>
        ))}
        {data.length === 0 && (
          <p className="text-sm text-gray-400 dark:text-neutral-500 text-center py-4">
            No data available.
          </p>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export default function AdminDashboard() {
  const [stats, setStats] = useState<DashboardStats | null>(null);
  const [activities, setActivities] = useState<Activity[]>([]);
  const [statsError, setStatsError] = useState(false);

  // KPI state
  const [kpiPeriod, setKpiPeriod] = useState<KpiPeriod>("daily");
  const [kpi, setKpi] = useState<KpiData | null>(null);
  const [kpiLoading, setKpiLoading] = useState(true);

  // Load KPI data when period changes
  const loadKpi = useCallback(async (period: KpiPeriod) => {
    setKpiLoading(true);
    try {
      const res = await fetch(`/api/dashboard/kpi?brand_id=brand-celsius&period=${period}`, {
        credentials: "include",
      });
      if (res.ok) {
        const data = await res.json();
        setKpi(data);
      }
    } catch { /* ignore */ }
    setKpiLoading(false);
  }, []);

  useEffect(() => {
    loadKpi(kpiPeriod);
  }, [kpiPeriod, loadKpi]);

  // Load stats (once) — includes activity feed and segment counts
  useEffect(() => {
    async function loadStats() {
      try {
        const statsData = await fetchDashboardStats();
        setStats(statsData);
        setActivities(
          (statsData.recent_activity ?? []).map((a) => ({
            ...a,
            type: a.type as "earn" | "redeem" | "bonus",
          }))
        );
      } catch {
        setStatsError(true);
      }
    }
    loadStats();
  }, []);

  // Loading / error state
  if (!stats && !statsError) {
    return (
      <div className="flex items-center justify-center h-96">
        <div className="flex flex-col items-center gap-3">
          <Loader2 className="h-8 w-8 animate-spin text-[#C2452D]" />
          <p className="text-sm text-gray-500 dark:text-neutral-400">
            Loading dashboard...
          </p>
        </div>
      </div>
    );
  }
  if (statsError) {
    return (
      <div className="flex items-center justify-center h-96">
        <div className="flex flex-col items-center gap-3">
          <p className="text-sm text-red-500">Failed to load dashboard. Please refresh.</p>
          <button onClick={() => window.location.reload()} className="text-sm text-[#C2452D] underline">Retry</button>
        </div>
      </div>
    );
  }

  return (
    <div className="pb-20 md:pb-0 min-h-0 w-full">
      {/* Page header */}
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-gray-900 dark:text-white">Dashboard</h1>
        <p className="mt-1 text-sm text-gray-500 dark:text-neutral-400">
          Overview of your loyalty program performance
        </p>
      </div>

      <div className="space-y-8">

        {/* ═══════════════════════════════════════════════════════════════════ */}
        {/* KEY METRICS — Collection Rate, New Members, Returning Members, Sales */}
        {/* ═══════════════════════════════════════════════════════════════════ */}
        <div className="rounded-xl border border-gray-200 dark:border-neutral-700 bg-white dark:bg-neutral-800 shadow-sm p-5">
          {/* Header + period toggle */}
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 mb-5">
            <div className="flex items-center gap-2">
              <Target className="h-5 w-5 text-[#C2452D]" />
              <h2 className="text-sm font-semibold text-gray-900 dark:text-white">
                Key Metrics
              </h2>
              {kpi && (
                <span className="text-xs text-gray-400 dark:text-neutral-500">
                  {kpi.period.from === kpi.period.to
                    ? kpi.period.from
                    : `${kpi.period.from} — ${kpi.period.to}`}
                </span>
              )}
            </div>
            <div className="flex rounded-lg border border-gray-200 dark:border-neutral-600 overflow-hidden">
              {(["daily", "weekly", "monthly"] as KpiPeriod[]).map((p) => (
                <button
                  key={p}
                  onClick={() => setKpiPeriod(p)}
                  className={cn(
                    "px-3 py-1.5 text-xs font-medium transition-colors capitalize",
                    kpiPeriod === p
                      ? "bg-[#C2452D] text-white"
                      : "bg-white dark:bg-neutral-800 text-gray-600 dark:text-neutral-400 hover:bg-gray-50 dark:hover:bg-neutral-700"
                  )}
                >
                  {p}
                </button>
              ))}
            </div>
          </div>

          {/* KPI Cards */}
          {kpiLoading ? (
            <div className="flex items-center justify-center py-8">
              <Loader2 className="h-5 w-5 animate-spin text-[#C2452D]" />
            </div>
          ) : kpi ? (
            <>
              <div className="grid grid-cols-3 gap-4 mb-5">
                {/* 1 — New Members */}
                <div className="rounded-lg bg-gray-50 dark:bg-neutral-700/50 p-4">
                  <div className="flex items-center gap-1.5 mb-2">
                    <UserCheck className="h-4 w-4 text-blue-500" />
                    <p className="text-xs font-medium text-gray-500 dark:text-neutral-400">New Members</p>
                  </div>
                  <p className="text-2xl font-bold font-sans text-gray-900 dark:text-white">
                    {kpi.new_members.toLocaleString()}
                  </p>
                  <p className="text-xs text-gray-500 dark:text-neutral-400 mt-1">
                    {PERIOD_LABELS[kpiPeriod as KpiPeriod]}
                  </p>
                </div>

                {/* 3 — Returning Members */}
                <div className="rounded-lg bg-gray-50 dark:bg-neutral-700/50 p-4">
                  <div className="flex items-center gap-1.5 mb-2">
                    <Repeat className="h-4 w-4 text-emerald-500" />
                    <p className="text-xs font-medium text-gray-500 dark:text-neutral-400">Returning Members</p>
                  </div>
                  <p className="text-2xl font-bold font-sans text-gray-900 dark:text-white">
                    {kpi.returning_members.toLocaleString()}
                  </p>
                  <p className="text-xs text-gray-500 dark:text-neutral-400 mt-1">
                    2+ visits
                  </p>
                </div>

                {/* 4 — Sales from Returning Members */}
                <div className="rounded-lg bg-gray-50 dark:bg-neutral-700/50 p-4">
                  <div className="flex items-center gap-1.5 mb-2">
                    <DollarSign className="h-4 w-4 text-green-500" />
                    <p className="text-xs font-medium text-gray-500 dark:text-neutral-400">Returning Sales</p>
                  </div>
                  <p className="text-2xl font-bold font-sans text-gray-900 dark:text-white">
                    RM {kpi.returning_sales.toLocaleString()}
                  </p>
                  <p className="text-xs text-gray-500 dark:text-neutral-400 mt-1">
                    from returning members
                  </p>
                </div>
              </div>

            </>
          ) : (
            <p className="text-sm text-gray-400 dark:text-neutral-500 text-center py-4">
              Failed to load metrics
            </p>
          )}
        </div>

        {/* ─── Overview Stats ─── */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          {/* Total Members */}
          <div className="rounded-xl border border-gray-200 dark:border-neutral-700 bg-white dark:bg-neutral-800 p-5 shadow-sm">
            <div className="flex items-start gap-3 mb-4">
              <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-blue-100">
                <Users className="h-5 w-5 text-blue-600" />
              </div>
              <div className="min-w-0">
                <p className="text-xs font-medium text-gray-500 dark:text-neutral-400 uppercase tracking-wide">
                  Total Members
                </p>
              </div>
            </div>
            <p className="font-sans text-2xl font-bold text-gray-900 dark:text-white mb-2">
              {(stats?.total_members || 0).toLocaleString()}
            </p>
            <p className="text-xs text-gray-500 dark:text-neutral-400">
              <span className="font-sans font-semibold text-gray-700 dark:text-neutral-200">
                {formatPoints(stats?.active_members_30d ?? 0)}
              </span>{" "}
              active (30d)
            </p>
          </div>

          {/* Points Issued */}
          <div className="rounded-xl border border-gray-200 dark:border-neutral-700 bg-white dark:bg-neutral-800 p-5 shadow-sm">
            <div className="flex items-start gap-3 mb-4">
              <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-orange-100">
                <Star className="h-5 w-5 text-orange-600" />
              </div>
              <div className="min-w-0">
                <p className="text-xs font-medium text-gray-500 dark:text-neutral-400 uppercase tracking-wide">
                  Points Issued
                </p>
              </div>
            </div>
            <p className="font-sans text-2xl font-bold text-gray-900 dark:text-white mb-2">
              {formatPoints(stats?.total_points_issued ?? 0)}
            </p>
            <p className="text-xs text-gray-500 dark:text-neutral-400">
              <span className="font-sans font-semibold text-gray-700 dark:text-neutral-200">
                {formatPoints(stats?.total_points_redeemed ?? 0)}
              </span>{" "}
              redeemed
            </p>
          </div>

          {/* Redemptions */}
          <div className="rounded-xl border border-gray-200 dark:border-neutral-700 bg-white dark:bg-neutral-800 p-5 shadow-sm">
            <div className="flex items-start gap-3 mb-4">
              <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-purple-100">
                <Gift className="h-5 w-5 text-purple-600" />
              </div>
              <div className="min-w-0">
                <p className="text-xs font-medium text-gray-500 dark:text-neutral-400 uppercase tracking-wide">
                  Redemptions
                </p>
              </div>
            </div>
            <p className="font-sans text-2xl font-bold text-gray-900 dark:text-white mb-2">
              {(stats?.total_redemptions || 0).toLocaleString()}
            </p>
            <p className="text-xs text-gray-500 dark:text-neutral-400">
              <span className="font-sans font-semibold text-gray-700 dark:text-neutral-200">
                {(stats?.active_campaigns || 0).toLocaleString()}
              </span>{" "}
              active campaigns
            </p>
          </div>

          {/* Sales */}
          <div className="rounded-xl border border-gray-200 dark:border-neutral-700 bg-white dark:bg-neutral-800 p-5 shadow-sm">
            <div className="flex items-start gap-3 mb-4">
              <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-green-100">
                <DollarSign className="h-5 w-5 text-green-600" />
              </div>
              <div className="min-w-0">
                <p className="text-xs font-medium text-gray-500 dark:text-neutral-400 uppercase tracking-wide">
                  Total Sales
                </p>
              </div>
            </div>
            <p className="font-sans text-2xl font-bold text-gray-900 dark:text-white mb-2">
              RM {stats?.total_revenue_attributed?.toLocaleString() || "0"}
            </p>
            <p className="text-xs text-gray-500 dark:text-neutral-400">
              attributed to loyalty
            </p>
          </div>
        </div>

        {/* ─── Charts: New Members Trend + Redemptions Trend ─── */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          <HorizontalBarChart
            data={stats?.new_members_by_month ?? []}
            label="New Members Trend"
            icon={<TrendingUp className="h-4 w-4 text-[#C2452D]" />}
          />
          <HorizontalBarChart
            data={stats?.redemptions_by_month ?? []}
            label="Redemptions Trend"
            icon={<Gift className="h-4 w-4 text-[#C2452D]" />}
          />
        </div>

        {/* ─── Top Spenders Table ─── */}
        {(stats?.top_spenders?.length ?? 0) > 0 && (
          <div className="rounded-xl border border-gray-200 dark:border-neutral-700 bg-white dark:bg-neutral-800 shadow-sm">
            <div className="border-b border-gray-200 dark:border-neutral-700 px-4 py-3 flex items-center gap-2">
              <Crown className="h-4 w-4 text-[#C2452D]" />
              <h3 className="text-sm font-semibold text-gray-900 dark:text-white">
                Top Spenders
              </h3>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full min-w-[700px] text-sm">
                <thead>
                  <tr className="border-b border-gray-100 dark:border-neutral-700 text-left">
                    <th className="px-4 py-3 text-xs font-medium uppercase tracking-wider text-gray-500 dark:text-neutral-400 w-12 whitespace-nowrap">
                      #
                    </th>
                    <th className="px-3 py-3 text-xs font-medium uppercase tracking-wider text-gray-500 dark:text-neutral-400 whitespace-nowrap">
                      Name
                    </th>
                    <th className="px-3 py-3 text-xs font-medium uppercase tracking-wider text-gray-500 dark:text-neutral-400 whitespace-nowrap">
                      Phone
                    </th>
                    <th className="px-3 py-3 text-xs font-medium uppercase tracking-wider text-gray-500 dark:text-neutral-400 whitespace-nowrap">
                      Total Spent
                    </th>
                    <th className="px-3 py-3 text-xs font-medium uppercase tracking-wider text-gray-500 dark:text-neutral-400 whitespace-nowrap">
                      Visits
                    </th>
                    <th className="px-3 py-3 text-xs font-medium uppercase tracking-wider text-gray-500 dark:text-neutral-400 whitespace-nowrap">
                      Points Earned
                    </th>
                    <th className="px-3 py-3 text-xs font-medium uppercase tracking-wider text-gray-500 dark:text-neutral-400 whitespace-nowrap">
                      Rewards Redeemed
                    </th>
                    <th className="px-3 py-3 text-xs font-medium uppercase tracking-wider text-gray-500 dark:text-neutral-400 whitespace-nowrap">
                      Last Visit
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-50 dark:divide-neutral-700/50">
                  {stats?.top_spenders?.slice(0, 5).map((spender, idx) => (
                    <tr
                      key={spender.id}
                      className="hover:bg-gray-50 dark:hover:bg-neutral-700/50 transition-colors"
                    >
                      <td className="px-4 py-3">
                        <span
                          className={cn(
                            "inline-flex h-6 w-6 items-center justify-center rounded-full text-xs font-bold",
                            idx === 0
                              ? "bg-yellow-100 text-yellow-700"
                              : idx === 1
                                ? "bg-gray-100 text-gray-600"
                                : idx === 2
                                  ? "bg-orange-100 text-orange-700"
                                  : "bg-gray-50 text-gray-500 dark:bg-neutral-700 dark:text-neutral-400"
                          )}
                        >
                          {idx + 1}
                        </span>
                      </td>
                      <td className="px-3 py-3 font-medium text-gray-900 dark:text-white whitespace-nowrap">
                        {spender.name || "No Name"}
                      </td>
                      <td className="px-3 py-3 font-sans text-gray-700 dark:text-neutral-300 whitespace-nowrap">
                        {formatPhone(spender.phone)}
                      </td>
                      <td className="px-3 py-3 font-sans font-bold text-gray-900 dark:text-white whitespace-nowrap">
                        RM {spender.total_spent.toLocaleString()}
                      </td>
                      <td className="px-3 py-3 font-sans text-gray-700 dark:text-neutral-300 whitespace-nowrap">
                        {formatPoints(spender.total_visits)}
                      </td>
                      <td className="px-3 py-3 whitespace-nowrap">
                        <span className="font-sans font-bold text-gray-900 dark:text-white">
                          {formatPoints(spender.total_points_earned)}
                        </span>{" "}
                        <span className="text-xs text-gray-400 dark:text-neutral-500">pts</span>
                      </td>
                      <td className="px-3 py-3 font-sans text-gray-700 dark:text-neutral-300 whitespace-nowrap">
                        {spender.total_rewards_redeemed.toLocaleString()}
                      </td>
                      <td className="px-3 py-3 text-gray-500 dark:text-neutral-400 whitespace-nowrap">
                        {spender.last_visit_at ? getTimeAgo(spender.last_visit_at) : "Never"}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* ─── Recent Activity ─── */}
        {activities.length > 0 && (
          <div className="rounded-xl border border-gray-200 dark:border-neutral-700 bg-white dark:bg-neutral-800 shadow-sm">
            <div className="border-b border-gray-200 dark:border-neutral-700 px-5 py-3 flex items-center gap-2">
              <ActivityIcon className="h-4 w-4 text-[#C2452D]" />
              <h2 className="text-sm font-semibold text-gray-900 dark:text-white">
                Recent Activity
              </h2>
              <span className="ml-auto text-xs text-gray-400 dark:text-neutral-500">
                Last {activities.length} transactions
              </span>
            </div>

            <div className="divide-y divide-gray-100 dark:divide-neutral-700/50">
              {activities.map((activity) => (
                <div
                  key={activity.id}
                  className="flex items-center gap-3 px-5 py-3"
                >
                  {/* Avatar */}
                  <div
                    className={cn(
                      "flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-xs font-bold",
                      activityColors[activity.type]
                    )}
                  >
                    {activity.name.charAt(0).toUpperCase()}
                  </div>

                  {/* Text */}
                  <div className="min-w-0 flex-1">
                    <p className="text-sm text-gray-700 dark:text-neutral-300 leading-snug">
                      <span className="font-medium text-gray-900 dark:text-white">
                        {activity.name}
                      </span>{" "}
                      {activity.text}
                    </p>
                  </div>

                  {/* Time */}
                  <span className="shrink-0 text-xs text-gray-400 dark:text-neutral-500">
                    {getTimeAgo(activity.date)}
                  </span>

                  {/* Color dot */}
                  <div
                    className={cn(
                      "h-2 w-2 shrink-0 rounded-full",
                      activityDotColors[activity.type]
                    )}
                  />
                </div>
              ))}
            </div>
          </div>
        )}

      </div>
    </div>
  );
}
