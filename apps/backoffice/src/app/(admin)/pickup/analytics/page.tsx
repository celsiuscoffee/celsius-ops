"use client";

import { formatRM } from "@celsius/shared";

import { useEffect, useState } from "react";
import Link from "next/link";
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

// Engagement endpoint response shape — declared once so both fetch
// and renderers stay in lockstep with the API.
interface EngagementResponse {
  range: Range;
  sinceIso: string;
  acquisition: {
    newMembersByDay: { date: string; new: number; active: number }[];
    totalNew: number;
    totalActive: number;
    repeatRate: number;
    avgOrdersPerActive: number;
    totalOrdersInRange: number;
  };
  activity: {
    dau: number;
    wau: number;
    mau: number;
    dauMauRatio: number;
  };
  cohorts: {
    weeks: { label: string; size: number; retention: number[] }[];
  };
  tiers: { tier: string; slug: string; count: number; pct: number }[];
  rewards: {
    lifetimeIssued: number;
    lifetimeUsed: number;
    lifetimeActive: number;
    lifetimeExpired: number;
    rangeIssued: number;
    rangeUsed: number;
    rangeRedemptions: number;
    redemptionRate: number;
    byReward: {
      rewardId: string;
      name: string;
      rewardType: string;
      autoIssue: boolean;
      issued: number;
      used: number;
      redeemed: number;
    }[];
  };
}

// Cohort heatmap cell color — matches the existing analytics palette
// (espresso to terracotta gradient with cream as the empty state).
function cohortBg(pct: number): string {
  if (pct === 0) return "#f5f5f4";
  const t = Math.min(1, pct);
  // Interpolate between #fdf6e3 (very light) and #160800 (espresso).
  const r = Math.round(253 + (22 - 253) * t);
  const g = Math.round(246 + (8 - 246) * t);
  const b = Math.round(227 + (0 - 227) * t);
  return `rgb(${r}, ${g}, ${b})`;
}

