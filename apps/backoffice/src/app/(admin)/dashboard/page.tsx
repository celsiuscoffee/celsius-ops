"use client";

import { useState, useEffect, useCallback } from "react";
import Link from "next/link";
import {
  ShoppingBag, Boxes, Gift, SlidersHorizontal, ArrowRight,
  ShoppingCart, ArrowRightLeft, FileText, AlertTriangle, Loader2,
  Warehouse, Calculator, Scale, Receipt, Target, UserCheck, Repeat, DollarSign, Store,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { useFetch } from "@/lib/use-fetch";

// ── Types ──────────────────────────────────────────────────────────────────

type UserProfile = { id: string; name: string; role: string };

type ExpectedVsReal = {
  expectedValue: number; realValue: number; difference: number;
  itemsWithVariance: number; totalItems: number; countDate: string; outlet: string;
};

type InventoryStats = {
  products: number; suppliers: number; categories: number; outlets: number;
  staff: number; menus: number;
  invoices: { total: number; pendingAmount: number; overdueAmount: number };
  inventoryValue: number; cogsThisMonth: number;
  expectedVsReal: ExpectedVsReal | null;
};

type InventoryDashboard = {
  ordersPlaced: number; pendingApprovals: number; deliveriesExpected: number;
  deliverySuppliers: string[]; weeklySpending: number; wasteTotal: number;
  receivingsThisWeek: number; stockCheckDone: boolean; lastCheckTime: string | null;
  recentOrders: { id: string; orderNumber: string; supplier: string; status: string; totalAmount: number; createdAt: string }[];
};

const STATUS_COLORS: Record<string, string> = {
  DRAFT: "bg-gray-400", PENDING_APPROVAL: "bg-amber-500", APPROVED: "bg-blue-500",
  SENT: "bg-green-500", AWAITING_DELIVERY: "bg-purple-500", PARTIALLY_RECEIVED: "bg-amber-600",
  COMPLETED: "bg-gray-500", CANCELLED: "bg-red-500",
};

// ── Tab definitions ────────────────────────────────────────────────────────

type Tab = "overview" | "inventory" | "loyalty" | "pickup";

const TABS: { id: Tab; label: string; icon: React.ReactNode }[] = [
  { id: "overview", label: "Overview", icon: <SlidersHorizontal className="h-4 w-4" /> },
  { id: "pickup", label: "Pickup", icon: <ShoppingBag className="h-4 w-4" /> },
  { id: "inventory", label: "Inventory", icon: <Boxes className="h-4 w-4" /> },
  { id: "loyalty", label: "Loyalty", icon: <Gift className="h-4 w-4" /> },
];

const SECTIONS = [
  { title: "Pickup App", description: "Orders, menus, analytics", icon: ShoppingBag, href: "/pickup/orders", color: "bg-orange-50 text-orange-600 border-orange-200", iconBg: "bg-orange-100" },
  { title: "Inventory", description: "Products, POs, stock", icon: Boxes, href: "/inventory/products", color: "bg-blue-50 text-blue-600 border-blue-200", iconBg: "bg-blue-100" },
  { title: "Loyalty", description: "Members, rewards, campaigns", icon: Gift, href: "/loyalty/members", color: "bg-purple-50 text-purple-600 border-purple-200", iconBg: "bg-purple-100" },
  { title: "Settings", description: "Outlets, staff, integrations", icon: SlidersHorizontal, href: "/settings/outlets", color: "bg-gray-50 text-gray-600 border-gray-200", iconBg: "bg-gray-100" },
];

// ── Main Dashboard ─────────────────────────────────────────────────────────

export default function DashboardPage() {
  const [tab, setTab] = useState<Tab>("overview");
  const { data: user } = useFetch<UserProfile>("/api/auth/me");

  return (
    <div className="p-6 lg:p-8">
      {/* Welcome */}
      <div className="mb-6">
        <h1 className="font-heading text-2xl font-bold text-foreground">
          Welcome back{user?.name ? `, ${user.name}` : ""}
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Celsius Ops — manage all your operations from one place.
        </p>
      </div>

      {/* Tab bar */}
      <div className="mb-6 flex gap-1 rounded-lg bg-gray-100 p-1">
        {TABS.map((t) => (
          <button
            key={t.id}
            onClick={() => setTab(t.id)}
            className={`flex items-center gap-2 rounded-md px-4 py-2 text-sm font-medium transition-colors ${
              tab === t.id
                ? "bg-white text-gray-900 shadow-sm"
                : "text-gray-500 hover:text-gray-700"
            }`}
          >
            {t.icon}
            {t.label}
          </button>
        ))}
      </div>

      {/* Tab content */}
      {tab === "overview" && <OverviewTab />}
      {tab === "inventory" && <InventoryTab />}
      {tab === "loyalty" && <LoyaltyTab />}
      {tab === "pickup" && <PickupTab />}
    </div>
  );
}

// ── Overview Tab ───────────────────────────────────────────────────────────

function OverviewTab() {
  return (
    <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
      {SECTIONS.map((section) => {
        const Icon = section.icon;
        return (
          <Link key={section.title} href={section.href} className={`group flex flex-col rounded-xl border p-5 transition-all hover:shadow-md ${section.color}`}>
            <div className={`mb-4 inline-flex h-10 w-10 items-center justify-center rounded-lg ${section.iconBg}`}>
              <Icon className="h-5 w-5" />
            </div>
            <h2 className="text-base font-semibold">{section.title}</h2>
            <p className="mt-1 flex-1 text-xs opacity-70">{section.description}</p>
            <div className="mt-4 flex items-center gap-1 text-xs font-medium opacity-60 group-hover:opacity-100 transition-opacity">
              Open <ArrowRight className="h-3 w-3" />
            </div>
          </Link>
        );
      })}
    </div>
  );
}

// ── Inventory Tab ──────────────────────────────────────────────────────────

function InventoryTab() {
  const { data: stats, isLoading: l1 } = useFetch<InventoryStats>("/api/inventory/admin/stats");
  const { data: dashboard, isLoading: l2 } = useFetch<InventoryDashboard>("/api/inventory/dashboard");

  if (l1 || l2) return <div className="flex justify-center py-12"><Loader2 className="h-6 w-6 animate-spin text-terracotta" /></div>;
  if (!stats || !dashboard) return <div className="flex flex-col items-center py-12"><AlertTriangle className="h-8 w-8 text-amber-500" /><p className="mt-2 text-sm text-gray-500">Failed to load inventory data</p></div>;

  const fmt = (v: number) => v.toLocaleString("en-MY", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

  return (
    <div>
      {/* Financial metrics */}
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <Link href="/inventory/reports/stock-valuation" className="rounded-xl border border-gray-200 bg-white p-4 hover:shadow-md">
          <div className="flex items-center gap-3">
            <div className="rounded-lg bg-emerald-50 p-2"><Warehouse className="h-5 w-5 text-emerald-600" /></div>
            <div>
              <p className="text-xs text-gray-500">Inventory Asset Value</p>
              <p className="text-xl font-bold text-gray-900">RM {fmt(stats.inventoryValue)}</p>
            </div>
          </div>
        </Link>
        <div className="rounded-xl border border-gray-200 bg-white p-4">
          <div className="flex items-center gap-3">
            <div className="rounded-lg bg-orange-50 p-2"><Calculator className="h-5 w-5 text-orange-600" /></div>
            <div>
              <p className="text-xs text-gray-500">COGS This Month</p>
              <p className="text-xl font-bold text-gray-900">RM {fmt(stats.cogsThisMonth)}</p>
            </div>
          </div>
        </div>
        <Link href="/inventory/orders" className="rounded-xl border border-gray-200 bg-white p-4 hover:shadow-md">
          <div className="flex items-center gap-3">
            <div className="rounded-lg bg-violet-50 p-2"><Receipt className="h-5 w-5 text-violet-600" /></div>
            <div>
              <p className="text-xs text-gray-500">Purchase This Week</p>
              <p className="text-xl font-bold text-gray-900">RM {fmt(dashboard.weeklySpending)}</p>
              <p className="text-[10px] text-gray-400">{dashboard.ordersPlaced} orders placed</p>
            </div>
          </div>
        </Link>
        <Link href="/inventory/reports/stock-valuation" className="rounded-xl border border-gray-200 bg-white p-4 hover:shadow-md">
          <div className="flex items-center gap-3">
            <div className={`rounded-lg p-2 ${stats.expectedVsReal && stats.expectedVsReal.difference < 0 ? "bg-red-50" : "bg-blue-50"}`}>
              <Scale className={`h-5 w-5 ${stats.expectedVsReal && stats.expectedVsReal.difference < 0 ? "text-red-600" : "text-blue-600"}`} />
            </div>
            <div>
              <p className="text-xs text-gray-500">Expected vs Real</p>
              {stats.expectedVsReal ? (
                <>
                  <p className={`text-xl font-bold ${stats.expectedVsReal.difference < 0 ? "text-red-600" : stats.expectedVsReal.difference > 0 ? "text-green-600" : "text-gray-900"}`}>
                    {stats.expectedVsReal.difference > 0 ? "+" : ""}RM {fmt(stats.expectedVsReal.difference)}
                  </p>
                  <p className="text-[10px] text-gray-400">{stats.expectedVsReal.itemsWithVariance} items with variance</p>
                </>
              ) : (
                <p className="text-sm text-gray-400">No stock count yet</p>
              )}
            </div>
          </div>
        </Link>
      </div>

      {/* Ordering overview */}
      <div className="mt-6 grid grid-cols-3 gap-4">
        <Link href="/inventory/orders" className="rounded-xl border border-gray-200 bg-white p-4 hover:shadow-md">
          <div className="flex items-center gap-3">
            <div className="rounded-lg bg-terracotta/10 p-2"><ShoppingCart className="h-5 w-5 text-terracotta" /></div>
            <div>
              <p className="text-2xl font-bold text-gray-900">{dashboard.ordersPlaced}</p>
              <p className="text-sm text-gray-500">Purchase Orders</p>
            </div>
          </div>
          {(dashboard.pendingApprovals + dashboard.deliveriesExpected) > 0 && (
            <p className="mt-2 text-xs text-terracotta font-medium">{dashboard.pendingApprovals + dashboard.deliveriesExpected} active</p>
          )}
        </Link>
        <Link href="/inventory/receivings" className="rounded-xl border border-gray-200 bg-white p-4 hover:shadow-md">
          <div className="flex items-center gap-3">
            <div className="rounded-lg bg-blue-50 p-2"><ArrowRightLeft className="h-5 w-5 text-blue-600" /></div>
            <div>
              <p className="text-2xl font-bold text-gray-900">{dashboard.receivingsThisWeek}</p>
              <p className="text-sm text-gray-500">Receivings</p>
            </div>
          </div>
        </Link>
        <Link href="/inventory/invoices" className="rounded-xl border border-gray-200 bg-white p-4 hover:shadow-md">
          <div className="flex items-center gap-3">
            <div className="rounded-lg bg-green-50 p-2"><FileText className="h-5 w-5 text-green-600" /></div>
            <div>
              <p className="text-2xl font-bold text-gray-900">{stats.invoices.total}</p>
              <p className="text-sm text-gray-500">Invoices</p>
            </div>
          </div>
          <div className="mt-2 flex gap-3">
            {stats.invoices.pendingAmount > 0 && <p className="text-xs text-terracotta font-medium">RM {stats.invoices.pendingAmount.toFixed(0)} pending</p>}
            {stats.invoices.overdueAmount > 0 && <p className="text-xs text-red-600 font-medium">RM {stats.invoices.overdueAmount.toFixed(0)} overdue</p>}
          </div>
        </Link>
      </div>

      {/* Recent orders */}
      {dashboard.recentOrders && dashboard.recentOrders.length > 0 && (
        <div className="mt-6">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-semibold text-gray-900">Recent Orders</h3>
            <Link href="/inventory/orders" className="text-xs text-terracotta hover:underline">View all</Link>
          </div>
          <div className="mt-2 rounded-xl border border-gray-200 bg-white">
            {dashboard.recentOrders.map((order, idx) => (
              <div key={idx} className={`flex items-center justify-between px-4 py-3 ${idx > 0 ? "border-t border-gray-50" : ""}`}>
                <div className="flex items-center gap-3">
                  <code className="rounded bg-gray-100 px-1.5 py-0.5 text-xs font-medium text-terracotta">{order.orderNumber}</code>
                  <span className="text-sm text-gray-700">{order.supplier}</span>
                </div>
                <div className="flex items-center gap-3">
                  <span className="text-sm font-medium text-gray-900">RM {order.totalAmount.toFixed(2)}</span>
                  <Badge className={`text-[10px] ${STATUS_COLORS[order.status] ?? "bg-gray-400"}`}>
                    {order.status.replace(/_/g, " ").toLowerCase()}
                  </Badge>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

// ── Loyalty Tab ────────────────────────────────────────────────────────────

type KpiPeriod = "daily" | "weekly" | "monthly";
type KpiData = {
  period: { from: string; to: string; type: string };
  collection_rate: { pos_orders: number; loyalty_claims: number; rate: number; outlets: { outlet_id: string; outlet_name: string; pos_orders: number; loyalty_claims: number; claim_rate: number }[] };
  new_members: number;
  returning_members: number;
  returning_sales: number;
  available_outlets: { id: string; name: string }[];
  _debug?: string[];
};

const KPI_PERIOD_LABELS: Record<KpiPeriod, string> = { daily: "Today", weekly: "This Week", monthly: "This Month" };

function LoyaltyTab() {
  const { data, isLoading } = useFetch<{ total_members: number; active_members_30d: number; total_points_issued: number; total_redemptions: number; total_revenue_attributed: number }>("/api/loyalty/dashboard/stats?brand_id=brand-celsius");
  const [kpiPeriod, setKpiPeriod] = useState<KpiPeriod>("daily");
  const [kpiOutlet, setKpiOutlet] = useState<string>("all");
  const [kpi, setKpi] = useState<KpiData | null>(null);
  const [kpiLoading, setKpiLoading] = useState(true);

  const loadKpi = useCallback(async (period: KpiPeriod, outlet: string) => {
    setKpiLoading(true);
    try {
      let url = `/api/loyalty/dashboard/kpi?brand_id=brand-celsius&period=${period}`;
      if (outlet !== "all") url += `&outlet_id=${outlet}`;
      const res = await fetch(url, { credentials: "include" });
      if (res.ok) setKpi(await res.json());
    } catch { /* ignore */ }
    setKpiLoading(false);
  }, []);

  useEffect(() => { loadKpi(kpiPeriod, kpiOutlet); }, [kpiPeriod, kpiOutlet, loadKpi]);

  if (isLoading && kpiLoading) return <div className="flex justify-center py-12"><Loader2 className="h-6 w-6 animate-spin text-terracotta" /></div>;

  const fmt = (v: number) => v.toLocaleString("en-MY");

  return (
    <div className="space-y-4">
      {/* Key Metrics with period toggle */}
      <div className="rounded-xl border border-gray-200 bg-white p-5 shadow-sm">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 mb-4">
          <div className="flex items-center gap-2">
            <Target className="h-5 w-5 text-terracotta" />
            <h2 className="text-sm font-semibold text-gray-900">Key Metrics</h2>
            {kpi && (
              <span className="text-xs text-gray-400">
                {kpi.period.from === kpi.period.to ? kpi.period.from : `${kpi.period.from} — ${kpi.period.to}`}
              </span>
            )}
          </div>
          <div className="flex items-center gap-2">
            {kpi?.available_outlets && kpi.available_outlets.length > 1 && (
              <select
                value={kpiOutlet}
                onChange={(e) => setKpiOutlet(e.target.value)}
                className="rounded-lg border border-gray-200 bg-white px-2.5 py-1.5 text-xs font-medium text-gray-700 focus:outline-none focus:ring-1 focus:ring-terracotta"
              >
                <option value="all">All Outlets</option>
                {kpi.available_outlets.map((o) => (
                  <option key={o.id} value={o.id}>{o.name}</option>
                ))}
              </select>
            )}
            <div className="flex rounded-lg border border-gray-200 overflow-hidden">
              {(["daily", "weekly", "monthly"] as KpiPeriod[]).map((p) => (
                <button
                  key={p}
                  onClick={() => setKpiPeriod(p)}
                  className={`px-3 py-1.5 text-xs font-medium transition-colors capitalize ${
                    kpiPeriod === p ? "bg-terracotta text-white" : "bg-white text-gray-600 hover:bg-gray-50"
                  }`}
                >
                  {p}
                </button>
              ))}
            </div>
          </div>
        </div>

        {kpiLoading ? (
          <div className="flex items-center justify-center py-8"><Loader2 className="h-5 w-5 animate-spin text-terracotta" /></div>
        ) : kpi ? (
          <>
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-4">
              {/* Collection Rate */}
              <div className="rounded-lg bg-gray-50 p-4">
                <div className="flex items-center gap-1.5 mb-2">
                  <Target className="h-4 w-4 text-terracotta" />
                  <p className="text-xs font-medium text-gray-500">Collection Rate</p>
                </div>
                <p className={`text-2xl font-bold font-sans ${
                  kpi.collection_rate.rate >= 50 ? "text-green-600" : kpi.collection_rate.rate >= 20 ? "text-orange-500" : kpi.collection_rate.pos_orders === 0 ? "text-gray-400" : "text-red-500"
                }`}>
                  {kpi.collection_rate.pos_orders === 0 ? "—" : `${kpi.collection_rate.rate}%`}
                </p>
                <p className="text-xs text-gray-500 mt-1">
                  <span className="font-semibold text-gray-700">{kpi.collection_rate.loyalty_claims.toLocaleString()}</span>
                  {" / "}{kpi.collection_rate.pos_orders.toLocaleString()} orders
                </p>
              </div>

              {/* New Members */}
              <div className="rounded-lg bg-gray-50 p-4">
                <div className="flex items-center gap-1.5 mb-2">
                  <UserCheck className="h-4 w-4 text-blue-500" />
                  <p className="text-xs font-medium text-gray-500">New Members</p>
                </div>
                <p className="text-2xl font-bold font-sans text-gray-900">{kpi.new_members.toLocaleString()}</p>
                <p className="text-xs text-gray-500 mt-1">{KPI_PERIOD_LABELS[kpiPeriod]}</p>
              </div>

              {/* Returning Members */}
              <div className="rounded-lg bg-gray-50 p-4">
                <div className="flex items-center gap-1.5 mb-2">
                  <Repeat className="h-4 w-4 text-emerald-500" />
                  <p className="text-xs font-medium text-gray-500">Returning Members</p>
                </div>
                <p className="text-2xl font-bold font-sans text-gray-900">{kpi.returning_members.toLocaleString()}</p>
                <p className="text-xs text-gray-500 mt-1">2+ visits</p>
              </div>

              {/* Returning Sales */}
              <div className="rounded-lg bg-gray-50 p-4">
                <div className="flex items-center gap-1.5 mb-2">
                  <DollarSign className="h-4 w-4 text-green-500" />
                  <p className="text-xs font-medium text-gray-500">Returning Sales</p>
                </div>
                <p className="text-2xl font-bold font-sans text-gray-900">RM {kpi.returning_sales.toLocaleString()}</p>
                <p className="text-xs text-gray-500 mt-1">from returning members</p>
              </div>
            </div>

            {/* Per-outlet breakdown */}
            {kpi.collection_rate.outlets.length > 0 && kpi.collection_rate.pos_orders > 0 && (
              <div className="border-t border-gray-100 pt-3">
                <p className="text-xs font-medium text-gray-500 uppercase tracking-wide mb-2">Collection Rate by Outlet</p>
                <div className="space-y-2">
                  {kpi.collection_rate.outlets.map((o) => (
                    <div key={o.outlet_name} className="flex items-center gap-3">
                      <Store className="h-4 w-4 text-gray-400 shrink-0" />
                      <span className="text-sm text-gray-700 w-32 truncate">{o.outlet_name}</span>
                      <div className="flex-1 h-2 rounded-full bg-gray-100 overflow-hidden">
                        <div className={`h-full rounded-full transition-all ${o.claim_rate >= 50 ? "bg-green-500" : o.claim_rate >= 20 ? "bg-orange-400" : "bg-red-400"}`} style={{ width: `${Math.min(o.claim_rate, 100)}%` }} />
                      </div>
                      <span className="text-xs font-sans text-gray-500 w-20 text-right shrink-0">{o.loyalty_claims}/{o.pos_orders}</span>
                      <span className={`text-xs font-bold font-sans w-10 text-right shrink-0 ${o.claim_rate >= 50 ? "text-green-600" : o.claim_rate >= 20 ? "text-orange-500" : "text-red-500"}`}>{o.claim_rate}%</span>
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

      {/* Overview stats */}
      {data && (
        <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
          <Link href="/loyalty/members" className="rounded-xl border border-gray-200 bg-white p-4 hover:shadow-md">
            <p className="text-xs text-gray-500">Total Members</p>
            <p className="text-2xl font-bold text-gray-900">{fmt(data.total_members || 0)}</p>
            <p className="mt-1 text-[10px] text-gray-400">{fmt(data.active_members_30d || 0)} active</p>
          </Link>
          <Link href="/loyalty/rewards" className="rounded-xl border border-gray-200 bg-white p-4 hover:shadow-md">
            <p className="text-xs text-gray-500">Points Issued</p>
            <p className="text-2xl font-bold text-gray-900">{fmt(data.total_points_issued || 0)}</p>
          </Link>
          <Link href="/loyalty/redemptions" className="rounded-xl border border-gray-200 bg-white p-4 hover:shadow-md">
            <p className="text-xs text-gray-500">Redemptions</p>
            <p className="text-2xl font-bold text-gray-900">{fmt(data.total_redemptions || 0)}</p>
          </Link>
          <Link href="/loyalty/dashboard" className="rounded-xl border border-gray-200 bg-white p-4 hover:shadow-md">
            <p className="text-xs text-gray-500">Revenue from Loyalty</p>
            <p className="text-2xl font-bold text-gray-900">RM {(data.total_revenue_attributed || 0).toLocaleString("en-MY", { minimumFractionDigits: 2 })}</p>
          </Link>
        </div>
      )}
    </div>
  );
}

// ── Pickup Tab ─────────────────────────────────────────────────────────────

function PickupTab() {
  return (
    <div>
      <div className="mb-4 flex items-center justify-between">
        <h3 className="text-lg font-semibold text-gray-900">Pickup Dashboard</h3>
        <Link href="/pickup/orders" className="text-sm text-terracotta hover:underline">View all orders →</Link>
      </div>
      <div className="rounded-xl border-2 border-dashed border-gray-200 p-8 text-center">
        <ShoppingBag className="mx-auto h-10 w-10 text-gray-300" />
        <p className="mt-3 text-sm font-medium text-gray-400">Pickup dashboard with charts</p>
        <p className="mt-1 text-xs text-gray-300">View the full pickup dashboard at the Pickup section</p>
        <Link href="/pickup/analytics" className="mt-4 inline-block rounded-lg bg-terracotta px-4 py-2 text-sm font-medium text-white hover:bg-terracotta-dark">
          Open Analytics
        </Link>
      </div>
    </div>
  );
}
