"use client";

import { useEffect, useState, useCallback } from "react";
import Link from "next/link";
import {
  TrendingUp, ShoppingBag, Clock, CheckCircle, ChevronRight,
  Package, Users2, AlertTriangle, XCircle, Gift, Star, Boxes,
} from "lucide-react";
import {
  AreaChart, Area, BarChart, Bar, XAxis, YAxis,
  CartesianGrid, Tooltip, ResponsiveContainer, Cell,
} from "recharts";
import { getSupabaseClient } from "@/lib/pickup/supabase";
import type { OrderRow, OrderStatus } from "@/lib/pickup/types";

// ── Types ──────────────────────────────────────────────────────────────────

type AppTab = "pickup" | "inventory" | "loyalty";
type Range  = "7d" | "30d" | "90d";

const RANGE_DAYS: Record<Range, number> = { "7d": 7, "30d": 30, "90d": 90 };

const STATUS_COLOUR: Record<string, string> = {
  pending:   "bg-gray-100 text-gray-600",
  paid:      "bg-blue-100 text-blue-600",
  preparing: "bg-amber-100 text-amber-700",
  ready:     "bg-green-100 text-green-700",
  completed: "bg-gray-100 text-gray-500",
  failed:    "bg-red-100 text-red-600",
};

const PAID_STATUSES = new Set(["paid", "preparing", "ready", "completed"]);

const STORE_COLOURS: Record<string, string> = {
  "shah-alam": "#160800",
  "conezion":  "#e67e22",
  "tamarind":  "#27ae60",
};

function startOf(daysAgo: number) {
  const d = new Date();
  d.setDate(d.getDate() - daysAgo + 1);
  d.setHours(0, 0, 0, 0);
  return d;
}

function fmtDate(iso: string, range: Range) {
  const d = new Date(iso);
  if (range === "7d") return d.toLocaleDateString("en-MY", { weekday: "short", day: "numeric" });
  return d.toLocaleDateString("en-MY", { day: "numeric", month: "short" });
}

interface ItemRow { product_name: string; quantity: number; item_total: number }
interface OrderWithItems extends OrderRow { order_items: ItemRow[] }

interface PickupStats { todayRevenue: number; todayOrders: number; preparing: number; ready: number }

interface InventoryStats {
  total:    number;
  lowStock: number;
  outStock: number;
  lowItems: { name: string; qty: number; unit: string }[];
}

interface LoyaltyStats {
  totalMembers:   number;
  activeMonth:    number;
  pointsIssued:   number;
  redemptions:    number;
  recentMembers:  { name: string | null; phone: string; joined: string; points: number }[];
}

// ── Component ──────────────────────────────────────────────────────────────