export default function PickupAnalyticsPage() {
  const [range,         setRange]         = useState<Range>("7d");
  const [orders,        setOrders]        = useState<OrderRow[]>([]);
  const [ordersItems,   setOrdersItems]   = useState<OrderWithItems[]>([]);
  const [loading,       setLoading]       = useState(true);
  const [engagement,    setEngagement]    = useState<EngagementResponse | null>(null);
  const [engLoading,    setEngLoading]    = useState(true);

  useEffect(() => {
    async function load() {
      setLoading(true);
      const since = startOf(RANGE_DAYS[range]);
      // Service-role-backed endpoint; anon SELECT on orders was revoked
      // by security lockdown A3. /api/pickup/orders already joins
      // order_items, so we can derive both the money-rollup and the
      // items-aggregated view from a single fetch and filter out
      // pending/failed client-side (the endpoint doesn't yet support
      // status-exclusion, and the row count stays small).
      try {
        const res = await fetch(
          `/api/pickup/orders?from=${since.toISOString()}&limit=2000`,
          { cache: "no-store" },
        );
        const raw = res.ok ? await res.json() : [];
        const all = (Array.isArray(raw) ? raw : []) as OrderWithItems[];
        const usable = all.filter((o) => o.status !== "pending" && o.status !== "failed");
        setOrders(usable as OrderRow[]);
        setOrdersItems(usable);
      } catch {
        setOrders([]);
        setOrdersItems([]);
      } finally {
        setLoading(false);
      }
    }
    load();
  }, [range]);

  // Engagement metrics live behind a server endpoint (admin-RLS reads
  // member_brands, issued_rewards, redemptions, tiers — none of which
  // are safe to query from a browser client).
  useEffect(() => {
    let cancelled = false;
    async function loadEngagement() {
      setEngLoading(true);
      try {
        const res = await fetch(`/api/pickup/engagement?range=${range}`);
        if (!res.ok) {
          if (!cancelled) setEngagement(null);
          return;
        }
        const json = (await res.json()) as EngagementResponse;
        if (!cancelled) setEngagement(json);
      } catch {
        if (!cancelled) setEngagement(null);
      } finally {
        if (!cancelled) setEngLoading(false);
      }
    }
    loadEngagement();
    return () => { cancelled = true; };
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

  // Revenue accounting:
  //   gross    = sum of subtotals  — what was billed before any reductions
  //   discount = voucher + reward + first-order discounts (all in sen)
  //   net      = gross − discount  — operator's reported revenue, ex-tax
  //   total    = net + SST          — what the customer actually paid
  // SST is excluded from "net revenue" because it's tax pass-through, not
  // operator income. AOV uses net (the typical industry definition).
  const grossRevenue   = orders.reduce((s, o) => s + (o.subtotal ?? 0), 0);
  const totalDiscount  = orders.reduce(
    (s, o) =>
      s +
      (o.discount_amount ?? 0) +
      (o.reward_discount_amount ?? 0) +
      (o.first_order_discount_amount ?? 0),
    0,
  );
  const netRevenue     = Math.max(0, grossRevenue - totalDiscount);
  const totalRevenue   = orders.reduce((s, o) => s + o.total, 0); // collected (incl SST)
  const avgOrder       = orders.length ? netRevenue / orders.length : 0;
  const discountRate   = grossRevenue > 0 ? totalDiscount / grossRevenue : 0;
  const peakDay        = dailySeries.reduce((m, d) => d.revenue > m.revenue ? d : m, dailySeries[0] ?? { label: "—", revenue: 0 });

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
      {/* Sub-page tabs: Overview ↔ Analytics (this page) */}
      <div className="flex gap-1 bg-white rounded-xl p-1 w-fit border border-border/40">
        <Link href="/pickup" className="px-4 py-2 rounded-lg text-sm font-medium text-muted-foreground hover:text-[#160800] transition-colors">
          Overview
        </Link>
        <Link href="/pickup/analytics" className="px-4 py-2 rounded-lg text-sm font-medium bg-[#160800] text-white shadow-sm">
          Analytics
        </Link>
      </div>
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

      {/* Revenue breakdown — gross / discounts / net / collected.
          Splitting the single "Total Revenue" card surfaces how much
          margin is being given away each period and lines up with how
          operators read a P&L. */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="bg-white rounded-2xl p-4">
          <p className="text-2xl font-bold text-[#160800]">{loading ? "—" : formatRM(grossRevenue / 100)}</p>
          <p className="text-xs text-muted-foreground mt-0.5">Gross revenue</p>
          <p className="text-[10px] text-muted-foreground/70 mt-1">Pre-discount, pre-SST</p>
        </div>
        <div className="bg-white rounded-2xl p-4">
          <p className="text-2xl font-bold text-[#c05040]">
            {loading ? "—" : `−${formatRM(totalDiscount / 100)}`}
          </p>
          <p className="text-xs text-muted-foreground mt-0.5">Discounts</p>
          <p className="text-[10px] text-muted-foreground/70 mt-1">
            {loading ? "—" : `${(discountRate * 100).toFixed(1)}% of gross`}
          </p>
        </div>
        <div className="bg-white rounded-2xl p-4">
          <p className="text-2xl font-bold text-[#160800]">{loading ? "—" : formatRM(netRevenue / 100)}</p>
          <p className="text-xs text-muted-foreground mt-0.5">Net revenue</p>
          <p className="text-[10px] text-muted-foreground/70 mt-1">Gross − discounts, ex-SST</p>
        </div>
        <div className="bg-white rounded-2xl p-4">
          <p className="text-2xl font-bold text-[#160800]">
            {loading ? "—" : orders.length.toLocaleString()}
            <span className="text-sm font-medium text-muted-foreground ml-2">
              {loading ? "" : `· AOV ${formatRM(avgOrder / 100)}`}
            </span>
          </p>
          <p className="text-xs text-muted-foreground mt-0.5">Orders</p>
          <p className="text-[10px] text-muted-foreground/70 mt-1">
            {loading ? "—" : `Collected ${formatRM(totalRevenue / 100)} incl SST`}
          </p>
        </div>
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
                formatter={(value) => [`${formatRM((value as number))}`, "Revenue"]}
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
                formatter={(value) => [`${formatRM((value as number))}`, "Revenue"]}
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

      {/* ── Engagement & retention ───────────────────────────────────────
          Acquisition is approximated from members-with-orders since the
          members table doesn't track signup source. Once App Store /
          Play Console / Amplitude pulls land, the "downloads" half of
          the funnel can layer in here. */}
      <div className="pt-2">
        <h2 className="text-lg font-bold text-[#160800]">Engagement</h2>
        <p className="text-xs text-muted-foreground mt-0.5">
          Activity, retention, and loyalty engagement across the period.
        </p>
      </div>

      {/* Engagement KPI row */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        {[
          { label: "New members",    value: engagement ? engagement.acquisition.totalNew.toLocaleString()    : "—",
            hint: "First pickup order" },
          { label: "Active members", value: engagement ? engagement.acquisition.totalActive.toLocaleString() : "—",
            hint: `${engagement ? engagement.acquisition.totalOrdersInRange.toLocaleString() : "—"} orders` },
          { label: "Repeat rate",    value: engagement ? `${Math.round(engagement.acquisition.repeatRate * 100)}%` : "—",
            hint: "Members with 2+ orders" },
          { label: "Stickiness",     value: engagement ? `${Math.round(engagement.activity.dauMauRatio * 100)}%` : "—",
            hint: `DAU ${engagement?.activity.dau ?? 0} / MAU ${engagement?.activity.mau ?? 0}` },
        ].map(({ label, value, hint }) => (
          <div key={label} className="bg-white rounded-2xl p-4">
            <p className="text-2xl font-bold text-[#160800]">{engLoading ? "—" : value}</p>
            <p className="text-xs text-muted-foreground mt-0.5">{label}</p>
            <p className="text-[10px] text-muted-foreground/70 mt-1">{hint}</p>
          </div>
        ))}
      </div>

      {/* New vs Active per day */}
      <div className="bg-white rounded-2xl p-5">
        <h2 className="font-bold text-sm mb-4">New vs Returning Activity</h2>
        {engLoading ? (
          <div className="h-48 flex items-center justify-center text-sm text-muted-foreground">Loading...</div>
        ) : !engagement ? (
          <div className="h-48 flex items-center justify-center text-sm text-muted-foreground">No data</div>
        ) : (
          <ResponsiveContainer width="100%" height={220}>
            <AreaChart
              data={engagement.acquisition.newMembersByDay.map((d) => ({
                ...d,
                returning: Math.max(0, d.active - d.new),
                label: fmtDate(d.date + "T00:00:00", range),
              }))}
              margin={{ top: 5, right: 10, left: -10, bottom: 0 }}
            >
              <defs>
                <linearGradient id="newGrad" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor="#e67e22" stopOpacity={0.4} />
                  <stop offset="95%" stopColor="#e67e22" stopOpacity={0} />
                </linearGradient>
                <linearGradient id="retGrad" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor="#160800" stopOpacity={0.25} />
                  <stop offset="95%" stopColor="#160800" stopOpacity={0} />
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
              <XAxis dataKey="label" tick={{ fontSize: 11 }} tickLine={false} axisLine={false} />
              <YAxis tick={{ fontSize: 11 }} tickLine={false} axisLine={false} allowDecimals={false} />
              <Tooltip contentStyle={{ borderRadius: 10, border: "1px solid #e5e7eb", fontSize: 12 }} />
              <Area type="monotone" dataKey="returning" stackId="1" name="Returning orders" stroke="#160800" strokeWidth={2} fill="url(#retGrad)" />
              <Area type="monotone" dataKey="new"       stackId="1" name="First-time members" stroke="#e67e22" strokeWidth={2} fill="url(#newGrad)" />
            </AreaChart>
          </ResponsiveContainer>
        )}
      </div>

      {/* Cohort retention heatmap */}
      <div className="bg-white rounded-2xl p-5">
        <h2 className="font-bold text-sm mb-1">Weekly Retention Cohorts</h2>
        <p className="text-[11px] text-muted-foreground mb-4">
          % of each week&apos;s first-time members that placed another order in weeks 1–4 since.
        </p>
        {engLoading ? (
          <div className="h-32 flex items-center justify-center text-sm text-muted-foreground">Loading...</div>
        ) : !engagement || engagement.cohorts.weeks.length === 0 ? (
          <div className="h-32 flex items-center justify-center text-sm text-muted-foreground">Not enough history yet</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="text-xs w-full">
              <thead>
                <tr className="text-muted-foreground">
                  <th className="text-left font-medium pb-2 pr-3">Cohort (wk of)</th>
                  <th className="text-right font-medium pb-2 pr-3">Size</th>
                  <th className="text-center font-medium pb-2 px-1">+1w</th>
                  <th className="text-center font-medium pb-2 px-1">+2w</th>
                  <th className="text-center font-medium pb-2 px-1">+3w</th>
                  <th className="text-center font-medium pb-2 px-1">+4w</th>
                </tr>
              </thead>
              <tbody>
                {engagement.cohorts.weeks.map((wk) => (
                  <tr key={wk.label} className="border-t border-muted/30">
                    <td className="py-1.5 pr-3 text-[#160800] font-medium whitespace-nowrap">
                      {new Date(wk.label).toLocaleDateString("en-MY", { day: "numeric", month: "short" })}
                    </td>
                    <td className="py-1.5 pr-3 text-right text-muted-foreground">{wk.size}</td>
                    {wk.retention.map((p, i) => (
                      <td key={i} className="px-1 py-1">
                        <div
                          className="text-center rounded-md py-1.5 text-[11px] font-semibold"
                          style={{
                            backgroundColor: cohortBg(p),
                            color: p > 0.4 ? "#fff" : "#160800",
                          }}
                        >
                          {wk.size > 0 ? `${Math.round(p * 100)}%` : "—"}
                        </div>
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Tier distribution */}
      <div className="bg-white rounded-2xl p-5">
        <h2 className="font-bold text-sm mb-1">Loyalty Tier Distribution</h2>
        <p className="text-[11px] text-muted-foreground mb-4">
          Snapshot across all members in this brand (not range-bound).
        </p>
        {engLoading ? (
          <div className="h-40 flex items-center justify-center text-sm text-muted-foreground">Loading...</div>
        ) : !engagement || engagement.tiers.length === 0 ? (
          <div className="h-40 flex items-center justify-center text-sm text-muted-foreground">No tiers configured</div>
        ) : (
          <div className="space-y-2">
            {engagement.tiers.map((t) => (
              <div key={t.slug} className="flex items-center gap-3">
                <div className="w-20 text-[12px] font-semibold text-[#160800] capitalize">{t.tier}</div>
                <div className="flex-1 bg-muted/30 rounded-full h-5 relative overflow-hidden">
                  <div
                    className="absolute inset-y-0 left-0 rounded-full"
                    style={{
                      width: `${Math.max(2, t.pct * 100)}%`,
                      backgroundColor:
                        t.slug === "elite"  ? "#0a0c12" :
                        t.slug === "gold"   ? "#FFD700" :
                        t.slug === "silver" ? "#9ca3af" :
                        t.slug === "bronze" ? "#e2725b" : "#d6d3d1",
                    }}
                  />
                </div>
                <div className="w-28 text-right text-[12px] text-muted-foreground">
                  {t.count.toLocaleString()} ({Math.round(t.pct * 100)}%)
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Reward engagement */}
      <div className="bg-white rounded-2xl p-5">
        <h2 className="font-bold text-sm mb-1">Reward Engagement</h2>
        <p className="text-[11px] text-muted-foreground mb-4">
          Vouchers issued, used, and redemptions in this period — plus all-time funnel.
        </p>
        {engLoading ? (
          <div className="h-32 flex items-center justify-center text-sm text-muted-foreground">Loading...</div>
        ) : !engagement ? (
          <div className="h-32 flex items-center justify-center text-sm text-muted-foreground">No data</div>
        ) : (
          <>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-5">
              {[
                { label: "Issued (range)",  value: engagement.rewards.rangeIssued.toLocaleString() },
                { label: "Used (range)",    value: engagement.rewards.rangeUsed.toLocaleString() },
                { label: "Redemptions",     value: engagement.rewards.rangeRedemptions.toLocaleString() },
                { label: "Lifetime redemption rate", value: `${Math.round(engagement.rewards.redemptionRate * 100)}%` },
              ].map((k) => (
                <div key={k.label} className="bg-muted/20 rounded-xl p-3">
                  <div className="text-lg font-bold text-[#160800]">{k.value}</div>
                  <div className="text-[10px] text-muted-foreground mt-0.5">{k.label}</div>
                </div>
              ))}
            </div>
            {engagement.rewards.byReward.length === 0 ? (
              <div className="text-xs text-muted-foreground py-2">No reward activity in this period.</div>
            ) : (
              <div>
                <div className="grid grid-cols-[1fr_70px_70px_80px] gap-2 px-2 py-1 text-[10px] font-semibold text-muted-foreground uppercase tracking-wide">
                  <span>Reward</span>
                  <span className="text-right">Issued</span>
                  <span className="text-right">Used</span>
                  <span className="text-right">Redeemed</span>
                </div>
                {engagement.rewards.byReward.slice(0, 10).map((r) => (
                  <div
                    key={r.rewardId}
                    className="grid grid-cols-[1fr_70px_70px_80px] gap-2 items-center px-2 py-2 rounded-lg hover:bg-muted/20 transition-colors"
                  >
                    <div className="min-w-0">
                      <div className="text-sm font-medium truncate">{r.name}</div>
                      <div className="text-[10px] text-muted-foreground capitalize">
                        {r.rewardType.replace(/_/g, " ")}{r.autoIssue ? " · auto-issued" : ""}
                      </div>
                    </div>
                    <span className="text-sm text-right">{r.issued.toLocaleString()}</span>
                    <span className="text-sm text-right">{r.used.toLocaleString()}</span>
                    <span className="text-sm font-semibold text-right">{r.redeemed.toLocaleString()}</span>
                  </div>
                ))}
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
