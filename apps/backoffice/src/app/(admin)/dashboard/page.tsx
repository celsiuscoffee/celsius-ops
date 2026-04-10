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

type ShiftKpi = { shift: string; data: KpiData } | null;

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
  const [kpiAM, setKpiAM] = useState<KpiData | null>(null);
  const [kpiPM, setKpiPM] = useState<KpiData | null>(null);
  const [pickupStats, setPickupStats] = useState<PickupStats | null>(null);
  const { data: ops } = useFetch<OpsPerformance>("/api/ops/performance?from=" + new Date(Date.now() - 7 * 86400000).toISOString().split("T")[0] + "&to=" + new Date().toISOString().split("T")[0]);

  useEffect(() => {
    const base = "/api/loyalty/dashboard/kpi?brand_id=brand-celsius&period=daily";
    // Fetch all three: total, AM, PM
    Promise.all([
      fetch(base, { credentials: "include" }).then((r) => r.ok ? r.json() : null),
      fetch(`${base}&shift=morning`, { credentials: "include" }).then((r) => r.ok ? r.json() : null),
      fetch(`${base}&shift=evening`, { credentials: "include" }).then((r) => r.ok ? r.json() : null),
    ]).then(([all, am, pm]) => {
      if (all) setKpi(all);
      if (am) setKpiAM(am);
      if (pm) setKpiPM(pm);
    }).catch(() => {});
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

      {/* Top row — Key metrics across all modules */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3 mb-6">
        <Link href="/loyalty/members" className="rounded-xl border border-gray-200 bg-white p-4 hover:shadow-md transition-shadow">
          <div className="flex items-center gap-1.5 mb-1"><Target className="h-3.5 w-3.5 text-terracotta" /><span className="text-[10px] text-gray-500">Collection Rate</span></div>
          <p className={`text-2xl font-bold ${kpi && kpi.collection_rate.rate >= 50 ? "text-green-600" : kpi && kpi.collection_rate.rate >= 20 ? "text-orange-500" : "text-gray-400"}`}>
            {kpi ? (kpi.collection_rate.pos_orders === 0 ? "—" : `${kpi.collection_rate.rate}%`) : "—"}
          </p>
        </Link>
        <Link href="/loyalty/members" className="rounded-xl border border-gray-200 bg-white p-4 hover:shadow-md transition-shadow">
          <div className="flex items-center gap-1.5 mb-1"><UserCheck className="h-3.5 w-3.5 text-blue-500" /><span className="text-[10px] text-gray-500">New Members</span></div>
          <p className="text-2xl font-bold text-gray-900">{kpi?.new_members ?? "—"}</p>
        </Link>
        <Link href="/ops/audit" className="rounded-xl border border-gray-200 bg-white p-4 hover:shadow-md transition-shadow">
          <div className="flex items-center gap-1.5 mb-1"><ClipboardCheck className="h-3.5 w-3.5 text-terracotta" /><span className="text-[10px] text-gray-500">Ops Completion</span></div>
          <p className={`text-2xl font-bold ${ops && ops.summary.completionRate >= 80 ? "text-green-600" : "text-amber-600"}`}>{ops?.summary.completionRate ?? "—"}%</p>
        </Link>
        <Link href="/inventory/orders" className="rounded-xl border border-gray-200 bg-white p-4 hover:shadow-md transition-shadow">
          <div className="flex items-center gap-1.5 mb-1"><ShoppingCart className="h-3.5 w-3.5 text-blue-500" /><span className="text-[10px] text-gray-500">Purchase (Week)</span></div>
          <p className="text-2xl font-bold text-gray-900">{invDash ? `RM ${invDash.weeklySpending > 1000 ? `${(invDash.weeklySpending / 1000).toFixed(1)}k` : invDash.weeklySpending.toFixed(0)}` : "—"}</p>
        </Link>
        <Link href="/inventory/reports" className="rounded-xl border border-gray-200 bg-white p-4 hover:shadow-md transition-shadow">
          <div className="flex items-center gap-1.5 mb-1"><Warehouse className="h-3.5 w-3.5 text-emerald-500" /><span className="text-[10px] text-gray-500">Inventory Value</span></div>
          <p className="text-2xl font-bold text-gray-900">{invStats ? `RM ${invStats.inventoryValue > 1000 ? `${(invStats.inventoryValue / 1000).toFixed(1)}k` : invStats.inventoryValue.toFixed(0)}` : "—"}</p>
        </Link>
        <Link href="/inventory/reports" className="rounded-xl border border-gray-200 bg-white p-4 hover:shadow-md transition-shadow">
          <div className="flex items-center gap-1.5 mb-1"><Receipt className="h-3.5 w-3.5 text-orange-500" /><span className="text-[10px] text-gray-500">COGS (Month)</span></div>
          <p className="text-2xl font-bold text-gray-900">{invStats ? `RM ${invStats.cogsThisMonth > 1000 ? `${(invStats.cogsThisMonth / 1000).toFixed(1)}k` : invStats.cogsThisMonth.toFixed(0)}` : "—"}</p>
        </Link>
      </div>

      {/* Alerts */}
      {invDash && (invDash.pendingApprovals > 0 || invDash.deliveriesExpected > 0) && (
        <div className="flex flex-wrap gap-2 mb-6">
          {invDash.pendingApprovals > 0 && (
            <Link href="/inventory/orders" className="rounded-full bg-amber-50 border border-amber-200 px-3 py-1.5 text-xs font-medium text-amber-700 hover:bg-amber-100">⚠️ {invDash.pendingApprovals} orders pending approval</Link>
          )}
          {invDash.deliveriesExpected > 0 && (
            <Link href="/inventory/receivings" className="rounded-full bg-blue-50 border border-blue-200 px-3 py-1.5 text-xs font-medium text-blue-700 hover:bg-blue-100">📦 {invDash.deliveriesExpected} deliveries expected</Link>
          )}
        </div>
      )}

      {/* Detail sections */}
      <div className="grid gap-6 lg:grid-cols-2">
        {/* Loyalty */}
        {kpi && (
          <div className="rounded-xl border border-gray-200 bg-white p-4 sm:p-5">
            <div className="flex items-center justify-between mb-3">
              <h2 className="text-sm font-semibold text-gray-900 flex items-center gap-2">
                <Gift className="h-4 w-4 text-purple-500" />Loyalty (Today)
              </h2>
              <Link href="/loyalty/members" className="text-xs text-terracotta hover:underline">View →</Link>
            </div>
            {/* AM / PM Snapshot */}
            <div className="grid grid-cols-2 gap-3 mb-3">
              {/* AM Shift */}
              <div className="rounded-lg bg-amber-50/60 border border-amber-100 p-3">
                <div className="flex items-center gap-1.5 mb-1">
                  <span className="text-[10px] font-bold text-amber-600 bg-amber-100 rounded px-1.5 py-0.5">AM</span>
                  <span className="text-[10px] text-gray-400">8am – 3:30pm</span>
                </div>
                <p className="text-xl font-bold text-gray-900">
                  {kpiAM && kpiAM.collection_rate.pos_orders > 0
                    ? `${Math.round((kpiAM.returning_members / kpiAM.collection_rate.pos_orders) * 100)}%`
                    : "—"}
                </p>
                <p className="text-[10px] text-gray-400">
                  {kpiAM ? `${kpiAM.returning_members} returning / ${kpiAM.collection_rate.pos_orders} orders` : "Loading..."}
                </p>
                {kpiAM && <p className="text-[10px] font-medium text-green-600 mt-0.5">RM {kpiAM.returning_sales.toLocaleString()}</p>}
              </div>
              {/* PM Shift */}
              <div className="rounded-lg bg-indigo-50/60 border border-indigo-100 p-3">
                <div className="flex items-center gap-1.5 mb-1">
                  <span className="text-[10px] font-bold text-indigo-600 bg-indigo-100 rounded px-1.5 py-0.5">PM</span>
                  <span className="text-[10px] text-gray-400">3:30pm – 11pm</span>
                </div>
                <p className="text-xl font-bold text-gray-900">
                  {kpiPM && kpiPM.collection_rate.pos_orders > 0
                    ? `${Math.round((kpiPM.returning_members / kpiPM.collection_rate.pos_orders) * 100)}%`
                    : "—"}
                </p>
                <p className="text-[10px] text-gray-400">
                  {kpiPM ? `${kpiPM.returning_members} returning / ${kpiPM.collection_rate.pos_orders} orders` : "Loading..."}
                </p>
                {kpiPM && <p className="text-[10px] font-medium text-green-600 mt-0.5">RM {kpiPM.returning_sales.toLocaleString()}</p>}
              </div>
            </div>
            {kpi.collection_rate.outlets.length > 0 && kpi.collection_rate.pos_orders > 0 && (
              <div className="border-t border-gray-100 pt-3">
                <p className="text-[10px] font-medium text-gray-400 uppercase mb-2">Collection by Outlet</p>
                {kpi.collection_rate.outlets.map((o) => (
                  <div key={o.outlet_name} className="flex items-center gap-2 py-1">
                    <Store className="h-3 w-3 text-gray-400 shrink-0" />
                    <span className="text-xs text-gray-600 w-28 truncate">{o.outlet_name}</span>
                    <div className="flex-1 h-1.5 rounded-full bg-gray-100 overflow-hidden">
                      <div className={`h-full rounded-full ${o.claim_rate >= 50 ? "bg-green-500" : o.claim_rate >= 20 ? "bg-orange-400" : "bg-red-400"}`} style={{ width: `${Math.min(o.claim_rate, 100)}%` }} />
                    </div>
                    <span className="text-[10px] text-gray-500 w-14 text-right">{o.loyalty_claims}/{o.pos_orders}</span>
                    <span className={`text-[10px] font-bold w-10 text-right ${o.claim_rate >= 50 ? "text-green-600" : "text-orange-500"}`}>{o.claim_rate}%</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* Ops + Inventory recent orders */}
        <div className="space-y-6">
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
                  <p className="text-2xl font-bold text-gray-900">{ops.summary.totalChecklists}</p>
                  <p className="text-[10px] text-gray-500">Checklists</p>
                </div>
                <div className="rounded-lg bg-gray-50 p-3 text-center">
                  <p className={`text-2xl font-bold ${ops.summary.completionRate >= 80 ? "text-green-600" : "text-amber-600"}`}>{ops.summary.completionRate}%</p>
                  <p className="text-[10px] text-gray-500">Completed</p>
                </div>
                <div className="rounded-lg bg-gray-50 p-3 text-center">
                  <p className="text-2xl font-bold text-gray-900">{ops.summary.photoRate}%</p>
                  <p className="text-[10px] text-gray-500">Photos</p>
                </div>
              </div>
            </div>
          )}

          {/* Recent orders */}
          {invDash?.recentOrders && invDash.recentOrders.length > 0 && (
            <div className="rounded-xl border border-gray-200 bg-white p-4 sm:p-5">
              <div className="flex items-center justify-between mb-3">
                <h2 className="text-sm font-semibold text-gray-900">Recent Orders</h2>
                <Link href="/inventory/orders" className="text-xs text-terracotta hover:underline">All →</Link>
              </div>
              {invDash.recentOrders.slice(0, 5).map((order) => (
                <div key={order.id} className="flex items-center justify-between py-2 border-b border-gray-50 last:border-0">
                  <div className="flex items-center gap-2 min-w-0">
                    <code className="text-[10px] text-terracotta">{order.orderNumber}</code>
                    <span className="text-xs text-gray-600 truncate">{order.supplier}</span>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    <span className="text-xs font-medium">RM {order.totalAmount.toFixed(0)}</span>
                    <Badge className={`text-[8px] px-1.5 py-0 ${STATUS_COLORS[order.status] ?? "bg-gray-400"}`}>
                      {order.status.replace(/_/g, " ").toLowerCase()}
                    </Badge>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
