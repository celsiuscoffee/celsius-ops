"use client";

import Link from "next/link";
import {
  Boxes, ShoppingCart, Receipt, AlertTriangle, Trash2, Warehouse,
  Truck, FileText, HandCoins, Package,
} from "lucide-react";
import { useFetch } from "@/lib/use-fetch";
import { Badge } from "@/components/ui/badge";

type InventoryDashboard = {
  ordersPlaced: number;
  pendingApprovals: number;
  deliveriesExpected: number;
  weeklySpending: number;
  wasteTotal: number;
  receivingsThisWeek: number;
  stockCheckDone: boolean;
  recentOrders: { id: string; orderNumber: string; supplier: string; status: string; totalAmount: number; createdAt: string }[];
};

type InventoryStats = {
  inventoryValue: number;
  cogsThisMonth: number;
  invoices: { total: number; pendingAmount: number; overdueAmount: number };
  products: number;
  suppliers: number;
};

const STATUS_COLORS: Record<string, string> = {
  DRAFT: "bg-gray-400", PENDING_APPROVAL: "bg-amber-500", APPROVED: "bg-blue-500",
  SENT: "bg-green-500", AWAITING_DELIVERY: "bg-purple-500", PARTIALLY_RECEIVED: "bg-amber-600",
  COMPLETED: "bg-gray-500", CANCELLED: "bg-red-500",
};

function rm(v: number | undefined | null): string {
  const n = Number(v ?? 0);
  if (n >= 1000) return `RM ${(n / 1000).toFixed(1)}k`;
  return `RM ${n.toFixed(0)}`;
}

function Tile({ href, icon: Icon, label, value, accent, sub }: {
  href: string;
  icon: React.ElementType;
  label: string;
  value: string | null;
  accent: string;
  sub?: string;
}) {
  return (
    <Link href={href} className="rounded-xl border border-gray-200 bg-white p-4 hover:shadow-md transition-shadow">
      <div className="flex items-center gap-1.5 mb-1">
        <Icon className={`h-3.5 w-3.5 ${accent}`} />
        <span className="text-[10px] text-gray-500">{label}</span>
      </div>
      {value !== null
        ? <p className="text-2xl font-bold text-gray-900">{value}</p>
        : <div className="h-8 w-20 bg-gray-200 rounded animate-pulse mt-0.5" />}
      {sub && <p className="text-[10px] text-gray-400 mt-0.5">{sub}</p>}
    </Link>
  );
}

