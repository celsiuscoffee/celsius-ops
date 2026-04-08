"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import Image from "next/image";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  AlertTriangle,
  ClipboardCheck,
  ShoppingCart,
  Package,
  Trash2,
  ArrowRight,
  Clock,
  CheckCircle2,
  MessageCircle,
  FileText,
  Loader2,
} from "lucide-react";

type StockLevelItem = {
  productId: string;
  name: string;
  sku: string;
  category: string;
  baseUom: string;
  currentQty: number;
  parLevel: number;
  reorderPoint: number;
  avgDailyUsage: number;
  daysLeft: number;
  suggestedOrderQty: number;
  status: "critical" | "low" | "ok" | "noPar";
};

type StockLevelsData = {
  summary: { critical: number; low: number; ok: number; noPar: number; total: number };
  items: StockLevelItem[];
};

type DashboardData = {
  stockCheckDone: boolean;
  lastCheckTime: string | null;
  pendingApprovals: number;
  deliveriesExpected: number;
  deliverySuppliers: string[];
  weeklySpending: number;
  wasteTotal: number;
  ordersPlaced: number;
  receivingsThisWeek: number;
  recentOrders: {
    id: string;
    orderNumber: string;
    supplier: string;
    status: string;
    totalAmount: number;
    createdAt: string;
  }[];
};

