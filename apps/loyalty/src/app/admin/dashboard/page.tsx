"use client";

import { useState, useEffect } from "react";
import {
  DollarSign,
  Users,
  Star,
  Gift,
  TrendingUp,
  Loader2,
  Activity as ActivityIcon,
  TrendingDown,
  Award,
  BarChart3,
  Crown,
} from "lucide-react";
import { fetchDashboardStats } from "@/lib/api";
import type { DashboardStats } from "@/types";
import { cn, formatPoints, formatPhone, getTimeAgo } from "@/lib/utils";

// ---------------------------------------------------------------------------
// Phone format — use shared formatPhone from utils
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

// Eligible = 500+ pts (cheapest reward)
const REDEEM_THRESHOLD = 500;

// ---------------------------------------------------------------------------
// Activity type
// ---------------------------------------------------------------------------

type Activity = {
  id: string;
  name: string;
  text: string;
  type: "earn" | "redeem" | "bonus";
  date: string;
};

// ---------------------------------------------------------------------------

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
      <div className="space-y-6">
        {/* KPI Cards Row 1 — Sales, Members, Points, Redemptions */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          {/* 1 — Sales */}
          <div className="rounded-xl border border-gray-200 dark:border-neutral-700 bg-white dark:bg-neutral-800 p-5 shadow-sm">
            <div className="flex items-start gap-3 mb-4">
              <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-green-100">
                <DollarSign className="h-5 w-5 text-green-600" />
              </div>
              <div className="min-w-0">
                <p className="text-xs font-medium text-gray-500 dark:text-neutral-400 uppercase tracking-wide">
                  Sales
                </p>
              </div>
            </div>
            <p className="font-sans text-2xl font-bold text-gray-900 dark:text-white mb-2">
              RM {stats?.total_revenue_attributed?.toLocaleString() || "0"}
            </p>
            <p className="text-xs text-gray-500 dark:text-neutral-400">
              <span className="font-sans font-semibold text-gray-700 dark:text-neutral-200">
                {(stats?.total_members || 0).toLocaleString()}
              </span>{" "}
              total members
            </p>
          </div>

          {/* 2 — Members */}
          <div className="rounded-xl border border-gray-200 dark:border-neutral-700 bg-white dark:bg-neutral-800 p-5 shadow-sm">
            <div className="flex items-start gap-3 mb-4">
              <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-blue-100">
                <Users className="h-5 w-5 text-blue-600" />
              </div>
              <div className="min-w-0">
                <p className="text-xs font-medium text-gray-500 dark:text-neutral-400 uppercase tracking-wide">
                  Members
                </p>
              </div>
            </div>
            <p className="font-sans text-2xl font-bold text-gray-900 dark:text-white mb-2">
              {(stats?.total_members || 0).toLocaleString()}
            </p>
            <p className="text-xs text-gray-500 dark:text-neutral-400">
              <span className="font-sans font-semibold text-gray-700 dark:text-neutral-200">
                {(stats?.new_members_this_month || 0).toLocaleString()}
              </span>{" "}
              this month{" "}
              <span className="text-gray-300 dark:text-neutral-600 mx-1">&middot;</span>
              <span className="font-sans font-semibold text-gray-700 dark:text-neutral-200">
                {(stats?.new_members_today || 0).toLocaleString()}
              </span>{" "}
              today
            </p>
          </div>

          {/* 3 — Points */}
          <div className="rounded-xl border border-gray-200 dark:border-neutral-700 bg-white dark:bg-neutral-800 p-5 shadow-sm">
            <div className="flex items-start gap-3 mb-4">
              <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-orange-100">
                <Star className="h-5 w-5 text-orange-600" />
              </div>
              <div className="min-w-0">
                <p className="text-xs font-medium text-gray-500 dark:text-neutral-400 uppercase tracking-wide">
                  Points
                </p>
              </div>
            </div>
            <p className="font-sans text-2xl font-bold text-gray-900 dark:text-white mb-2">
              {stats?.total_points_issued?.toLocaleString() || "0"}
            </p>
            <p className="text-xs text-gray-500 dark:text-neutral-400">
              <span className="font-sans font-semibold text-gray-700 dark:text-neutral-200">
                {stats?.total_points_redeemed?.toLocaleString() || "0"}
              </span>{" "}
              redeemed
            </p>
          </div>

          {/* 4 — Redemptions */}
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
        </div>

        {/* KPI Cards Row 2 — Active Members, Floating Points, Avg LTV, Redemption Rate */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          {/* 5 — Active Members (30d) */}
          <div className="rounded-xl border border-gray-200 dark:border-neutral-700 bg-white dark:bg-neutral-800 p-5 shadow-sm">
            <div className="flex items-start gap-3 mb-4">
              <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-emerald-100">
                <ActivityIcon className="h-5 w-5 text-emerald-600" />
              </div>
              <div className="min-w-0">
                <p className="text-xs font-medium text-gray-500 dark:text-neutral-400 uppercase tracking-wide">
                  Active (30d)
                </p>
              </div>
            </div>
            <p className="font-sans text-2xl font-bold text-gray-900 dark:text-white mb-2">
              {formatPoints(stats?.active_members_30d ?? 0)}
            </p>
            <p className="text-xs text-gray-500 dark:text-neutral-400">
              <span className="font-sans font-semibold text-gray-700 dark:text-neutral-200">
                {stats?.total_members
                  ? Math.round(((stats?.active_members_30d ?? 0) / stats.total_members) * 100)
                  : 0}%
              </span>{" "}
              of total members
            </p>
          </div>

          {/* 6 — Floating Points */}
          <div className="rounded-xl border border-gray-200 dark:border-neutral-700 bg-white dark:bg-neutral-800 p-5 shadow-sm">
            <div className="flex items-start gap-3 mb-4">
              <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-amber-100">
                <TrendingDown className="h-5 w-5 text-amber-600" />
              </div>
              <div className="min-w-0">
                <p className="text-xs font-medium text-gray-500 dark:text-neutral-400 uppercase tracking-wide">
                  Floating Points
                </p>
              </div>
            </div>
            <p className="font-sans text-2xl font-bold text-gray-900 dark:text-white mb-2">
              {formatPoints(stats?.floating_points ?? 0)}
            </p>
            <p className="text-xs text-gray-500 dark:text-neutral-400">
              unredeemed liability
            </p>
          </div>

          {/* 7 — Avg Lifetime Value */}
          <div className="rounded-xl border border-gray-200 dark:border-neutral-700 bg-white dark:bg-neutral-800 p-5 shadow-sm">
            <div className="flex items-start gap-3 mb-4">
              <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-cyan-100">
                <BarChart3 className="h-5 w-5 text-cyan-600" />
              </div>
              <div className="min-w-0">
                <p className="text-xs font-medium text-gray-500 dark:text-neutral-400 uppercase tracking-wide">
                  Avg Lifetime Value
                </p>
              </div>
            </div>
            <p className="font-sans text-2xl font-bold text-gray-900 dark:text-white mb-2">
              RM {(stats?.avg_lifetime_value_members ?? 0).toLocaleString()}
            </p>
            <p className="text-xs text-gray-500 dark:text-neutral-400">
              non-members{" "}
              <span className="font-sans font-semibold text-gray-700 dark:text-neutral-200">
                RM {(stats?.avg_lifetime_value_nonmembers ?? 0).toLocaleString()}
              </span>
            </p>
          </div>

          {/* 8 — Redemption Rate */}
          <div className="rounded-xl border border-gray-200 dark:border-neutral-700 bg-white dark:bg-neutral-800 p-5 shadow-sm">
            <div className="flex items-start gap-3 mb-4">
              <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-rose-100">
                <Award className="h-5 w-5 text-rose-600" />
              </div>
              <div className="min-w-0">
                <p className="text-xs font-medium text-gray-500 dark:text-neutral-400 uppercase tracking-wide">
                  Redemption Rate
                </p>
              </div>
            </div>
            <p className="font-sans text-2xl font-bold text-gray-900 dark:text-white mb-2">
              {(stats?.reward_redemption_rate ?? 0).toFixed(1)}%
            </p>
            <p className="text-xs text-gray-500 dark:text-neutral-400">
              member txn share{" "}
              <span className="font-sans font-semibold text-gray-700 dark:text-neutral-200">
                {(stats?.member_transaction_pct ?? 0).toFixed(1)}%
              </span>
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