export default function PickupDashboard() {
  const [tab,   setTab]   = useState<AppTab>("pickup");
  const [range, setRange] = useState<Range>("7d");

  // Pickup — live
  const [pickupStats,      setPickupStats]      = useState<PickupStats | null>(null);
  const [activeOrders,     setActiveOrders]     = useState<OrderRow[]>([]);
  const [recent,           setRecent]           = useState<OrderRow[]>([]);
  const [pickupLoading,    setPickupLoading]    = useState(true);

  // Pickup — analytics (range-based)
  const [orders,           setOrders]           = useState<OrderRow[]>([]);
  const [ordersItems,      setOrdersItems]      = useState<OrderWithItems[]>([]);
  const [analyticsLoading, setAnalyticsLoading] = useState(true);

  // Inventory (lazy)
  const [invStats,   setInvStats]   = useState<InventoryStats | null>(null);
  const [invLoading, setInvLoading] = useState(false);
  const [invLoaded,  setInvLoaded]  = useState(false);

  // Loyalty (lazy)
  const [loyaltyStats,   setLoyaltyStats]   = useState<LoyaltyStats | null>(null);
  const [loyaltyLoading, setLoyaltyLoading] = useState(false);
  const [loyaltyLoaded,  setLoyaltyLoaded]  = useState(false);

  // ── Data loaders ──

  const loadPickupToday = useCallback(async () => {
    const supabase   = getSupabaseClient();
    const todayStart = new Date(); todayStart.setHours(0, 0, 0, 0);
    const [todayR, activeR, recentR] = await Promise.all([
      supabase.from("orders").select("total,status").gte("created_at", todayStart.toISOString()),
      supabase.from("orders").select("*").in("status", ["paid", "preparing", "ready"]).order("created_at", { ascending: false }),
      supabase.from("orders").select("*").order("created_at", { ascending: false }).limit(8),
    ]);
    const todayOrders = todayR.data  as Array<{ total: number; status: OrderStatus }> | null;
    const active      = activeR.data as OrderRow[] | null;
    const recentData  = recentR.data as OrderRow[] | null;
    const paid = (todayOrders ?? []).filter((o) => PAID_STATUSES.has(o.status));
    setPickupStats({
      todayRevenue: paid.reduce((s, o) => s + (o.total as number), 0),
      todayOrders:  paid.length,
      preparing:    (todayOrders ?? []).filter((o) => o.status === "preparing").length,
      ready:        (todayOrders ?? []).filter((o) => o.status === "ready").length,
    });
    setActiveOrders((active ?? []) as OrderRow[]);
    setRecent((recentData ?? []) as OrderRow[]);
    setPickupLoading(false);
  }, []);

  const loadAnalytics = useCallback(async (r: Range) => {
    setAnalyticsLoading(true);
    const supabase = getSupabaseClient();
    const since    = startOf(RANGE_DAYS[r]);
    const [baseRes, itemsRes] = await Promise.all([
      supabase.from("orders").select("total, status, store_id, created_at")
        .gte("created_at", since.toISOString()).not("status", "in", "(pending,failed)").order("created_at"),
      supabase.from("orders").select("*, order_items(product_name, quantity, item_total)")
        .gte("created_at", since.toISOString()).not("status", "in", "(pending,failed)").order("created_at"),
    ]);
    setOrders((baseRes.data ?? []) as OrderRow[]);
    setOrdersItems((itemsRes.data ?? []) as OrderWithItems[]);
    setAnalyticsLoading(false);
  }, []);

  const loadInventory = useCallback(async () => {
    if (invLoaded) return;
    setInvLoading(true);
    const supabase = getSupabaseClient();
    const [ingR, lvlR, parR] = await Promise.all([
      supabase.from("ingredients").select("id,name,unit").eq("is_active", true),
      supabase.from("stock_levels").select("ingredient_id,quantity"),
      supabase.from("ingredient_outlet_settings").select("ingredient_id,par_level"),
    ]);
    const ingredients = ingR.data  as Array<{ id: string; name: string; unit: string }>       | null;
    const stockLevels = lvlR.data  as Array<{ ingredient_id: string; quantity: number }>      | null;
    const parSettings = parR.data  as Array<{ ingredient_id: string; par_level: number }>     | null;
    const ing    = ingredients ?? [];
    const lvlMap = Object.fromEntries((stockLevels ?? []).map((l) => [l.ingredient_id, l.quantity as number]));
    const parMap = Object.fromEntries((parSettings ?? []).map((s) => [s.ingredient_id, s.par_level as number]));
    const lowItems = ing
      .filter((i) => { const qty = lvlMap[i.id] ?? 0; const par = parMap[i.id] ?? 0; return qty > 0 && par > 0 && qty < par; })
      .map((i) => ({ name: i.name as string, qty: lvlMap[i.id] ?? 0, unit: i.unit as string }))
      .slice(0, 5);
    setInvStats({
      total:    ing.length,
      lowStock: lowItems.length,
      outStock: ing.filter((i) => (lvlMap[i.id] ?? 0) === 0).length,
      lowItems,
    });
    setInvLoading(false);
    setInvLoaded(true);
  }, [invLoaded]);

  const loadLoyalty = useCallback(async () => {
    if (loyaltyLoaded) return;
    setLoyaltyLoading(true);
    const supabase   = getSupabaseClient();
    const monthStart = new Date(); monthStart.setDate(1); monthStart.setHours(0, 0, 0, 0);
    const [mbRes, rdmRes, { count }] = await Promise.all([
      supabase.from("member_brands")
        .select("points_balance, total_points_earned, last_visit_at, members(name, phone, created_at)")
        .eq("brand_id", "brand-celsius").order("last_visit_at", { ascending: false }).limit(5),
      supabase.from("redemptions").select("id", { count: "exact", head: true }).eq("brand_id", "brand-celsius"),
      supabase.from("member_brands").select("*", { count: "exact", head: true }).eq("brand_id", "brand-celsius"),
    ]);
    const { count: activeCount } = await supabase.from("member_brands")
      .select("*", { count: "exact", head: true })
      .eq("brand_id", "brand-celsius")
      .gte("last_visit_at", monthStart.toISOString());
    const pointsRaw   = await supabase.from("member_brands")
      .select("total_points_earned").eq("brand_id", "brand-celsius");
    const pointsData  = pointsRaw.data as Array<{ total_points_earned: number }> | null;
    const pointsIssued = (pointsData ?? []).reduce((s, m) => s + (m.total_points_earned ?? 0), 0);

    type MbRow = {
      points_balance: number;
      total_points_earned: number;
      last_visit_at: string | null;
      members: { name: string | null; phone: string; created_at: string } | null;
    };

    setLoyaltyStats({
      totalMembers:  count ?? 0,
      activeMonth:   activeCount ?? 0,
      pointsIssued,
      redemptions:   rdmRes.count ?? 0,
      recentMembers: ((mbRes.data ?? []) as MbRow[]).map((m) => ({
        name:   m.members?.name ?? null,
        phone:  m.members?.phone ?? "",
        joined: m.members?.created_at ?? "",
        points: m.points_balance,
      })),
    });
    setLoyaltyLoading(false);
    setLoyaltyLoaded(true);
  }, [loyaltyLoaded]);

  // ── Effects ──

  useEffect(() => { loadPickupToday(); loadAnalytics(range); }, [loadPickupToday, loadAnalytics, range]);

  useEffect(() => {
    const supabase = getSupabaseClient();
    const channel  = supabase.channel("dashboard-orders")
      .on("postgres_changes", { event: "*", schema: "public", table: "orders" }, () => loadPickupToday())
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [loadPickupToday]);

  useEffect(() => {
    if (tab === "inventory") loadInventory();
    if (tab === "loyalty")   loadLoyalty();
  }, [tab, loadInventory, loadLoyalty]);

  useEffect(() => { loadAnalytics(range); }, [range, loadAnalytics]);

  // ── Chart data ──

  const days = RANGE_DAYS[range];
  const dailyMap: Record<string, { date: string; revenue: number; orders: number }> = {};
  for (let i = 0; i < days; i++) {
    const d = new Date(); d.setDate(d.getDate() - days + 1 + i);
    const key = d.toISOString().slice(0, 10);
    dailyMap[key] = { date: key, revenue: 0, orders: 0 };
  }
  for (const o of orders) {
    const key = o.created_at.slice(0, 10);
    if (dailyMap[key]) { dailyMap[key].revenue += o.total; dailyMap[key].orders += 1; }
  }
  const dailySeries = Object.values(dailyMap).map((d) => ({
    ...d, revRM: d.revenue / 100, label: fmtDate(d.date + "T00:00:00", range),
  }));

  const storeMap: Record<string, { store: string; revenue: number; orders: number }> = {};
  for (const o of orders) {
    if (!storeMap[o.store_id]) storeMap[o.store_id] = { store: o.store_id, revenue: 0, orders: 0 };
    storeMap[o.store_id].revenue += o.total;
    storeMap[o.store_id].orders  += 1;
  }
  const storeSeries = Object.values(storeMap).map((s) => ({
    ...s, revRM: s.revenue / 100,
    label: s.store.replace(/-/g, " ").replace(/\b\w/g, (c) => c.toUpperCase()),
  }));

  const totalRevenue = orders.reduce((s, o) => s + o.total, 0);
  const avgOrder     = orders.length ? totalRevenue / orders.length : 0;
  const peakDay      = dailySeries.reduce((m, d) => d.revenue > m.revenue ? d : m, dailySeries[0] ?? { label: "—", revenue: 0 });

  const productMap: Record<string, { name: string; units: number; revenue: number }> = {};
  for (const order of ordersItems) {
    for (const item of order.order_items ?? []) {
      if (!productMap[item.product_name]) productMap[item.product_name] = { name: item.product_name, units: 0, revenue: 0 };
      productMap[item.product_name].units   += item.quantity;
      productMap[item.product_name].revenue += item.item_total;
    }
  }
  const topProducts = Object.values(productMap).sort((a, b) => b.units - a.units).slice(0, 10);

  const hourMap: Record<number, number> = {};
  for (let h = 0; h < 24; h++) hourMap[h] = 0;
  for (const order of ordersItems) { const h = new Date(order.created_at).getHours(); hourMap[h] = (hourMap[h] ?? 0) + 1; }
  const hourSeries = Array.from({ length: 24 }, (_, h) => ({
    hour: h, count: hourMap[h] ?? 0,
    label: h === 0 ? "12am" : h < 12 ? `${h}am` : h === 12 ? "12pm" : `${h - 12}pm`,
  }));
  const peakHour = hourSeries.reduce((m, h) => h.count > m.count ? h : m, hourSeries[0] ?? { hour: 0, count: 0, label: "" });

  // ── Render ──

  return (
    <div className="p-6 space-y-6 max-w-6xl">

      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-bold text-[#160800]">Pickup Dashboard</h1>
          <p className="text-sm text-muted-foreground mt-0.5">
            {new Date().toLocaleDateString("en-MY", { weekday: "long", day: "numeric", month: "long", year: "numeric" })}
          </p>
        </div>
        {/* Range picker — only visible on Pickup tab */}
        {tab === "pickup" && (
          <div className="flex gap-1 bg-white rounded-xl p-1">
            {(["7d", "30d", "90d"] as Range[]).map((r) => (
              <button key={r} onClick={() => setRange(r)}
                className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-colors ${
                  range === r ? "bg-[#160800] text-white" : "text-muted-foreground hover:text-[#160800]"
                }`}>
                {r === "7d" ? "7 days" : r === "30d" ? "30 days" : "90 days"}
              </button>
            ))}
          </div>
        )}
      </div>

      {/* App tabs */}
      <div className="flex gap-1 bg-white rounded-xl p-1 w-fit border border-border/40">
        {([ ["pickup", "Pickup App"], ["inventory", "Inventory"], ["loyalty", "Loyalty"] ] as [AppTab, string][]).map(([id, label]) => (
          <button key={id} onClick={() => setTab(id)}
            className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
              tab === id ? "bg-[#160800] text-white shadow-sm" : "text-muted-foreground hover:text-[#160800]"
            }`}>
            {label}
          </button>
        ))}
      </div>

      {/* PICKUP APP */}
      {tab === "pickup" && <>

        {/* Today's live stats */}
        <div>
          <p className="text-xs font-semibold text-muted-foreground uppercase tracking-widest mb-3">Today — Live</p>
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
            {([
              { label: "Revenue",   value: `RM ${((pickupStats?.todayRevenue ?? 0) / 100).toFixed(2)}`, icon: TrendingUp,  colour: "text-green-600",  bg: "bg-green-50"   },
              { label: "Orders",    value: pickupStats?.todayOrders ?? 0,                               icon: ShoppingBag, colour: "text-blue-600",   bg: "bg-blue-50"    },
              { label: "Preparing", value: pickupStats?.preparing ?? 0,                                 icon: Clock,       colour: "text-amber-600",  bg: "bg-amber-50"   },
              { label: "Ready",     value: pickupStats?.ready ?? 0,                                     icon: CheckCircle, colour: "text-primary",    bg: "bg-primary/10" },
            ] as { label: string; value: string | number; icon: React.ElementType; colour: string; bg: string }[]).map(({ label, value, icon: Icon, colour, bg }) => (
              <div key={label} className="bg-white rounded-2xl p-4">
                <div className={`w-9 h-9 rounded-xl ${bg} flex items-center justify-center mb-3`}>
                  <Icon className={`h-[18px] w-[18px] ${colour}`} strokeWidth={1.75} />
                </div>
                <p className="text-2xl font-bold text-[#160800]">{pickupLoading ? "—" : value}</p>
                <p className="text-xs text-muted-foreground mt-0.5">{label}</p>
              </div>
            ))}
          </div>
        </div>

        {/* Period analytics summary */}
        <div>
          <p className="text-xs font-semibold text-muted-foreground uppercase tracking-widest mb-3">
            {range === "7d" ? "Last 7 Days" : range === "30d" ? "Last 30 Days" : "Last 90 Days"}
          </p>
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
            {[
              { label: "Total Revenue",   value: `RM ${(totalRevenue / 100).toFixed(2)}` },
              { label: "Total Orders",    value: orders.length.toLocaleString()           },
              { label: "Avg Order Value", value: `RM ${(avgOrder / 100).toFixed(2)}`      },
              { label: "Peak Day",        value: peakDay?.label ?? "—"                    },
            ].map(({ label, value }) => (
              <div key={label} className="bg-white/70 border border-border/50 rounded-2xl p-4">
                <p className="text-2xl font-bold text-[#160800]">{analyticsLoading ? "—" : value}</p>
                <p className="text-xs text-muted-foreground mt-0.5">{label}</p>
              </div>
            ))}
          </div>
        </div>

        {/* Active + Recent orders */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          <div className="bg-white rounded-2xl overflow-hidden">
            <div className="px-5 py-4 border-b flex items-center justify-between">
              <h2 className="font-bold text-sm">Active Orders</h2>
              <Link href="/pickup/orders" className="text-xs text-primary font-medium flex items-center gap-0.5">
                View all <ChevronRight className="h-3 w-3" />
              </Link>
            </div>
            {pickupLoading ? (
              <div className="px-5 py-8 text-center text-sm text-muted-foreground">Loading...</div>
            ) : activeOrders.length === 0 ? (
              <div className="px-5 py-8 text-center text-sm text-muted-foreground">No active orders</div>
            ) : (
              <div className="divide-y">
                {activeOrders.map((order) => (
                  <Link key={order.id} href={`/pickup/orders/${order.id}`} className="flex items-center gap-3 px-5 py-3 hover:bg-muted/30 transition-colors">
                    <div>
                      <p className="font-semibold text-sm">#{order.order_number}</p>
                      <p className="text-xs text-muted-foreground capitalize">{order.store_id.replace(/-/g, " ")}</p>
                    </div>
                    <div className="ml-auto text-right">
                      <span className={`text-[11px] font-semibold px-2 py-0.5 rounded-full ${STATUS_COLOUR[order.status]}`}>{order.status}</span>
                      <p className="text-xs text-muted-foreground mt-1">RM {(order.total / 100).toFixed(2)}</p>
                    </div>
                  </Link>
                ))}
              </div>
            )}
          </div>

          <div className="bg-white rounded-2xl overflow-hidden">
            <div className="px-5 py-4 border-b flex items-center justify-between">
              <h2 className="font-bold text-sm">Recent Orders</h2>
              <Link href="/pickup/orders" className="text-xs text-primary font-medium flex items-center gap-0.5">
                View all <ChevronRight className="h-3 w-3" />
              </Link>
            </div>
            <div className="divide-y">
              {recent.map((order) => (
                <Link key={order.id} href={`/pickup/orders/${order.id}`} className="flex items-center gap-3 px-5 py-3 hover:bg-muted/30 transition-colors">
                  <div>
                    <p className="font-semibold text-sm">#{order.order_number}</p>
                    <p className="text-xs text-muted-foreground">
                      {new Date(order.created_at).toLocaleTimeString("en-MY", { hour: "2-digit", minute: "2-digit" })}
                      {" · "}{order.store_id.replace(/-/g, " ")}
                    </p>
                  </div>
                  <div className="ml-auto text-right">
                    <span className={`text-[11px] font-semibold px-2 py-0.5 rounded-full ${STATUS_COLOUR[order.status]}`}>{order.status}</span>
                    <p className="text-xs font-semibold mt-1">RM {(order.total / 100).toFixed(2)}</p>
                  </div>
                </Link>
              ))}
            </div>
          </div>
        </div>

        {/* Revenue chart */}
        <div className="bg-white rounded-2xl p-5">
          <h2 className="font-bold text-sm mb-4">Revenue Over Time</h2>
          {analyticsLoading ? <div className="h-52 flex items-center justify-center text-sm text-muted-foreground">Loading...</div> : (
            <ResponsiveContainer width="100%" height={220}>
              <AreaChart data={dailySeries} margin={{ top: 5, right: 10, left: -10, bottom: 0 }}>
                <defs>
                  <linearGradient id="revGrad" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%"  stopColor="#160800" stopOpacity={0.15} />
                    <stop offset="95%" stopColor="#160800" stopOpacity={0}    />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                <XAxis dataKey="label" tick={{ fontSize: 11 }} tickLine={false} axisLine={false} />
                <YAxis tick={{ fontSize: 11 }} tickLine={false} axisLine={false} tickFormatter={(v) => `RM${v}`} />
                <Tooltip formatter={(v) => [`RM ${(v as number).toFixed(2)}`, "Revenue"]} contentStyle={{ borderRadius: 10, border: "1px solid #e5e7eb", fontSize: 12 }} />
                <Area type="monotone" dataKey="revRM" stroke="#160800" strokeWidth={2} fill="url(#revGrad)" dot={false} />
              </AreaChart>
            </ResponsiveContainer>
          )}
        </div>

        {/* Orders per day + By outlet */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          <div className="bg-white rounded-2xl p-5">
            <h2 className="font-bold text-sm mb-4">Orders Per Day</h2>
            {analyticsLoading ? <div className="h-48 flex items-center justify-center text-sm text-muted-foreground">Loading...</div> : (
              <ResponsiveContainer width="100%" height={200}>
                <BarChart data={dailySeries} margin={{ top: 5, right: 10, left: -10, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                  <XAxis dataKey="label" tick={{ fontSize: 11 }} tickLine={false} axisLine={false} />
                  <YAxis tick={{ fontSize: 11 }} tickLine={false} axisLine={false} allowDecimals={false} />
                  <Tooltip formatter={(v) => [v as number, "Orders"]} contentStyle={{ borderRadius: 10, border: "1px solid #e5e7eb", fontSize: 12 }} />
                  <Bar dataKey="orders" radius={[4, 4, 0, 0]} fill="#160800" />
                </BarChart>
              </ResponsiveContainer>
            )}
          </div>

          <div className="bg-white rounded-2xl p-5">
            <h2 className="font-bold text-sm mb-4">By Outlet</h2>
            {analyticsLoading ? <div className="h-48 flex items-center justify-center text-sm text-muted-foreground">Loading...</div> :
             storeSeries.length === 0 ? <div className="h-48 flex items-center justify-center text-sm text-muted-foreground">No data</div> : (
              <ResponsiveContainer width="100%" height={200}>
                <BarChart data={storeSeries} layout="vertical" margin={{ top: 5, right: 10, left: -10, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" horizontal={false} />
                  <XAxis type="number" tick={{ fontSize: 11 }} tickLine={false} axisLine={false} tickFormatter={(v) => `RM${v}`} />
                  <YAxis type="category" dataKey="label" tick={{ fontSize: 11 }} tickLine={false} axisLine={false} width={110} />
                  <Tooltip formatter={(v) => [`RM ${(v as number).toFixed(2)}`, "Revenue"]} contentStyle={{ borderRadius: 10, border: "1px solid #e5e7eb", fontSize: 12 }} />
                  <Bar dataKey="revRM" radius={[0, 4, 4, 0]}>
                    {storeSeries.map((s) => <Cell key={s.store} fill={STORE_COLOURS[s.store] ?? "#888"} />)}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            )}
          </div>
        </div>

        {/* Top Products */}
        <div className="bg-white rounded-2xl p-5">
          <h2 className="font-bold text-sm mb-4">Top Products</h2>
          {analyticsLoading ? <div className="h-40 flex items-center justify-center text-sm text-muted-foreground">Loading...</div> :
           topProducts.length === 0 ? <div className="h-40 flex items-center justify-center text-sm text-muted-foreground">No data</div> : (
            <div className="space-y-2">
              <div className="grid grid-cols-[28px_1fr_80px_100px] gap-3 px-3 py-1 text-xs font-semibold text-muted-foreground uppercase tracking-wide">
                <span>#</span><span>Product</span><span className="text-right">Units</span><span className="text-right">Revenue</span>
              </div>
              {topProducts.map((p, i) => (
                <div key={p.name} className="grid grid-cols-[28px_1fr_80px_100px] gap-3 items-center px-3 py-2.5 rounded-xl hover:bg-muted/30 transition-colors">
                  <span className="text-sm font-bold text-muted-foreground">{i + 1}</span>
                  <span className="text-sm font-medium truncate">{p.name}</span>
                  <span className="text-sm text-right">{p.units.toLocaleString()}</span>
                  <span className="text-sm font-semibold text-right">RM {(p.revenue / 100).toFixed(2)}</span>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Orders by Hour */}
        <div className="bg-white rounded-2xl p-5">
          <div className="flex items-center justify-between mb-4">
            <h2 className="font-bold text-sm">Orders by Hour</h2>
            {!analyticsLoading && peakHour.count > 0 && (
              <span className="text-xs text-muted-foreground">
                Peak: <span className="font-semibold text-amber-600">{peakHour.label}</span> ({peakHour.count} orders)
              </span>
            )}
          </div>
          {analyticsLoading ? <div className="h-48 flex items-center justify-center text-sm text-muted-foreground">Loading...</div> : (
            <ResponsiveContainer width="100%" height={200}>
              <BarChart data={hourSeries.filter((h) => h.hour >= 6 && h.hour <= 23)} margin={{ top: 5, right: 10, left: -10, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                <XAxis dataKey="label" tick={{ fontSize: 10 }} tickLine={false} axisLine={false} />
                <YAxis tick={{ fontSize: 11 }} tickLine={false} axisLine={false} allowDecimals={false} />
                <Tooltip formatter={(v) => [v as number, "Orders"]} contentStyle={{ borderRadius: 10, border: "1px solid #e5e7eb", fontSize: 12 }} />
                <Bar dataKey="count" radius={[4, 4, 0, 0]}>
                  {hourSeries.filter((h) => h.hour >= 6 && h.hour <= 23).map((h) => (
                    <Cell key={h.hour} fill={h.hour === peakHour.hour && peakHour.count > 0 ? "#f59e0b" : "#160800"} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          )}
        </div>
      </>}

      {/* INVENTORY */}
      {tab === "inventory" && <>
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          {([
            { label: "Total Ingredients", value: invStats?.total ?? 0,    icon: Package,       colour: "text-blue-600",  bg: "bg-blue-50"  },
            { label: "Low Stock",         value: invStats?.lowStock ?? 0, icon: AlertTriangle, colour: "text-amber-600", bg: "bg-amber-50" },
            { label: "Out of Stock",      value: invStats?.outStock ?? 0, icon: XCircle,       colour: "text-red-600",   bg: "bg-red-50"   },
            { label: "Categories",        value: 8,                        icon: Boxes,         colour: "text-gray-500",  bg: "bg-gray-100" },
          ] as { label: string; value: string | number; icon: React.ElementType; colour: string; bg: string }[]).map(({ label, value, icon: Icon, colour, bg }) => (
            <div key={label} className="bg-white rounded-2xl p-4">
              <div className={`w-9 h-9 rounded-xl ${bg} flex items-center justify-center mb-3`}>
                <Icon className={`h-[18px] w-[18px] ${colour}`} strokeWidth={1.75} />
              </div>
              <p className="text-2xl font-bold text-[#160800]">{invLoading ? "—" : value}</p>
              <p className="text-xs text-muted-foreground mt-0.5">{label}</p>
            </div>
          ))}
        </div>

        <div className="bg-white rounded-2xl p-5">
          <div className="flex items-center justify-between mb-4">
            <h2 className="font-bold text-sm">Low Stock Alerts</h2>
            <Link href="/inventory" className="text-xs text-primary font-medium flex items-center gap-0.5">
              View inventory <ChevronRight className="h-3 w-3" />
            </Link>
          </div>
          {invLoading ? (
            <div className="py-8 text-center text-sm text-muted-foreground">Loading...</div>
          ) : (invStats?.lowItems.length ?? 0) === 0 ? (
            <div className="py-8 text-center text-sm text-green-600 font-medium">All ingredients are above PAR level</div>
          ) : (
            <div className="space-y-2">
              {invStats!.lowItems.map((item) => (
                <div key={item.name} className="flex items-center justify-between px-3 py-2.5 rounded-xl bg-amber-50">
                  <span className="text-sm font-medium">{item.name}</span>
                  <span className="text-sm text-amber-700 font-semibold">{item.qty} {item.unit} remaining</span>
                </div>
              ))}
            </div>
          )}
        </div>
      </>}

      {/* LOYALTY */}
      {tab === "loyalty" && <>
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          {([
            { label: "Total Members",     value: (loyaltyStats?.totalMembers ?? 0).toLocaleString(),  icon: Users2,      colour: "text-blue-600",   bg: "bg-blue-50"   },
            { label: "Active This Month", value: (loyaltyStats?.activeMonth  ?? 0).toLocaleString(),  icon: Star,        colour: "text-amber-600",  bg: "bg-amber-50"  },
            { label: "Points Issued",     value: (loyaltyStats?.pointsIssued ?? 0).toLocaleString(),  icon: Gift,        colour: "text-purple-600", bg: "bg-purple-50" },
            { label: "Redemptions",       value: (loyaltyStats?.redemptions  ?? 0).toLocaleString(),  icon: CheckCircle, colour: "text-green-600",  bg: "bg-green-50"  },
          ] as { label: string; value: string | number; icon: React.ElementType; colour: string; bg: string }[]).map(({ label, value, icon: Icon, colour, bg }) => (
            <div key={label} className="bg-white rounded-2xl p-4">
              <div className={`w-9 h-9 rounded-xl ${bg} flex items-center justify-center mb-3`}>
                <Icon className={`h-[18px] w-[18px] ${colour}`} strokeWidth={1.75} />
              </div>
              <p className="text-2xl font-bold text-[#160800]">{loyaltyLoading ? "—" : value}</p>
              <p className="text-xs text-muted-foreground mt-0.5">{label}</p>
            </div>
          ))}
        </div>

        <div className="bg-white rounded-2xl overflow-hidden">
          <div className="px-5 py-4 border-b flex items-center justify-between">
            <h2 className="font-bold text-sm">Recent Members</h2>
            <Link href="/loyalty/members" className="text-xs text-primary font-medium flex items-center gap-0.5">
              View all <ChevronRight className="h-3 w-3" />
            </Link>
          </div>
          {loyaltyLoading ? (
            <div className="px-5 py-8 text-center text-sm text-muted-foreground">Loading...</div>
          ) : (loyaltyStats?.recentMembers.length ?? 0) === 0 ? (
            <div className="px-5 py-8 text-center text-sm text-muted-foreground">No members yet</div>
          ) : (
            <div className="divide-y">
              {loyaltyStats!.recentMembers.map((m, i) => (
                <div key={i} className="flex items-center gap-3 px-5 py-3">
                  <div className="w-8 h-8 rounded-full bg-primary/10 flex items-center justify-center text-sm font-bold text-primary shrink-0">
                    {(m.name ?? m.phone)?.[0]?.toUpperCase() ?? "?"}
                  </div>
                  <div>
                    <p className="font-semibold text-sm">{m.name ?? "—"}</p>
                    <p className="text-xs text-muted-foreground">{m.phone}</p>
                  </div>
                  <div className="ml-auto text-right">
                    <p className="text-sm font-bold text-amber-600">{m.points.toLocaleString()} pts</p>
                    {m.joined && <p className="text-xs text-muted-foreground">{new Date(m.joined).toLocaleDateString("en-MY")}</p>}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </>}

    </div>
  );
}