export default function ProcurementDashboardPage() {
  const { data: dash } = useFetch<InventoryDashboard>("/api/inventory/dashboard");
  const { data: stats } = useFetch<InventoryStats>("/api/inventory/admin/stats");

  return (
    <div className="p-4 sm:p-6 lg:p-8 overflow-x-hidden">
      <div className="mb-6">
        <h1 className="font-heading text-xl sm:text-2xl font-bold text-foreground flex items-center gap-2">
          <Boxes className="h-6 w-6 text-terracotta" /> Procurement
        </h1>
        <p className="mt-0.5 text-sm text-muted-foreground">Stock value, purchasing, invoices, and waste at a glance.</p>
      </div>

      {/* Top KPIs */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3 mb-6">
        <Tile
          href="/inventory/reports"
          icon={Warehouse}
          accent="text-emerald-500"
          label="Inventory Value"
          value={stats ? rm(stats.inventoryValue) : null}
        />
        <Tile
          href="/inventory/reports"
          icon={Receipt}
          accent="text-orange-500"
          label="COGS (Month)"
          value={stats ? rm(stats.cogsThisMonth) : null}
        />
        <Tile
          href="/inventory/orders"
          icon={ShoppingCart}
          accent="text-blue-500"
          label="Spend (Week)"
          value={dash ? rm(dash.weeklySpending) : null}
          sub={dash ? `${dash.ordersPlaced} POs placed` : undefined}
        />
        <Tile
          href="/inventory/orders?status=PENDING_APPROVAL"
          icon={AlertTriangle}
          accent={dash && dash.pendingApprovals > 0 ? "text-amber-600" : "text-gray-400"}
          label="Pending Approvals"
          value={dash ? String(dash.pendingApprovals) : null}
        />
        <Tile
          href="/inventory/invoices"
          icon={FileText}
          accent="text-blue-500"
          label="Invoices Due"
          value={stats ? rm(stats.invoices.pendingAmount) : null}
          sub={stats ? `${stats.invoices.total} total` : undefined}
        />
        <Tile
          href="/inventory/wastage"
          icon={Trash2}
          accent="text-red-500"
          label="Waste (Week)"
          value={dash ? rm(dash.wasteTotal) : null}
        />
      </div>

      {/* Alerts */}
      <div className="flex flex-wrap gap-2 mb-6">
        {dash && dash.pendingApprovals > 0 && (
          <Link href="/inventory/orders?status=PENDING_APPROVAL" className="rounded-full bg-amber-50 border border-amber-200 px-3 py-1.5 text-xs font-medium text-amber-700 hover:bg-amber-100">
            ⚠️ {dash.pendingApprovals} {dash.pendingApprovals === 1 ? "PO" : "POs"} awaiting approval
          </Link>
        )}
        {stats && stats.invoices.overdueAmount > 0 && (
          <Link href="/inventory/invoices?status=OVERDUE" className="rounded-full bg-red-50 border border-red-200 px-3 py-1.5 text-xs font-medium text-red-700 hover:bg-red-100">
            🚨 {rm(stats.invoices.overdueAmount)} overdue invoices
          </Link>
        )}
        {dash && dash.deliveriesExpected > 0 && (
          <Link href="/inventory/receivings" className="rounded-full bg-purple-50 border border-purple-200 px-3 py-1.5 text-xs font-medium text-purple-700 hover:bg-purple-100">
            📦 {dash.deliveriesExpected} {dash.deliveriesExpected === 1 ? "delivery" : "deliveries"} expected
          </Link>
        )}
        {dash && !dash.stockCheckDone && (
          <Link href="/inventory/stock-count" className="rounded-full bg-orange-50 border border-orange-200 px-3 py-1.5 text-xs font-medium text-orange-700 hover:bg-orange-100">
            📋 No stock count today
          </Link>
        )}
      </div>

      {/* Detail */}
      <div className="grid gap-6 lg:grid-cols-2">
        {/* Recent orders */}
        <div className="rounded-xl border border-gray-200 bg-white p-4 sm:p-5">
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-sm font-semibold text-gray-900 flex items-center gap-2">
              <ShoppingCart className="h-4 w-4 text-blue-500" /> Recent Purchase Orders
            </h2>
            <Link href="/inventory/orders" className="text-xs text-terracotta hover:underline">All →</Link>
          </div>
          {!dash ? (
            <div className="space-y-2">
              {[1,2,3,4,5].map(i => <div key={i} className="h-8 bg-gray-100 rounded animate-pulse" />)}
            </div>
          ) : dash.recentOrders.length === 0 ? (
            <p className="text-xs text-gray-400 py-6 text-center">No recent orders</p>
          ) : (
            dash.recentOrders.slice(0, 6).map((order) => (
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
            ))
          )}
        </div>

        {/* Operations summary */}
        <div className="space-y-6">
          <div className="rounded-xl border border-gray-200 bg-white p-4 sm:p-5">
            <h2 className="text-sm font-semibold text-gray-900 flex items-center gap-2 mb-3">
              <Package className="h-4 w-4 text-terracotta" /> This Week
            </h2>
            <div className="grid grid-cols-3 gap-3">
              <div className="rounded-lg bg-gray-50 p-3 text-center">
                <p className="text-2xl font-bold text-gray-900">{dash?.ordersPlaced ?? "—"}</p>
                <p className="text-[10px] text-gray-500">POs Placed</p>
              </div>
              <div className="rounded-lg bg-gray-50 p-3 text-center">
                <p className="text-2xl font-bold text-gray-900">{dash?.receivingsThisWeek ?? "—"}</p>
                <p className="text-[10px] text-gray-500">Receivings</p>
              </div>
              <div className="rounded-lg bg-gray-50 p-3 text-center">
                <p className="text-2xl font-bold text-gray-900">{dash?.deliveriesExpected ?? "—"}</p>
                <p className="text-[10px] text-gray-500">Pending</p>
              </div>
            </div>
          </div>

          <div className="rounded-xl border border-gray-200 bg-white p-4 sm:p-5">
            <h2 className="text-sm font-semibold text-gray-900 flex items-center gap-2 mb-3">
              <HandCoins className="h-4 w-4 text-emerald-600" /> Catalog
            </h2>
            <div className="grid grid-cols-2 gap-3">
              <Link href="/inventory/products" className="rounded-lg bg-gray-50 hover:bg-gray-100 p-3 text-center transition-colors">
                <p className="text-2xl font-bold text-gray-900">{stats?.products ?? "—"}</p>
                <p className="text-[10px] text-gray-500">Active products</p>
              </Link>
              <Link href="/inventory/suppliers" className="rounded-lg bg-gray-50 hover:bg-gray-100 p-3 text-center transition-colors">
                <div className="flex items-center justify-center gap-1.5">
                  <Truck className="h-4 w-4 text-gray-400" />
                  <p className="text-2xl font-bold text-gray-900">{stats?.suppliers ?? "—"}</p>
                </div>
                <p className="text-[10px] text-gray-500">Suppliers</p>
              </Link>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
