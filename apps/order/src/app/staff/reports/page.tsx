"use client";

import { formatRM } from "@celsius/shared";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2, ShoppingBag, TrendingUp, Clock, CheckCircle, XCircle } from "lucide-react";
import { getSession, staffAuthHeaders } from "@/lib/staff-auth";
import { StaffNav } from "@/components/staff-nav";

interface DayStats {
  totalOrders:     number;
  completedOrders: number;
  cancelledOrders: number;
  revenue:         number;   // sen
  avgOrderValue:   number;   // sen
  topItems:        { name: string; qty: number }[];
  busyHours:       { hour: number; count: number }[];
}

export default function StaffReportsPage() {
  const router  = useRouter();
  const [session, setSession] = useState<ReturnType<typeof getSession>>(null);
  const [mounted, setMounted] = useState(false);

  const [stats,   setStats]   = useState<DayStats | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const s = getSession();
    if (!s) { router.replace("/staff/login"); return; }
    setSession(s);
    setMounted(true);
  }, [router]);

  useEffect(() => {
    if (!session) return;
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    fetch(`/api/staff/orders?store=${session.storeId}&from=${today.toISOString()}`, { headers: staffAuthHeaders() })
      .then((r) => r.json())
      .then((orders: {
        status: string;
        total: number;
        created_at: string;
        order_items: { product_name: string; quantity: number }[];
      }[]) => {
        if (!Array.isArray(orders)) { setLoading(false); return; }

        const completed  = orders.filter((o) => o.status === "completed");
        const cancelled  = orders.filter((o) => o.status === "failed");
        const revenue    = completed.reduce((s, o) => s + (o.total ?? 0), 0);
        const avgValue   = completed.length ? Math.round(revenue / completed.length) : 0;

        const itemMap: Record<string, number> = {};
        for (const o of completed) {
          for (const item of (o.order_items ?? [])) {
            itemMap[item.product_name] = (itemMap[item.product_name] ?? 0) + item.quantity;
          }
        }
        const topItems = Object.entries(itemMap)
          .sort(([, a], [, b]) => b - a)
          .slice(0, 5)
          .map(([name, qty]) => ({ name, qty }));

        const hourMap: Record<number, number> = {};
        for (const o of completed) {
          const h = new Date(o.created_at).getHours();
          hourMap[h] = (hourMap[h] ?? 0) + 1;
        }
        const busyHours = Object.entries(hourMap)
          .sort(([a], [b]) => Number(a) - Number(b))
          .map(([h, count]) => ({ hour: Number(h), count }));

        setStats({
          totalOrders: orders.length,
          completedOrders: completed.length,
          cancelledOrders: cancelled.length,
          revenue,
          avgOrderValue: avgValue,
          topItems,
          busyHours,
        });
        setLoading(false);
      })
      .catch(() => setLoading(false));
  }, [session]);

  if (!mounted || !session) return null;

  function fmt(sen: number) { return `${formatRM((sen / 100))}`; }
  function hour12(h: number) {
    const ampm = h < 12 ? "am" : "pm";
    return `${h % 12 || 12}${ampm}`;
  }

  const peakHour = stats?.busyHours.length
    ? stats.busyHours.reduce((p, c) => c.count > p.count ? c : p, stats.busyHours[0])
    : null;

  return (
    <div className="min-h-dvh bg-[#f0f0f0] flex flex-col pb-20">
      {/* Header */}
      <header className="bg-[#160800] text-white px-4 pt-12 pb-4 shrink-0">
        <h1 className="font-black text-xl">Today&apos;s Report</h1>
        <p className="text-white/50 text-xs mt-0.5 truncate">
          {session.storeName} · {new Date().toLocaleDateString("en-MY", { weekday: "long", day: "numeric", month: "long" })}
        </p>
      </header>

      <div className="flex-1 overflow-y-auto px-4 py-4 space-y-4">
        {loading ? (
          <div className="flex items-center justify-center py-20">
            <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
          </div>
        ) : !stats ? (
          <p className="text-center text-sm text-muted-foreground py-20">Could not load report</p>
        ) : (
          <>
            {/* Revenue card */}
            <div className="bg-[#160800] rounded-2xl px-5 py-5">
              <p className="text-white/50 text-xs font-semibold uppercase tracking-wider mb-1">Revenue</p>
              <p className="text-white font-black text-4xl tabular-nums">{fmt(stats.revenue)}</p>
              <p className="text-white/40 text-xs mt-2">
                {stats.completedOrders} completed · avg {fmt(stats.avgOrderValue)}
              </p>
            </div>

            {/* Stats grid: completed / cancelled / avg basket */}
            <div className="grid grid-cols-3 gap-2.5">
              <StatCard
                Icon={CheckCircle}
                iconCls="text-green-500"
                value={stats.completedOrders}
                label="Done"
              />
              <StatCard
                Icon={XCircle}
                iconCls={stats.cancelledOrders > 0 ? "text-red-500" : "text-muted-foreground/40"}
                value={stats.cancelledOrders}
                label="Cancelled"
                muted={stats.cancelledOrders === 0}
              />
              <StatCard
                Icon={TrendingUp}
                iconCls="text-blue-500"
                value={fmt(stats.avgOrderValue)}
                label="Avg basket"
                small
              />
            </div>

            {/* Top items */}
            {stats.topItems.length > 0 && (
              <div className="bg-white rounded-2xl overflow-hidden">
                <div className="px-4 py-3 border-b border-border/50">
                  <p className="text-sm font-bold text-[#160800]">Top items</p>
                </div>
                {stats.topItems.map((item) => {
                  const max = stats.topItems[0].qty;
                  return (
                    <div key={item.name} className="px-4 py-3 border-b border-border/40 last:border-0">
                      <div className="flex items-center justify-between mb-1.5">
                        <span className="text-sm font-semibold text-[#160800] truncate flex-1">{item.name}</span>
                        <span className="text-sm font-bold ml-2 shrink-0 tabular-nums">{item.qty}×</span>
                      </div>
                      <div className="h-1.5 bg-[#f0f0f0] rounded-full overflow-hidden">
                        <div
                          className="h-full bg-[#160800] rounded-full"
                          style={{ width: `${(item.qty / max) * 100}%` }}
                        />
                      </div>
                    </div>
                  );
                })}
              </div>
            )}

            {/* Busy hours */}
            {stats.busyHours.length > 0 && (
              <div className="bg-white rounded-2xl overflow-hidden">
                <div className="px-4 py-3 border-b border-border/50 flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <Clock className="h-4 w-4 text-muted-foreground" />
                    <p className="text-sm font-bold text-[#160800]">Orders by hour</p>
                  </div>
                  {peakHour && (
                    <p className="text-[11px] text-muted-foreground">
                      Peak: <span className="font-bold text-[#160800]">{hour12(peakHour.hour)}</span> · {peakHour.count}
                    </p>
                  )}
                </div>
                <div className="px-4 pt-4 pb-3">
                  <div className="flex items-end gap-1.5 h-24 border-b border-border/40">
                    {stats.busyHours.map(({ hour, count }) => {
                      const max = Math.max(...stats.busyHours.map((h) => h.count));
                      const isPeak = peakHour?.hour === hour;
                      return (
                        <div key={hour} className="flex-1 flex flex-col items-center gap-1 justify-end h-full">
                          <span className="text-[9px] font-bold text-[#160800] tabular-nums">{count}</span>
                          <div
                            className={`w-full rounded-t transition-colors ${isPeak ? "bg-amber-500" : "bg-[#160800]"}`}
                            style={{ height: `${(count / max) * 60}px`, minHeight: 4 }}
                          />
                        </div>
                      );
                    })}
                  </div>
                  <div className="flex gap-1.5 mt-1.5">
                    {stats.busyHours.map(({ hour }) => (
                      <span key={hour} className="flex-1 text-center text-[9px] text-muted-foreground">{hour12(hour)}</span>
                    ))}
                  </div>
                </div>
              </div>
            )}

            {stats.totalOrders === 0 && (
              <div className="text-center py-10">
                <ShoppingBag className="h-10 w-10 text-muted-foreground/30 mx-auto mb-3" />
                <p className="text-sm text-muted-foreground">No orders yet today</p>
              </div>
            )}
          </>
        )}
      </div>

      <StaffNav active="reports" />
    </div>
  );
}

function StatCard({
  Icon,
  iconCls,
  value,
  label,
  small,
  muted,
}: {
  Icon: React.ComponentType<{ className?: string }>;
  iconCls: string;
  value: number | string;
  label: string;
  small?: boolean;
  muted?: boolean;
}) {
  return (
    <div className={`bg-white rounded-2xl p-3 text-center ${muted ? "opacity-70" : ""}`}>
      <Icon className={`h-5 w-5 mx-auto mb-1 ${iconCls}`} />
      <p className={`font-black text-[#160800] tabular-nums ${small ? "text-base leading-tight" : "text-2xl"}`}>
        {value}
      </p>
      <p className="text-[11px] text-muted-foreground mt-0.5">{label}</p>
    </div>
  );
}
