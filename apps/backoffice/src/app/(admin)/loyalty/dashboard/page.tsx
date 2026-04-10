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
  Store,
  Target,
  UserCheck,
  Repeat,
} from "lucide-react";
import { cn } from "@/lib/utils";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type KpiPeriod = "daily" | "weekly" | "monthly" | "custom";
type KpiShift = "all" | "morning" | "evening";

type OutletOption = { id: string; name: string };

type KpiData = {
  period: { from: string; to: string; type: string };
  collection_rate: {
    pos_orders: number;
    loyalty_claims: number;
    rate: number;
    outlets: { outlet_id: string; outlet_name: string; pos_orders: number; loyalty_claims: number; claim_rate: number }[];
  };
  new_members: number;
  returning_members: number;
  returning_sales: number;
  available_outlets: OutletOption[];
  _debug?: string[];
};

type DashboardStats = {
  total_members: number;
  new_members_today: number;
  new_members_this_month: number;
  total_points_issued: number;
  total_points_redeemed: number;
  total_redemptions: number;
  total_revenue_attributed: number;
  active_campaigns: number;
  active_members_30d: number;
  floating_points: number;
  member_transaction_pct: number;
  avg_lifetime_value_members: number;
  avg_lifetime_value_nonmembers: number;
  reward_redemption_rate: number;
  top_spenders: TopSpender[];
  recent_activity: Activity[];
  new_members_by_month: { month: string; count: number }[];
  redemptions_by_month: { month: string; count: number }[];
};

type TopSpender = {
  id: string;
  name: string;
  phone: string;
  total_spent: number;
  total_visits: number;
  total_points_earned: number;
  total_rewards_redeemed: number;
  last_visit_at: string;
};

type Activity = {
  id: string;
  name: string;
  text: string;
  type: "earn" | "redeem" | "bonus";
  date: string;
};

