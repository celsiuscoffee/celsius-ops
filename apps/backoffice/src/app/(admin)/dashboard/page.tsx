"use client";

import { useState, useEffect, useCallback } from "react";
import Link from "next/link";
import {
  ShoppingBag, Boxes, Gift, ArrowRight,
  ShoppingCart, ArrowRightLeft, FileText, AlertTriangle, Loader2,
  Warehouse, Receipt, Target, UserCheck, Repeat, DollarSign, Store,
  ClipboardCheck, CheckCircle2, Clock,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { useFetch } from "@/lib/use-fetch";

type UserProfile = { id: string; name: string; role: string };

type InventoryDashboard = {
  ordersPlaced: number; pendingApprovals: number; deliveriesExpected: number;
  weeklySpending: number; wasteTotal: number; receivingsThisWeek: number;
  stockCheckDone: boolean;
  recentOrders: { id: string; orderNumber: string; supplier: string; status: string; totalAmount: number; createdAt: string }[];
};

type InventoryStats = {
  inventoryValue: number; cogsThisMonth: number;
  invoices: { total: number; pendingAmount: number; overdueAmount: number };
};

type PickupStats = {
  totalSales: number; totalOrders: number;
};

type KpiData = {
  collection_rate: { pos_orders: number; loyalty_claims: number; rate: number; outlets: { outlet_name: string; pos_orders: number; loyalty_claims: number; claim_rate: number }[] };
  new_members: number; returning_members: number; returning_sales: number;
};

type OpsPerformance = {
  summary: { totalChecklists: number; completedChecklists: number; completionRate: number; photoRate: number };
};

const STATUS_COLORS: Record<string, string> = {
  DRAFT: "bg-gray-400", PENDING_APPROVAL: "bg-amber-500", APPROVED: "bg-blue-500",
  SENT: "bg-green-500", AWAITING_DELIVERY: "bg-purple-500", PARTIALLY_RECEIVED: "bg-amber-600",
  COMPLETED: "bg-gray-500", CANCELLED: "bg-red-500",
};

export default function DashboardPage() {
  const { data: user } = useFetch<UserProfile>("/api/auth/me");
  const { data: invDash } = useFetch<InventoryDashboard>("/api/inventory/dashboard");
  const { data: invStats } = useFetch<InventoryStats>("/api/inventory/admin/stats");
  const [kpi, setKpi] = useState<KpiData | null>(null);
  const [pickupStats, setPickupStats] = useState<PickupStats | null>(null);
  const { data: ops } = useFetch<OpsPerformance>("/api/ops/performance?from=" + new Date(Date.now() - 7 * 86400000).toISOString().split("T")[0] + "&to=" + new Date().toISOString().split("T")[0]);

  useEffect(() => {
    fetch("/api/loyalty/dashboard/kpi?brand_id=brand-celsius&period=daily", { credentials: "include" })
      .then((r) => r.ok ? r.json() : null)
      .then((d) => { if (d) setKpi(d); })
      .catch(() => {});
    fetch("/api/pickup/analytics/summary", { credentials: "include" })
      .then((r) => r.ok ? r.json() : null)
      .then((d) => { if (d) setPickupStats(d); })
      .catch(() => {});
  }, []);

  const now = new Date();
  const hour = now.getHours();
  const greeting = hour < 12 ? "Good morning" : hour < 17 ? "Good afternoon" : "Good evening";

  return (
    <div className="p-4 sm:p-6 lg:p-8 overflow-x-hidden">
      {/* Header */}
      <div className="mb-6">
        <h1 className="font-heading text-xl sm:text-2xl font-bold text-foreground">
          {greeting}{user?.name ? `, ${user.name}` : ""}
        </h1>
        <p className="mt-0.5 text-sm text-muted-foreground">
          {now.toLocaleDateString("en-MY", { weekday: "long", day: "numeric", month: "long", year: "numeric" })}
        </p>
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        {/* Left column — Loyalty + Ops */}
        <div className="space-y-6">
          {/* Loyalty KPI */}
          {kpi && (
            <div className="rounded-xl border border-gray-200 bg-white p-4 sm:p-5">
              <div className="flex items-center justify-between mb-3">
                <h2 className="text-sm font-semibold text-gray-900 flex items-center gap-2">
                  <Gift className="h-4 w-4 text-purple-500" />Loyalty (Today)
                </h2>
                <Link href="/loyalty/members" className="text-xs text-terracotta hover:underline">View →</Link>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div className="rounded-lg bg-gray-50 p-3">
                  <div className="flex items-center gap-1.5 mb-1">
                    <Target className="h-3.5 w-3.5 text-terracotta" />
                    <span className="text-[10px] text-gray-500">Collection Rate</span>
                  </div>
                  <p className={`text-xl font-bold ${kpi.collection_rate.rate >= 50 ? "text-green-600" : kpi.collection_rate.rate >= 20 ? "text-orange-500" : "text-red-500"}`}>
                    {kpi.collection_rate.pos_orders === 0 ? "—" : `${kpi.collection_rate.rate}%`}
                  </p>
                  <p className="text-[10px] text-gray-400">{kpi.collection_rate.loyalty_claims}/{kpi.collection_rate.pos_orders} orders</p>
                </div>
                <div className="rounded-lg bg-gray-50 p-3">
                  <div className="flex items-center gap-1.5 mb-1">
                    <UserCheck className="h-3.5 w-3.5 text-blue-500" />
                    <span className="text-[10px] text-gray-500">New Members</span>
                  </div>
                  <p className="text-xl font-bold text-gray-900">{kpi.new_members}</p>
                  <p className="text-[10px] text-gray-400">today</p>
                </div>
                <div className="rounded-lg bg-gray-50 p-3">
                  <div className="flex items-center gap-1.5 mb-1">
                    <Repeat className="h-3.5 w-3.5 text-emerald-500" />
                    <span className="text-[10px] text-gray-500">Returning</span>
                  </div>
                  <p className="text-xl font-bold text-gray-900">{kpi.returning_members}</p>
                  <p className="text-[10px] text-gray-400">2+ visits</p>
                </div>
                <div className="rounded-lg bg-gray-50 p-3">
                  <div className="flex items-center gap-1.5 mb-1">
                    <DollarSign className="h-3.5 w-3.5 text-green-500" />
                    <span className="text-[10px] text-gray-500">Returning Sales</span>
                  </div>
                  <p className="text-xl font-bold text-gray-900">RM {kpi.returning_sales.toLocaleString()}</p>
                </div>
              </div>
              {/* Per-outlet */}
              {kpi.collection_rate.outlets.length > 0 && kpi.collection_rate.pos_orders > 0 && (
                <div className="border-t border-gray-100 mt-3 pt-3">
                  <p className="text-[10px] font-medium text-gray-400 uppercase mb-2">By Outlet</p>
                  {kpi.collection_rate.outlets.map((o) => (
                    <div key={o.outlet_name} className="flex items-center gap-2 py-1">
                      <Store className="h-3 w-3 text-gray-400 shrink-0" />
                      <span className="text-xs text-gray-600 w-24 truncate">{o.outlet_name}</span>
                      <div className="flex-1 h-1.5 rounded-full bg-gray-100 overflow-hidden">
                        <div className={`h-full rounded-full ${o.claim_rate >= 50 ? "bg-green-500" : o.claim_rate >= 20 ? "bg-orange-400" : "bg-red-400"}`} style={{ width: `${Math.min(o.claim_rate, 100)}%` }} />
                      </div>
                      <span className="text-[10px] text-gray-500 w-12 text-right">{o.loyalty_claims}/{o.pos_orders}</span>
                      <span className={`text-[10px] font-bold w-8 text-right ${o.claim_rate >= 50 ? "text-green-600" : "text-orange-500"}`}>{o.claim_rate}%</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* Ops */}
          {ops && (
            <div className="rounded-xl border border-gray-200 bg-white p-4 sm:p-5">
              <div className="flex items-center justify-between mb-3">
                <h2 className="text-sm font-semibold text-gray-900 flex items-center gap-2">
                  <ClipboardCheck className="h-4 w-4 text-terracotta" />Ops (7 days)
                </h2>
                <Link href="/ops/audit" className="text-xs text-terracotta hover:underline">Audit →</Link>
              </div>
              <div className="grid grid-cols-3 gap-3">
                <div className="rounded-lg bg-gray-50 p-3 text-center">
                  <p className="text-xl font-bold text-gray-900">{ops.summary.totalChecklists}</p>
                  <p className="text-[10px] text-gray-500">Checklists</p>
                </div>
                <div className="rounded-lg bg-gray-50 p-3 text-center">
                  <p className={`text-xl font-bold ${ops.summary.completionRate >= 80 ? "text-green-600" : "text-amber-600"}`}>{ops.summary.completionRate}%</p>
                  <p className="text-[10px] text-gray-500">Completed</p>
                </div>
                <div className="rounded-lg bg-gray-50 p-3 text-center">
                  <p className="text-xl font-bold text-gray-900">{ops.summary.photoRate}%</p>
                  <p className="text-[10px] text-gray-500">Photos</p>
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Right column */}
        <div className="space-y-6">
          {/* Inventory */}
          <div className="rounded-xl border border-gray-200 bg-white p-4 sm:p-5">
            <div className="flex items-center justify-between mb-3">
              <h2 className="text-sm font-semibold text-gray-900 flex items-center gap-2">
                <Boxes className="h-4 w-4 text-blue-500" />Inventory
              </h2>
              <Link href="/inventory/orders" className="text-xs text-terracotta hover:underline">Orders →</Link>
            </div>
            <div className="grid grid-cols-3 gap-3">
              <div className="rounded-lg bg-gray-50 p-3 text-center">
                <p className="text-[10px] text-gray-500">Purchase (Week)</p>
                <p className="text-lg font-bold text-gray-900">
                  {invDash ? `RM ${invDash.weeklySpending > 1000 ? `${(invDash.weeklySpending / 1000).toFixed(1)}k` : invDash.weeklySpending.toFixed(0)}` : "—"}
                </p>
                {invDash && <p className="text-[10px] text-gray-400">{invDash.ordersPlaced} orders</p>}
              </div>
              <div className="rounded-lg bg-gray-50 p-3 text-center">
                <p className="text-[10px] text-gray-500">Inventory Value</p>
                <p className="text-lg font-bold text-gray-900">
                  {invStats ? `RM ${invStats.inventoryValue > 1000 ? `${(invStats.inventoryValue / 1000).toFixed(1)}k` : invStats.inventoryValue.toFixed(0)}` : "—"}
                </p>
              </div>
              <div className="rounded-lg bg-gray-50 p-3 text-center">
                <p className="text-[10px] text-gray-500">COGS (Month)</p>
                <p className="text-lg font-bold text-gray-900">
                  {invStats ? `RM ${invStats.cogsThisMonth > 1000 ? `${(invStats.cogsThisMonth / 1000).toFixed(1)}k` : invStats.cogsThisMonth.toFixed(0)}` : "—"}
                </p>
              </div>
            </div>
            {invDash && (invDash.pendingApprovals > 0 || invDash.deliveriesExpected > 0) && (
              <div className="mt-3 flex flex-wrap gap-2">
                {invDash.pendingApprovals > 0 && (
                  <span className="rounded-full bg-amber-50 px-2.5 py-1 text-[10px] font-medium text-amber-700">{invDash.pendingApprovals} pending approval</span>
                )}
                {invDash.deliveriesExpected > 0 && (
                  <span className="rounded-full bg-blue-50 px-2.5 py-1 text-[10px] font-medium text-blue-700">{invDash.deliveriesExpected} deliveries expected</span>
                )}
              </div>
            )}
          </div>

          {/* Pickup */}
          <div className="rounded-xl border border-gray-200 bg-white p-4 sm:p-5">
            <div className="flex items-center justify-between mb-3">
              <h2 className="text-sm font-semibold text-gray-900 flex items-center gap-2">
                <ShoppingBag className="h-4 w-4 text-orange-500" />Pickup (Today)
              </h2>
              <Link href="/pickup/analytics" className="text-xs text-terracotta hover:underline">Analytics →</Link>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="rounded-lg bg-gray-50 p-3 text-center">
                <p className="text-[10px] text-gray-500">Sales</p>
                <p className="text-lg font-bold text-gray-900">
                  {pickupStats ? `RM ${pickupStats.totalSales.toLocaleString()}` : "—"}
                </p>
              </div>
              <div className="rounded-lg bg-gray-50 p-3 text-center">
                <p className="text-[10px] text-gray-500">Orders</p>
                <p className="text-lg font-bold text-gray-900">
                  {pickupStats ? pickupStats.totalOrders.toLocaleString() : "—"}
                </p>
              </div>
            </div>
          </div>

        </div>
      </div>
    </div>
  );
}
