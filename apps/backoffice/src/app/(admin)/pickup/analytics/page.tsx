"use client";

import { useEffect, useState } from "react";
import {
  AreaChart,
  Area,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Cell,
} from "recharts";
import { getSupabaseClient } from "@/lib/pickup/supabase";
import type { OrderRow } from "@/lib/pickup/types";

type Range = "7d" | "30d" | "90d";

const RANGE_DAYS: Record<Range, number> = { "7d": 7, "30d": 30, "90d": 90 };
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

interface ItemRow {
  product_name: string;
  quantity: number;
  item_total: number;
}

interface OrderWithItems extends OrderRow {
  order_items: ItemRow[];
}

export default function PickupAnalyticsPage() {
  const [range,         setRange]         = useState<Range>("7d");
  const [orders,        setOrders]        = useState<OrderRow[]>([]);
  const [ordersItems,   setOrdersItems]   = useState<OrderWithItems[]>([]);
  const [loading,       setLoading]       = useState(true);

  useEffect(() => {
    async function load() {
      setLoading(true);
      const supabase = getSupabaseClient();
      const since    = startOf(RANGE_DAYS[range]);

      const [baseRes, itemsRes] = await Promise.all([
        supabase
          .from("orders")
          .select("total, status, store_id, created_at")
          .gte("created_at", since.toISOString())
          .not("status", "in", "(pending,failed)")
          .order("created_at"),
        supabase
          .from("orders")
          .select("*, order_items(product_name, quantity, item_total)")
          .gte("created_at", since.toISOString())
          .not("status", "in", "(pending,failed)")
          .order("created_at"),
      ]);

      setOrders((baseRes.data ?? []) as OrderRow[]);
      setOrdersItems((itemsRes.data ?? []) as OrderWithItems[]);
      setLoading(false);
    }
    load();
  }, [range]);

  // Build daily revenue series
  const days = RANGE_DAYS[range];
  const dailyMap: Record<string, { date: string; revenue: number; orders: number }> = {};
  for (let i = 0; i < days; i++) {
    const d = new Date();
    d.setDate(d.getDate() - days + 1 + i);
    const key = d.toISOString().slice(0, 10);
    dailyMap[key] = { date: key, revenue: 0, orders: 0 };
  }
  for (const o of orders) {
    const key = o.created_at.slice(0, 10);
    if (dailyMap[key]) {
      dailyMap[key].revenue += o.total;
      dailyMap[key].orders  += 1;
    }
  }
  const dailySeries = Object.values(dailyMap).map((d) => ({
    ...d,
    revRM:  d.revenue / 100,
    label: fmtDate(d.date + "T00:00:00", range),
  }));

  // Per-store breakdown
  const storeMap: Record<string, { store: string; revenue: number; orders: number }> = {};
  for (const o of orders) {
    if (!storeMap[o.store_id]) storeMap[o.store_id] = { store: o.store_id, revenue: 0, orders: 0 };
    storeMap[o.store_id].revenue += o.total;
    storeMap[o.store_id].orders  += 1;
  }
  const storeSeries = Object.values(storeMap).map((s) => ({
    ...s,
    revRM: s.revenue / 100,
    label: s.store.replace(/-/g, " ").replace(/\b\w/g, (c) => c.toUpperCase()),
  }));

  const totalRevenue = orders.reduce((s, o) => s + o.total, 0);
  const avgOrder     = orders.length ? totalRevenue / orders.length : 0;
  const peakDay      = dailySeries.reduce((m, d) => d.revenue > m.revenue ? d : m, dailySeries[0] ?? { label: "—", revenue: 0 });

  // Top Products — aggregate from order_items
  const productMap: Record<string, { name: string; units: number; revenue: number }> = {};
  for (const order of ordersItems) {
    for (const item of order.order_items ?? []) {
      if (!productMap[item.product_name]) {
        productMap[item.product_name] = { name: item.product_name, units: 0, revenue: 0 };
      }
      productMap[item.product_name].units   += item.quantity;
      productMap[item.product_name].revenue += item.item_total;
    }
  }
  const topProducts = Object.values(productMap)
    .sort((a, b) => b.units - a.units)
    .slice(0, 10);

  // Peak Hours — orders by hour of day
  const hourMap: Record<number, number> = {};
  for (let h = 0; h < 24; h++) hourMap[h] = 0;
  for (const order of ordersItems) {
    const h = new Date(order.created_at).getHours();
    hourMap[h] = (hourMap[h] ?? 0) + 1;
  }
  const hourSeries = Array.from({ length: 24 }, (_, h) => ({
    hour:  h,
    count: hourMap[h] ?? 0,
    label: h === 0 ? "12am" : h < 12 ? `${h}am` : h === 12 ? "12pm" : `${h - 12}pm`,
  }));
  const peakHour = hourSeries.reduce((m, h) => h.count > m.count ? h : m, hourSeries[0] ?? { hour: 0, count: 0, label: "" });

  return (
    <div className="p-3 sm:p-6 space-y-6 max-w-6xl">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-bold text-[#160800]">Pickup Analytics</h1>
          <p className="text-sm text-muted-foreground mt-0.5">Sales performance overview</p>
        </div>
        <div className="flex gap-1 bg-white rounded-xl p-1">
          {(["7d", "30d", "90d"] as Range[]).map((r) => (
            <button
              key={r}
              onClick={() => setRange(r)}
              className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-colors ${
                range === r ? "bg-[#160800] text-white" : "text-muted-foreground hover:text-[#160800]"
              }`}
            >
              {r === "7d" ? "7 days" : r === "30d" ? "30 days" : "90 days"}
            </button>
          ))}
        </div>
      </div>

      {/* Summary cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        {[
          { label: "Total Revenue",  value: `RM ${(totalRevenue / 100).toFixed(2)}` },
          { label: "Total Orders",   value: orders.length.toString() },
          { label: "Avg Order Value",value: `RM ${(avgOrder / 100).toFixed(2)}` },
          { label: "Peak Day",       value: peakDay?.label ?? "—" },
        ].map(({ label, value }) => (
          <div key={label} className="bg-white rounded-2xl p-4">
            <p className="text-2xl font-bold text-[#160800]">{loading ? "—" : value}</p>
            <p className="text-xs text-muted-foreground mt-0.5">{label}</p>
          </div>
        ))}
      </div>

      {/* Revenue over time */}
      <div className="bg-white rounded-2xl p-5">
        <h2 className="font-bold text-sm mb-4">Revenue Over Time</h2>
        {loading ? (
          <div className="h-52 flex items-center justify-center text-sm text-muted-foreground">Loading...</div>
        ) : (
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
              <Tooltip
                formatter={(value) => [`RM ${(value as number).toFixed(2)}`, "Revenue"]}
                contentStyle={{ borderRadius: 10, border: "1px solid #e5e7eb", fontSize: 12 }}
              />
              <Area
                type="monotone"
                dataKey="revRM"
                stroke="#160800"
                strokeWidth={2}
                fill="url(#revGrad)"
                dot={false}
              />
            </AreaChart>
          </ResponsiveContainer>
        )}
      </div>

      {/* Orders per day */}
      <div className="bg-white rounded-2xl p-5">
        <h2 className="font-bold text-sm mb-4">Orders Per Day</h2>
        {loading ? (
          <div className="h-48 flex items-center justify-center text-sm text-muted-foreground">Loading...</div>
        ) : (
          <ResponsiveContainer width="100%" height={200}>
            <BarChart data={dailySeries} margin={{ top: 5, right: 10, left: -10, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
              <XAxis dataKey="label" tick={{ fontSize: 11 }} tickLine={false} axisLine={false} />
              <YAxis tick={{ fontSize: 11 }} tickLine={false} axisLine={false} allowDecimals={false} />
              <Tooltip
                formatter={(value) => [value as number, "Orders"]}
                contentStyle={{ borderRadius: 10, border: "1px solid #e5e7eb", fontSize: 12 }}
              />
              <Bar dataKey="orders" radius={[4, 4, 0, 0]} fill="#160800" />
            </BarChart>
          </ResponsiveContainer>
        )}
      </div>

      {/* By outlet */}
      <div className="bg-white rounded-2xl p-5">
        <h2 className="font-bold text-sm mb-4">By Outlet</h2>
        {loading ? (
          <div className="h-40 flex items-center justify-center text-sm text-muted-foreground">Loading...</div>
        ) : storeSeries.length === 0 ? (
          <div className="h-40 flex items-center justify-center text-sm text-muted-foreground">No data</div>
        ) : (
          <ResponsiveContainer width="100%" height={180}>
            <BarChart data={storeSeries} margin={{ top: 5, right: 10, left: -10, bottom: 0 }} layout="vertical">
              <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" horizontal={false} />
              <XAxis type="number" tick={{ fontSize: 11 }} tickLine={false} axisLine={false} tickFormatter={(v) => `RM${v}`} />
              <YAxis type="category" dataKey="label" tick={{ fontSize: 11 }} tickLine={false} axisLine={false} width={110} />
              <Tooltip
                formatter={(value) => [`RM ${(value as number).toFixed(2)}`, "Revenue"]}
                contentStyle={{ borderRadius: 10, border: "1px solid #e5e7eb", fontSize: 12 }}
              />
              <Bar dataKey="revRM" radius={[0, 4, 4, 0]}>
                {storeSeries.map((s) => (
                  <Cell key={s.store} fill={STORE_COLOURS[s.store] ?? "#888"} />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        )}
      </div>

      {/* Top Products */}
      <div className="bg-white rounded-2xl p-5">
        <h2 className="font-bold text-sm mb-4">Top Products</h2>
        {loading ? (
          <div className="h-40 flex items-center justify-center text-sm text-muted-foreground">Loading...</div>
        ) : topProducts.length === 0 ? (
          <div className="h-40 flex items-center justify-center text-sm text-muted-foreground">No data</div>
        ) : (
          <div className="space-y-2">
            <div className="grid grid-cols-[28px_1fr_80px_100px] gap-3 px-3 py-1 text-xs font-semibold text-muted-foreground uppercase tracking-wide">
              <span>#</span>
              <span>Product</span>
              <span className="text-right">Units</span>
              <span className="text-right">Revenue</span>
            </div>
            {topProducts.map((p, idx) => (
              <div
                key={p.name}
                className="grid grid-cols-[28px_1fr_80px_100px] gap-3 items-center px-3 py-2.5 rounded-xl hover:bg-muted/30 transition-colors"
              >
                <span className="text-sm font-bold text-muted-foreground">{idx + 1}</span>
                <span className="text-sm font-medium truncate">{p.name}</span>
                <span className="text-sm text-right">{p.units.toLocaleString()}</span>
                <span className="text-sm font-semibold text-right">RM {(p.revenue / 100).toFixed(2)}</span>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Peak Hours Heatmap */}
      <div className="bg-white rounded-2xl p-5">
        <div className="flex items-center justify-between mb-4">
          <h2 className="font-bold text-sm">Orders by Hour</h2>
          {!loading && peakHour.count > 0 && (
            <span className="text-xs text-muted-foreground">
              Peak: <span className="font-semibold text-amber-600">{peakHour.label}</span> ({peakHour.count} {peakHour.count === 1 ? 'order' : 'orders'})
            </span>
          )}
        </div>
        {loading ? (
          <div className="h-48 flex items-center justify-center text-sm text-muted-foreground">Loading...</div>
        ) : (
          <ResponsiveContainer width="100%" height={200}>
            <BarChart
              data={hourSeries.filter((h) => h.hour >= 6 && h.hour <= 23)}
              margin={{ top: 5, right: 10, left: -10, bottom: 0 }}
            >
              <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
              <XAxis dataKey="label" tick={{ fontSize: 10 }} tickLine={false} axisLine={false} />
              <YAxis tick={{ fontSize: 11 }} tickLine={false} axisLine={false} allowDecimals={false} />
              <Tooltip
                formatter={(value) => [value as number, "Orders"]}
                contentStyle={{ borderRadius: 10, border: "1px solid #e5e7eb", fontSize: 12 }}
              />
              <Bar dataKey="count" radius={[4, 4, 0, 0]}>
                {hourSeries.filter((h) => h.hour >= 6 && h.hour <= 23).map((h) => (
                  <Cell
                    key={h.hour}
                    fill={h.hour === peakHour.hour && peakHour.count > 0 ? "#f59e0b" : "#160800"}
                  />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        )}
      </div>
    </div>
  );
}