export default function HomePage() {
  const [data, setData] = useState<DashboardData | null>(null);
  const [userName, setUserName] = useState("");
  const [userRole, setUserRole] = useState("");
  const [outletName, setOutletName] = useState("");
  const [stockLevels, setStockLevels] = useState<StockLevelsData | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    Promise.all([
      fetch("/api/dashboard").then((r) => r.json()),
      fetch("/api/auth/me").then((r) => r.json()),
    ])
      .then(([dashboard, user]) => {
        setData(dashboard);
        if (user.name) setUserName(user.name);
        if (user.role) setUserRole(user.role);
        if (user.outletName) setOutletName(user.outletName);

        // Fetch stock levels once we have the outletId
        if (user.outletId) {
          fetch(`/api/stock-levels?outletId=${user.outletId}`)
            .then((r) => (r.ok ? r.json() : null))
            .then((sl) => {
              if (sl) setStockLevels(sl);
            })
            .catch(() => {});
        }

        setLoading(false);
      })
      .catch(() => setLoading(false));
  }, []);

  const now = new Date();
  const hour = now.getHours();
  const greeting =
    hour < 12 ? "Good morning" : hour < 17 ? "Good afternoon" : "Good evening";
  const dateStr = now.toLocaleDateString("en-MY", {
    weekday: "short",
    day: "numeric",
    month: "short",
    year: "numeric",
  });
  const isMorning = hour >= 6 && hour < 12;

  if (loading) {
    return (
      <div className="flex items-center justify-center p-12">
        <Loader2 className="h-6 w-6 animate-spin text-terracotta" />
      </div>
    );
  }

  const formatTimeAgo = (iso: string | null) => {
    if (!iso) return "Never";
    const diff = Date.now() - new Date(iso).getTime();
    const hours = Math.floor(diff / 3600000);
    if (hours < 1) return "Just now";
    if (hours < 24) return `${hours}h ago`;
    const days = Math.floor(hours / 24);
    return days === 1 ? "Yesterday" : `${days}d ago`;
  };

  const formatDate = (iso: string) => {
    const d = new Date(iso);
    const today = new Date();
    if (d.toDateString() === today.toDateString()) return "Today";
    const yesterday = new Date(today);
    yesterday.setDate(yesterday.getDate() - 1);
    if (d.toDateString() === yesterday.toDateString()) return "Yesterday";
    return d.toLocaleDateString("en-MY", { day: "numeric", month: "short" });
  };

  const isManager = userRole === "ADMIN" || userRole === "MANAGER" || userRole === "OWNER";

  return (
    <div className="px-4 py-4">
      <div className="mx-auto max-w-lg space-y-4">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Image
              src="/images/celsius-logo-sm.jpg"
              alt="Celsius Coffee"
              width={40}
              height={40}
              className="rounded-lg"
            />
            <div>
              <h1 className="font-heading text-lg font-bold text-brand-dark">
                {greeting}, {userName || "there"}
              </h1>
              <p className="text-sm text-gray-500">
                {outletName && <>{outletName} &middot; </>}{dateStr}
              </p>
            </div>
          </div>
          {isManager && (
            <Link
              href="https://backoffice.celsiuscoffee.com"
              className="rounded-lg border border-gray-200 px-2.5 py-1 text-xs text-gray-500 hover:bg-gray-50"
            >
              Admin
            </Link>
          )}
        </div>

        {/* Priority actions */}
        {data && (
          <div className="space-y-2">
            {/* Stock check */}
            {!data.stockCheckDone && (
              <Link href="/check">
                <Card
                  className={`px-4 py-3 transition-all ${
                    isMorning
                      ? "border-terracotta bg-terracotta/5 ring-1 ring-terracotta/20"
                      : "border-terracotta/30 bg-terracotta/5"
                  }`}
                >
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2.5">
                      <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-terracotta/10">
                        <ClipboardCheck className="h-5 w-5 text-terracotta" />
                      </div>
                      <div>
                        <p className="text-sm font-semibold text-terracotta-dark">
                          {isMorning ? "Start daily stock check" : "Daily check not done"}
                        </p>
                        <p className="text-xs text-terracotta/60">
                          Last: {formatTimeAgo(data.lastCheckTime)}
                        </p>
                      </div>
                    </div>
                    {isMorning && (
                      <Badge className="bg-terracotta text-[10px]">Do First</Badge>
                    )}
                    <ArrowRight className="h-4 w-4 text-terracotta/50" />
                  </div>
                </Card>
              </Link>
            )}

            {/* Deliveries expected */}
            {data.deliveriesExpected > 0 && (
              <Link href="/receive">
                <Card className="border-blue-200 bg-blue-50 px-4 py-3">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2.5">
                      <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-blue-100">
                        <Package className="h-5 w-5 text-blue-500" />
                      </div>
                      <div>
                        <p className="text-sm font-semibold text-blue-700">
                          {data.deliveriesExpected} deliveries expected
                        </p>
                        <p className="text-xs text-blue-400">
                          {data.deliverySuppliers.slice(0, 3).join(" & ")}
                        </p>
                      </div>
                    </div>
                    <ArrowRight className="h-4 w-4 text-blue-300" />
                  </div>
                </Card>
              </Link>
            )}

            {/* Pending approvals — manager only */}
            {isManager && data.pendingApprovals > 0 && (
              <Link href="https://backoffice.celsiuscoffee.com/inventory/orders">
                <Card className="border-amber-200 bg-amber-50 px-4 py-3">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2.5">
                      <FileText className="h-4 w-4 text-amber-500" />
                      <p className="text-sm text-amber-700">
                        {data.pendingApprovals} orders pending approval
                      </p>
                    </div>
                    <Badge variant="outline" className="text-[10px]">
                      Admin
                    </Badge>
                  </div>
                </Card>
              </Link>
            )}

            {/* Low stock alert — manager only (links to order page) */}
            {isManager && stockLevels && (stockLevels.summary.critical > 0 || stockLevels.summary.low > 0) && (
              <Link href="/order">
                <Card className="border-red-200 bg-red-50 px-4 py-3">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2.5">
                      <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-red-100">
                        <AlertTriangle className="h-5 w-5 text-red-500" />
                      </div>
                      <div>
                        <p className="text-sm font-semibold text-red-700">
                          {stockLevels.summary.critical + stockLevels.summary.low} items low on stock
                        </p>
                        <p className="text-xs text-red-400">
                          {stockLevels.items
                            .filter((i) => i.status === "critical" || i.status === "low")
                            .slice(0, 3)
                            .map((i) => i.name)
                            .join(", ")}
                        </p>
                      </div>
                    </div>
                    <ArrowRight className="h-4 w-4 text-red-300" />
                  </div>
                </Card>
              </Link>
            )}
          </div>
        )}

        {/* Weekly performance — manager only */}
        {isManager && data && (
          <div>
            <h2 className="mb-2 text-sm font-semibold text-gray-900">
              This Week
            </h2>
            <div className="grid grid-cols-3 gap-2">
              <Card className="px-3 py-2.5">
                <p className="text-[10px] text-gray-400">Spending</p>
                <p className="text-base font-bold text-gray-900">
                  RM {data.weeklySpending > 1000 ? `${(data.weeklySpending / 1000).toFixed(1)}k` : data.weeklySpending.toFixed(0)}
                </p>
              </Card>
              <Card className="px-3 py-2.5">
                <p className="text-[10px] text-gray-400">Orders</p>
                <p className="text-base font-bold text-gray-900">
                  {data.ordersPlaced}
                </p>
                <p className="text-[10px] text-gray-400">
                  {data.receivingsThisWeek} received
                </p>
              </Card>
              {stockLevels ? (
                <Card className="px-3 py-2.5">
                  <p className="text-[10px] text-gray-400">Stock Alerts</p>
                  <p className="text-base font-bold text-gray-900">
                    {stockLevels.summary.critical + stockLevels.summary.low}
                  </p>
                  <p className="text-[10px] text-gray-400">
                    {stockLevels.summary.critical > 0 && (
                      <span className="text-red-500">{stockLevels.summary.critical} critical</span>
                    )}
                    {stockLevels.summary.critical > 0 && stockLevels.summary.low > 0 && ", "}
                    {stockLevels.summary.low > 0 && (
                      <span className="text-amber-500">{stockLevels.summary.low} low</span>
                    )}
                  </p>
                </Card>
              ) : (
                <Card className="px-3 py-2.5">
                  <p className="text-[10px] text-gray-400">Waste</p>
                  <p className="text-base font-bold text-gray-900">
                    RM {data.wasteTotal.toFixed(0)}
                  </p>
                </Card>
              )}
            </div>
          </div>
        )}

        {/* Stock Levels — items below par (manager only, links to ordering) */}
        {isManager && stockLevels && stockLevels.items.filter((i) => i.status === "critical" || i.status === "low").length > 0 && (
          <div>
            <div className="mb-2 flex items-center justify-between">
              <h2 className="text-sm font-semibold text-gray-900">
                Stock Levels
              </h2>
              <Link href="/order" className="text-xs text-terracotta">
                Order now →
              </Link>
            </div>
            <Card className="divide-y divide-gray-50 overflow-hidden">
              {stockLevels.items
                .filter((i) => i.status === "critical" || i.status === "low")
                .sort((a, b) => a.daysLeft - b.daysLeft)
                .slice(0, 5)
                .map((item) => {
                  const pct = item.parLevel > 0 ? Math.min(100, Math.round((item.currentQty / item.parLevel) * 100)) : 0;
                  const barColor =
                    item.status === "critical"
                      ? "bg-red-500"
                      : item.status === "low"
                        ? "bg-amber-500"
                        : "bg-green-500";
                  return (
                    <div key={item.productId} className="px-3 py-2.5">
                      <div className="flex items-center justify-between">
                        <p className="truncate text-sm font-medium text-gray-900">
                          {item.name}
                        </p>
                        <Badge
                          className={`text-[10px] ${
                            item.daysLeft < 1
                              ? "bg-red-500"
                              : item.daysLeft < 3
                                ? "bg-amber-500"
                                : "bg-green-500"
                          }`}
                        >
                          {item.daysLeft < 0.1 ? "OUT" : `${item.daysLeft.toFixed(1)}d left`}
                        </Badge>
                      </div>
                      <div className="mt-1 flex items-center gap-2">
                        <div className="h-1.5 flex-1 rounded-full bg-gray-100">
                          <div
                            className={`h-1.5 rounded-full ${barColor}`}
                            style={{ width: `${pct}%` }}
                          />
                        </div>
                        <span className="text-[10px] text-gray-400">
                          {item.currentQty.toLocaleString()}/{item.parLevel.toLocaleString()} {item.baseUom}
                        </span>
                      </div>
                    </div>
                  );
                })}
            </Card>
          </div>
        )}

        {/* Recent orders — manager only */}
        {isManager && data && data.recentOrders.length > 0 && (
          <div>
            <div className="mb-2 flex items-center justify-between">
              <h2 className="text-sm font-semibold text-gray-900">
                Recent Orders
              </h2>
              <Link href="https://backoffice.celsiuscoffee.com/inventory/orders" className="text-xs text-terracotta">
                View all →
              </Link>
            </div>
            <Card className="divide-y divide-gray-50 overflow-hidden">
              {data.recentOrders.map((order) => (
                <div
                  key={order.id}
                  className="flex items-center justify-between px-3 py-2"
                >
                  <div>
                    <p className="text-sm text-gray-900">{order.supplier}</p>
                    <p className="text-[10px] text-gray-400">
                      {order.orderNumber} &middot; {formatDate(order.createdAt)}
                    </p>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-medium text-gray-700">
                      RM {order.totalAmount.toFixed(0)}
                    </span>
                    {order.status === "sent" || order.status === "approved" ? (
                      <MessageCircle className="h-3.5 w-3.5 text-green-500" />
                    ) : order.status === "completed" ? (
                      <CheckCircle2 className="h-3.5 w-3.5 text-gray-300" />
                    ) : (
                      <Clock className="h-3.5 w-3.5 text-amber-400" />
                    )}
                  </div>
                </div>
              ))}
            </Card>
          </div>
        )}

        {/* Empty state when no data — manager only */}
        {isManager && data && data.recentOrders.length === 0 && (
          <Card className="px-4 py-6 text-center">
            <Package className="mx-auto h-8 w-8 text-gray-300" />
            <p className="mt-2 text-sm text-gray-500">No orders yet</p>
            <p className="text-xs text-gray-400">Create your first order to get started</p>
          </Card>
        )}

        {/* Quick actions — bottom grid */}
        <div className="grid grid-cols-4 gap-2 pb-4">
          {[
            { href: "/check", icon: ClipboardCheck, label: "Check" },
            { href: "/order", icon: ShoppingCart, label: "Order", minRole: "MANAGER" },
            { href: "/receive", icon: Package, label: "Receive" },
            { href: "/wastage", icon: Trash2, label: "Wastage", minRole: "MANAGER" },
          ].filter((a) => {
            if (!("minRole" in a) || !a.minRole) return true;
            const levels: Record<string, number> = { STAFF: 1, MANAGER: 2, ADMIN: 3, OWNER: 4 };
            return (levels[userRole] || 1) >= (levels[a.minRole] || 1);
          }).map((action) => {
            const Icon = action.icon;
            return (
              <Link
                key={action.href}
                href={action.href}
                className="flex flex-col items-center gap-1 rounded-xl border border-gray-200 bg-white py-3 text-gray-600 transition-colors hover:bg-terracotta/5 hover:text-terracotta"
              >
                <Icon className="h-5 w-5" />
                <span className="text-[10px] font-medium">{action.label}</span>
              </Link>
            );
          })}
        </div>
      </div>
    </div>
  );
}