const PERIOD_LABELS: Record<KpiPeriod, string> = {
  daily: "Today",
  weekly: "This Week",
  monthly: "This Month",
  custom: "Custom",
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function formatPoints(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return n.toLocaleString();
}

function formatPhone(phone: string): string {
  const d = phone.replace(/\D/g, "");
  if (d.length === 0) return phone;
  const local = d.startsWith("60") ? d.slice(2) : d.startsWith("0") ? d.slice(1) : d;
  if (local.length <= 2) return `+60 ${local}`;
  if (local.length <= 5) return `+60 ${local.slice(0, 2)}-${local.slice(2)}`;
  return `+60 ${local.slice(0, 2)}-${local.slice(2, 5)} ${local.slice(5)}`;
}

function getTimeAgo(dateStr: string): string {
  const diff = Date.now() - new Date(dateStr).getTime();
  const mins = Math.floor(diff / 60_000);
  if (mins < 1) return "Just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  return `${days}d ago`;
}

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
// Horizontal Bar Chart
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
    <div className="rounded-xl border border-gray-200 bg-white shadow-sm p-5">
      <div className="flex items-center gap-2 mb-4">
        {icon}
        <h3 className="text-sm font-semibold text-gray-900">{label}</h3>
      </div>
      <div className="space-y-2.5">
        {data.map((item) => (
          <div key={item.month} className="flex items-center gap-3">
            <span className="text-xs font-medium text-gray-500 w-16 shrink-0 text-right">
              {item.month}
            </span>
            <div className="flex-1 h-6 bg-gray-100 rounded-md overflow-hidden">
              <div
                className="h-full rounded-md transition-all duration-500"
                style={{
                  width: `${(item.count / maxCount) * 100}%`,
                  backgroundColor: "#C2452D",
                  minWidth: item.count > 0 ? "8px" : "0px",
                }}
              />
            </div>
            <span className="text-xs font-bold text-gray-700 w-10 shrink-0">
              {formatPoints(item.count)}
            </span>
          </div>
        ))}
        {data.length === 0 && (
          <p className="text-sm text-gray-400 text-center py-4">No data available.</p>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export default function LoyaltyDashboard() {
  const [stats, setStats] = useState<DashboardStats | null>(null);
  const [activities, setActivities] = useState<Activity[]>([]);
  const [statsError, setStatsError] = useState(false);

  // KPI state
  const [kpiPeriod, setKpiPeriod] = useState<KpiPeriod>("daily");
  const [kpiOutlet, setKpiOutlet] = useState<string>("all");
  const [kpi, setKpi] = useState<KpiData | null>(null);
  const [kpiLoading, setKpiLoading] = useState(true);
  const [kpiCustomFrom, setKpiCustomFrom] = useState(() => new Date().toISOString().split("T")[0]);
  const [kpiCustomTo, setKpiCustomTo] = useState(() => new Date().toISOString().split("T")[0]);
  const [kpiShift, setKpiShift] = useState<KpiShift>("all");

  // Load KPI data when period or outlet changes
  const loadKpi = useCallback(async (period: KpiPeriod, outlet: string, shift: KpiShift, customFrom?: string, customTo?: string) => {
    setKpiLoading(true);
    try {
      let url: string;
      if (period === "custom" && customFrom && customTo) {
        url = `/api/loyalty/dashboard/kpi?brand_id=brand-celsius&period=custom&from=${customFrom}&to=${customTo}`;
      } else {
        url = `/api/loyalty/dashboard/kpi?brand_id=brand-celsius&period=${period}`;
      }
      if (outlet !== "all") url += `&outlet_id=${outlet}`;
      if (shift !== "all") url += `&shift=${shift}`;
      const res = await fetch(url, { credentials: "include" });
      if (res.ok) {
        setKpi(await res.json());
      }
    } catch { /* ignore */ }
    setKpiLoading(false);
  }, []);

  useEffect(() => {
    if (kpiPeriod === "custom") {
      loadKpi(kpiPeriod, kpiOutlet, kpiShift, kpiCustomFrom, kpiCustomTo);
    } else {
      loadKpi(kpiPeriod, kpiOutlet, kpiShift);
    }
  }, [kpiPeriod, kpiOutlet, kpiShift, kpiCustomFrom, kpiCustomTo, loadKpi]);

  // Load general stats once
  useEffect(() => {
    async function loadStats() {
      try {
        const res = await fetch("/api/loyalty/dashboard/stats?brand_id=brand-celsius", {
          credentials: "include",
        });
        if (!res.ok) throw new Error();
        const data = await res.json();
        setStats(data);
        setActivities(
          (data.recent_activity ?? []).map((a: Activity) => ({
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

  // Loading / error
  if (!stats && !statsError && kpiLoading) {
    return (
      <div className="flex items-center justify-center h-96">
        <div className="flex flex-col items-center gap-3">
          <Loader2 className="h-8 w-8 animate-spin text-[#C2452D]" />
          <p className="text-sm text-gray-500">Loading loyalty dashboard...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="p-6 pb-10 min-h-0 w-full">
      <div className="mb-8">
        <h1 className="text-2xl font-bold text-gray-900">Dashboard</h1>
        <p className="mt-1 text-sm text-gray-500">Overview of your loyalty program performance</p>
      </div>

      <div className="flex flex-col gap-8">
        {/* ═══════════════════════════════════════════════════════════════════ */}
        {/* KEY METRICS — Collection Rate, New Members, Returning Members, Sales */}
        {/* ═══════════════════════════════════════════════════════════════════ */}
        <div className="rounded-xl border border-gray-200 bg-white shadow-sm p-5">
          {/* Header + period toggle */}
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 mb-5">
            <div className="flex items-center gap-2">
              <Target className="h-5 w-5 text-[#C2452D]" />
              <h2 className="text-sm font-semibold text-gray-900">Key Metrics</h2>
              {kpi && (
                <span className="text-xs text-gray-400">
                  {kpi.period.from === kpi.period.to
                    ? kpi.period.from
                    : `${kpi.period.from} — ${kpi.period.to}`}
                </span>
              )}
            </div>
            <div className="flex items-center gap-2">
              {/* Outlet filter */}
              {kpi?.available_outlets && kpi.available_outlets.length > 1 && (
                <select
                  value={kpiOutlet}
                  onChange={(e) => setKpiOutlet(e.target.value)}
                  className="rounded-lg border border-gray-200 bg-white px-2.5 py-1.5 text-xs font-medium text-gray-700 focus:outline-none focus:ring-1 focus:ring-[#C2452D]"
                >
                  <option value="all">All Outlets</option>
                  {kpi.available_outlets.map((o) => (
                    <option key={o.id} value={o.id}>{o.name}</option>
                  ))}
                </select>
              )}
              {/* Shift filter */}
              <div className="flex rounded-lg border border-gray-200 overflow-hidden">
                {([
                  { value: "all", label: "All" },
                  { value: "morning", label: "AM" },
                  { value: "evening", label: "PM" },
                ] as { value: KpiShift; label: string }[]).map((s) => (
                  <button
                    key={s.value}
                    onClick={() => setKpiShift(s.value)}
                    className={cn(
                      "px-2.5 py-1.5 text-xs font-medium transition-colors",
                      kpiShift === s.value
                        ? "bg-gray-800 text-white"
                        : "bg-white text-gray-600 hover:bg-gray-50"
                    )}
                  >
                    {s.label}
                  </button>
                ))}
              </div>
              {/* Period toggle */}
              <div className="flex rounded-lg border border-gray-200 overflow-hidden">
                {(["daily", "weekly", "monthly", "custom"] as KpiPeriod[]).map((p) => (
                  <button
                    key={p}
                    onClick={() => setKpiPeriod(p)}
                    className={cn(
                      "px-3 py-1.5 text-xs font-medium transition-colors capitalize",
                      kpiPeriod === p
                        ? "bg-[#C2452D] text-white"
                        : "bg-white text-gray-600 hover:bg-gray-50"
                    )}
                  >
                    {p}
                  </button>
                ))}
              </div>
            </div>
          </div>

          {/* Custom date pickers */}
          {kpiPeriod === "custom" && (
            <div className="flex items-center gap-2 mb-4">
              <input
                type="date"
                value={kpiCustomFrom}
                onChange={(e) => setKpiCustomFrom(e.target.value)}
                className="rounded-lg border border-gray-200 px-3 py-1.5 text-xs text-gray-700 focus:outline-none focus:ring-1 focus:ring-[#C2452D]"
              />
              <span className="text-xs text-gray-400">to</span>
              <input
                type="date"
                value={kpiCustomTo}
                onChange={(e) => setKpiCustomTo(e.target.value)}
                className="rounded-lg border border-gray-200 px-3 py-1.5 text-xs text-gray-700 focus:outline-none focus:ring-1 focus:ring-[#C2452D]"
              />
            </div>
          )}

          {/* KPI Cards */}
          {kpiLoading ? (
            <div className="flex items-center justify-center py-8">
              <Loader2 className="h-5 w-5 animate-spin text-[#C2452D]" />
            </div>
          ) : kpi ? (
            <>
              <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-5">
                {/* 1 — Collection Rate */}
                <div className="rounded-lg bg-gray-50 p-4">
                  <div className="flex items-center gap-1.5 mb-2">
                    <Target className="h-4 w-4 text-[#C2452D]" />
                    <p className="text-xs font-medium text-gray-500">Collection Rate</p>
                  </div>
                  <p
                    className={`text-2xl font-bold font-sans ${
                      kpi.collection_rate.rate >= 50
                        ? "text-green-600"
                        : kpi.collection_rate.rate >= 20
                          ? "text-orange-500"
                          : kpi.collection_rate.pos_orders === 0
                            ? "text-gray-400"
                            : "text-red-500"
                    }`}
                  >
                    {kpi.collection_rate.pos_orders === 0 ? "—" : `${kpi.collection_rate.rate}%`}
                  </p>
                  <p className="text-xs text-gray-500 mt-1">
                    <span className="font-sans font-semibold text-gray-700">
                      {kpi.collection_rate.loyalty_claims.toLocaleString()}
                    </span>
                    {" / "}
                    <span className="font-sans">
                      {kpi.collection_rate.pos_orders.toLocaleString()}
                    </span>
                    {" orders"}
                  </p>
                </div>

                {/* 2 — New Members */}
                <div className="rounded-lg bg-gray-50 p-4">
                  <div className="flex items-center gap-1.5 mb-2">
                    <UserCheck className="h-4 w-4 text-blue-500" />
                    <p className="text-xs font-medium text-gray-500">New Members</p>
                  </div>
                  <p className="text-2xl font-bold font-sans text-gray-900">
                    {kpi.new_members.toLocaleString()}
                  </p>
                  <p className="text-xs text-gray-500 mt-1">{PERIOD_LABELS[kpiPeriod]}</p>
                </div>

                {/* 3 — Returning Members */}
                <div className="rounded-lg bg-gray-50 p-4">
                  <div className="flex items-center gap-1.5 mb-2">
                    <Repeat className="h-4 w-4 text-emerald-500" />
                    <p className="text-xs font-medium text-gray-500">Returning Members</p>
                  </div>
                  <p className="text-2xl font-bold font-sans text-gray-900">
                    {kpi.returning_members.toLocaleString()}
                  </p>
                  <p className="text-xs text-gray-500 mt-1">2+ visits</p>
                </div>

                {/* 4 — Sales from Returning Members */}
                <div className="rounded-lg bg-gray-50 p-4">
                  <div className="flex items-center gap-1.5 mb-2">
                    <DollarSign className="h-4 w-4 text-green-500" />
                    <p className="text-xs font-medium text-gray-500">Returning Sales</p>
                  </div>
                  <p className="text-2xl font-bold font-sans text-gray-900">
                    RM {kpi.returning_sales.toLocaleString()}
                  </p>
                  <p className="text-xs text-gray-500 mt-1">from returning members</p>
                </div>
              </div>

              {/* Per-outlet collection rate breakdown */}
              {kpi.collection_rate.outlets.length > 0 && kpi.collection_rate.pos_orders > 0 && (
                <div className="border-t border-gray-100 pt-4">
                  <p className="text-xs font-medium text-gray-500 uppercase tracking-wide mb-3">
                    Collection Rate by Outlet
                  </p>
                  <div className="space-y-2">
                    {kpi.collection_rate.outlets.map((o) => (
                      <div key={o.outlet_name} className="flex items-center gap-3">
                        <Store className="h-4 w-4 text-gray-400 shrink-0" />
                        <span className="text-sm text-gray-700 w-32 truncate">{o.outlet_name}</span>
                        <div className="flex-1 h-2 rounded-full bg-gray-100 overflow-hidden">
                          <div
                            className={`h-full rounded-full transition-all ${
                              o.claim_rate >= 50 ? "bg-green-500" : o.claim_rate >= 20 ? "bg-orange-400" : "bg-red-400"
                            }`}
                            style={{ width: `${Math.min(o.claim_rate, 100)}%` }}
                          />
                        </div>
                        <div className="flex items-center gap-2 shrink-0">
                          <span className="text-xs font-sans text-gray-500 w-20 text-right">
                            {o.loyalty_claims.toLocaleString()}/{o.pos_orders.toLocaleString()}
                          </span>
                          <span
                            className={`text-xs font-bold font-sans w-10 text-right ${
                              o.claim_rate >= 50 ? "text-green-600" : o.claim_rate >= 20 ? "text-orange-500" : "text-red-500"
                            }`}
                          >
                            {o.claim_rate}%
                          </span>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </>
          ) : (
            <p className="text-sm text-gray-400 text-center py-4">Failed to load metrics</p>
          )}
        </div>

        {/* ─── Overview Stats ─── */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          <div className="rounded-xl border border-gray-200 bg-white p-5 shadow-sm">
            <div className="flex items-start gap-3 mb-4">
              <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-blue-100">
                <Users className="h-5 w-5 text-blue-600" />
              </div>
              <p className="text-xs font-medium text-gray-500 uppercase tracking-wide">Total Members</p>
            </div>
            <p className="font-sans text-2xl font-bold text-gray-900 mb-2">
              {(stats?.total_members || 0).toLocaleString()}
            </p>
            <p className="text-xs text-gray-500">
              <span className="font-sans font-semibold text-gray-700">
                {formatPoints(stats?.active_members_30d ?? 0)}
              </span>{" "}
              active (30d)
            </p>
          </div>

          <div className="rounded-xl border border-gray-200 bg-white p-5 shadow-sm">
            <div className="flex items-start gap-3 mb-4">
              <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-orange-100">
                <Star className="h-5 w-5 text-orange-600" />
              </div>
              <p className="text-xs font-medium text-gray-500 uppercase tracking-wide">Points Issued</p>
            </div>
            <p className="font-sans text-2xl font-bold text-gray-900 mb-2">
              {formatPoints(stats?.total_points_issued ?? 0)}
            </p>
            <p className="text-xs text-gray-500">
              <span className="font-sans font-semibold text-gray-700">
                {formatPoints(stats?.total_points_redeemed ?? 0)}
              </span>{" "}
              redeemed
            </p>
          </div>

          <div className="rounded-xl border border-gray-200 bg-white p-5 shadow-sm">
            <div className="flex items-start gap-3 mb-4">
              <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-purple-100">
                <Gift className="h-5 w-5 text-purple-600" />
              </div>
              <p className="text-xs font-medium text-gray-500 uppercase tracking-wide">Redemptions</p>
            </div>
            <p className="font-sans text-2xl font-bold text-gray-900 mb-2">
              {(stats?.total_redemptions || 0).toLocaleString()}
            </p>
            <p className="text-xs text-gray-500">
              <span className="font-sans font-semibold text-gray-700">
                {(stats?.active_campaigns || 0).toLocaleString()}
              </span>{" "}
              active campaigns
            </p>
          </div>

          <div className="rounded-xl border border-gray-200 bg-white p-5 shadow-sm">
            <div className="flex items-start gap-3 mb-4">
              <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-green-100">
                <DollarSign className="h-5 w-5 text-green-600" />
              </div>
              <p className="text-xs font-medium text-gray-500 uppercase tracking-wide">Total Sales</p>
            </div>
            <p className="font-sans text-2xl font-bold text-gray-900 mb-2">
              RM {stats?.total_revenue_attributed?.toLocaleString() || "0"}
            </p>
            <p className="text-xs text-gray-500">attributed to loyalty</p>
          </div>
        </div>

        {/* ─── Charts: Trends ─── */}
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

        {/* ─── Top Spenders ─── */}
        {(stats?.top_spenders?.length ?? 0) > 0 && (
          <div className="rounded-xl border border-gray-200 bg-white shadow-sm">
            <div className="border-b border-gray-200 px-4 py-3 flex items-center gap-2">
              <Crown className="h-4 w-4 text-[#C2452D]" />
              <h3 className="text-sm font-semibold text-gray-900">Top Spenders</h3>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full min-w-[700px] text-sm">
                <thead>
                  <tr className="border-b border-gray-100 text-left">
                    <th className="px-4 py-3 text-xs font-medium uppercase tracking-wider text-gray-500 w-12">#</th>
                    <th className="px-3 py-3 text-xs font-medium uppercase tracking-wider text-gray-500">Name</th>
                    <th className="px-3 py-3 text-xs font-medium uppercase tracking-wider text-gray-500">Phone</th>
                    <th className="px-3 py-3 text-xs font-medium uppercase tracking-wider text-gray-500">Total Spent</th>
                    <th className="px-3 py-3 text-xs font-medium uppercase tracking-wider text-gray-500">Visits</th>
                    <th className="px-3 py-3 text-xs font-medium uppercase tracking-wider text-gray-500">Points Earned</th>
                    <th className="px-3 py-3 text-xs font-medium uppercase tracking-wider text-gray-500">Last Visit</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-50">
                  {stats?.top_spenders?.slice(0, 5).map((spender, idx) => (
                    <tr key={spender.id} className="hover:bg-gray-50 transition-colors">
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
                                  : "bg-gray-50 text-gray-500"
                          )}
                        >
                          {idx + 1}
                        </span>
                      </td>
                      <td className="px-3 py-3 font-medium text-gray-900 whitespace-nowrap">
                        {spender.name || "No Name"}
                      </td>
                      <td className="px-3 py-3 font-sans text-gray-700 whitespace-nowrap">
                        {formatPhone(spender.phone)}
                      </td>
                      <td className="px-3 py-3 font-sans font-bold text-gray-900 whitespace-nowrap">
                        RM {spender.total_spent.toLocaleString()}
                      </td>
                      <td className="px-3 py-3 font-sans text-gray-700 whitespace-nowrap">
                        {formatPoints(spender.total_visits)}
                      </td>
                      <td className="px-3 py-3 whitespace-nowrap">
                        <span className="font-sans font-bold text-gray-900">
                          {formatPoints(spender.total_points_earned)}
                        </span>{" "}
                        <span className="text-xs text-gray-400">pts</span>
                      </td>
                      <td className="px-3 py-3 text-gray-500 whitespace-nowrap">
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
          <div className="rounded-xl border border-gray-200 bg-white shadow-sm">
            <div className="border-b border-gray-200 px-5 py-3 flex items-center gap-2">
              <ActivityIcon className="h-4 w-4 text-[#C2452D]" />
              <h2 className="text-sm font-semibold text-gray-900">Recent Activity</h2>
              <span className="ml-auto text-xs text-gray-400">
                Last {activities.length} transactions
              </span>
            </div>
            <div className="divide-y divide-gray-100">
              {activities.map((activity) => (
                <div key={activity.id} className="flex items-center gap-3 px-5 py-3">
                  <div
                    className={cn(
                      "flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-xs font-bold",
                      activityColors[activity.type]
                    )}
                  >
                    {activity.name.charAt(0).toUpperCase()}
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="text-sm text-gray-700 leading-snug">
                      <span className="font-medium text-gray-900">{activity.name}</span>{" "}
                      {activity.text}
                    </p>
                  </div>
                  <span className="shrink-0 text-xs text-gray-400">{getTimeAgo(activity.date)}</span>
                  <div className={cn("h-2 w-2 shrink-0 rounded-full", activityDotColors[activity.type])} />
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
