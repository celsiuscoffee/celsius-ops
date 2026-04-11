"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { createClient } from "@/lib/supabase-browser";

type KDSOrder = {
  id: string;
  order_number: string;
  order_type: string;
  table_number: string | null;
  queue_number: string | null;
  status: string;
  created_at: string;
  pos_order_items: KDSItem[];
};

type KDSItem = {
  id: string;
  product_name: string;
  variant_name: string | null;
  modifiers: unknown;
  quantity: number;
  notes: string | null;
  kitchen_station: string | null;
  kitchen_status: string;
};

// Web Audio API beep for new orders (no file needed)
function playNewOrderSound() {
  try {
    const ctx = new AudioContext();
    // Two-tone chime
    const play = (freq: number, start: number, dur: number) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.type = "sine";
      osc.frequency.value = freq;
      gain.gain.setValueAtTime(0.3, ctx.currentTime + start);
      gain.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + start + dur);
      osc.start(ctx.currentTime + start);
      osc.stop(ctx.currentTime + start + dur);
    };
    play(880, 0, 0.15);
    play(1100, 0.15, 0.2);
    play(1320, 0.3, 0.25);
  } catch {
    // Audio not available
  }
}

export default function KDSPage() {
  const [orders, setOrders] = useState<KDSOrder[]>([]);
  const [activeStation, setActiveStation] = useState("all");
  const [stations, setStations] = useState<string[]>([]);
  const [, setTick] = useState(0);
  const [outletId, setOutletId] = useState<string | null>(null);
  const [newOrderIds, setNewOrderIds] = useState<Set<string>>(new Set());
  const prevOrderIdsRef = useRef<Set<string>>(new Set());
  const supabase = createClient();

  const loadOrders = useCallback(async (oid: string) => {
    const { data } = await supabase
      .from("pos_orders")
      .select("*, pos_order_items(*)")
      .eq("outlet_id", oid)
      .in("status", ["sent_to_kitchen", "ready", "open"])
      .order("created_at", { ascending: true });

    const loaded = (data ?? []) as KDSOrder[];
    const currentIds = new Set(loaded.map((o) => o.id));

    // Detect truly new orders (not in previous load)
    const prevIds = prevOrderIdsRef.current;
    if (prevIds.size > 0) {
      const brandNew = loaded.filter((o) => !prevIds.has(o.id));
      if (brandNew.length > 0) {
        playNewOrderSound();
        setNewOrderIds((prev) => {
          const next = new Set(prev);
          brandNew.forEach((o) => next.add(o.id));
          return next;
        });
        // Clear highlight after 8 seconds
        setTimeout(() => {
          setNewOrderIds((prev) => {
            const next = new Set(prev);
            brandNew.forEach((o) => next.delete(o.id));
            return next;
          });
        }, 8000);
      }
    }

    prevOrderIdsRef.current = currentIds;
    setOrders(loaded);
  }, [supabase]);

  useEffect(() => {
    async function init() {
      const { data: outlets } = await supabase.from("outlets").select("id").limit(1);
      const oid = outlets?.[0]?.id;
      if (!oid) return;
      setOutletId(oid);

      const { data: ks } = await supabase
        .from("pos_kitchen_stations")
        .select("name")
        .eq("outlet_id", oid)
        .eq("is_active", true)
        .order("sort_order");
      setStations((ks ?? []).map((s: { name: string }) => s.name));

      await loadOrders(oid);

      supabase
        .channel("kds-live")
        .on("postgres_changes", { event: "*", schema: "public", table: "pos_orders", filter: `outlet_id=eq.${oid}` }, () => loadOrders(oid))
        .on("postgres_changes", { event: "*", schema: "public", table: "pos_order_items" }, () => loadOrders(oid))
        .subscribe();
    }
    init();
  }, [supabase, loadOrders]);

  // Timer tick every 5 seconds for more responsive elapsed time
  useEffect(() => {
    const interval = setInterval(() => setTick((t) => t + 1), 5000);
    return () => clearInterval(interval);
  }, []);

  function getElapsed(dateStr: string): { mins: number; secs: number } {
    const diff = Date.now() - new Date(dateStr).getTime();
    return { mins: Math.floor(diff / 60000), secs: Math.floor((diff % 60000) / 1000) };
  }

  function formatElapsed(dateStr: string): string {
    const { mins, secs } = getElapsed(dateStr);
    if (mins === 0) return `${secs}s`;
    return `${mins}m`;
  }

  function getTimerColor(mins: number): string {
    if (mins < 5) return "bg-kds-green text-white";
    if (mins < 10) return "bg-kds-yellow text-black";
    return "bg-kds-red text-white animate-pulse";
  }

  // Filter by station
  const filteredOrders = activeStation === "all"
    ? orders
    : orders.filter((o) => o.pos_order_items.some((i) => i.kitchen_station === activeStation));

  const pendingOrders = filteredOrders.filter((o) =>
    o.pos_order_items.some((i) => i.kitchen_status !== "done")
  );

  async function markItemStatus(orderId: string, itemId: string, newStatus: string) {
    await supabase
      .from("pos_order_items")
      .update({ kitchen_status: newStatus })
      .eq("id", itemId);

    const order = orders.find((o) => o.id === orderId);
    if (order) {
      const updatedItems = order.pos_order_items.map((i) =>
        i.id === itemId ? { ...i, kitchen_status: newStatus } : i
      );
      if (updatedItems.every((i) => i.kitchen_status === "done")) {
        await supabase.from("pos_orders").update({ status: "ready" }).eq("id", orderId);
      }
    }

    if (outletId) await loadOrders(outletId);
  }

  async function markOrderDone(orderId: string) {
    await supabase
      .from("pos_order_items")
      .update({ kitchen_status: "done" })
      .eq("order_id", orderId);
    await supabase
      .from("pos_orders")
      .update({ status: "ready" })
      .eq("id", orderId);
    if (outletId) await loadOrders(outletId);
  }

  function formatModifiers(mods: unknown): string[] {
    if (!Array.isArray(mods)) return [];
    return mods.map((m: { group_name?: string; option?: { name?: string } }) =>
      m.option?.name ?? m.group_name ?? ""
    ).filter(Boolean);
  }

  function getProgress(items: KDSItem[]): { done: number; total: number; pct: number } {
    const total = items.length;
    const done = items.filter((i) => i.kitchen_status === "done").length;
    return { done, total, pct: total > 0 ? Math.round((done / total) * 100) : 0 };
  }

  return (
    <div className="pos-screen flex h-screen flex-col bg-surface text-text">
      {/* Header */}
      <div className="flex items-center justify-between border-b border-border px-6 py-3">
        <div className="flex items-center gap-3">
          <img src="/images/celsius-logo-sm.jpg" alt="Celsius" width={32} height={32} className="rounded-lg" />
          <h1 className="text-lg font-semibold">Kitchen Display</h1>
        </div>
        <div className="flex gap-2">
          <button onClick={() => setActiveStation("all")}
            className={`rounded-lg px-4 py-1.5 text-sm font-medium transition-colors ${activeStation === "all" ? "bg-brand text-white" : "bg-surface-raised text-text-muted hover:bg-surface-hover"}`}>
            All Stations
          </button>
          {stations.map((s) => (
            <button key={s} onClick={() => setActiveStation(s)}
              className={`rounded-lg px-4 py-1.5 text-sm font-medium transition-colors ${activeStation === s ? "bg-brand text-white" : "bg-surface-raised text-text-muted hover:bg-surface-hover"}`}>
              {s}
            </button>
          ))}
        </div>
        <div className="text-sm text-text-muted">
          {pendingOrders.length} active order{pendingOrders.length !== 1 ? "s" : ""}
        </div>
      </div>

      {/* Orders Grid */}
      <div className="flex-1 overflow-y-auto p-4">
        {pendingOrders.length === 0 ? (
          <div className="flex h-full items-center justify-center text-text-dim">
            <div className="text-center">
              <span className="text-5xl">&#x1F373;</span>
              <p className="mt-4 text-lg">No pending orders</p>
              <p className="text-sm text-text-muted">Orders will appear here in real-time</p>
            </div>
          </div>
        ) : (
          <div className="grid grid-cols-2 gap-4 lg:grid-cols-3 xl:grid-cols-4">
            {pendingOrders.map((order) => {
              const { mins } = getElapsed(order.created_at);
              const items = activeStation === "all"
                ? order.pos_order_items
                : order.pos_order_items.filter((i) => i.kitchen_station === activeStation);
              const allDone = items.every((i) => i.kitchen_status === "done");
              const progress = getProgress(items);
              const isNew = newOrderIds.has(order.id);

              return (
                <div key={order.id}
                  className={`rounded-xl border transition-all ${
                    isNew ? "border-brand ring-2 ring-brand/40 animate-pulse"
                    : allDone ? "border-kds-green/50 bg-kds-green/5"
                    : "border-border bg-surface-raised"
                  }`}>
                  {/* New order banner */}
                  {isNew && (
                    <div className="bg-brand px-4 py-1 text-center text-xs font-bold text-white">
                      NEW ORDER
                    </div>
                  )}

                  {/* Order Header */}
                  <div className="flex items-center justify-between border-b border-border px-4 py-2">
                    <div className="flex items-center gap-2">
                      <span className={`rounded px-2 py-0.5 text-xs font-bold ${
                        order.order_type === "dine_in" ? "bg-blue-500/20 text-blue-400" : "bg-orange-500/20 text-orange-400"
                      }`}>
                        {order.order_type === "dine_in" ? `TABLE ${order.table_number}` : order.queue_number ?? "TKW"}
                      </span>
                      <span className="text-xs text-text-dim">{order.order_number}</span>
                    </div>
                    <span className={`rounded-full px-2 py-0.5 text-xs font-bold ${getTimerColor(mins)}`}>
                      {formatElapsed(order.created_at)}
                    </span>
                  </div>

                  {/* Progress bar */}
                  {progress.total > 1 && (
                    <div className="px-4 pt-2">
                      <div className="flex items-center gap-2">
                        <div className="h-1 flex-1 rounded-full bg-surface">
                          <div
                            className="h-1 rounded-full bg-kds-green transition-all"
                            style={{ width: `${progress.pct}%` }}
                          />
                        </div>
                        <span className="text-[10px] text-text-dim">{progress.done}/{progress.total}</span>
                      </div>
                    </div>
                  )}

                  {/* Items */}
                  <div className="divide-y divide-border/50 px-4">
                    {items.map((item) => (
                      <div key={item.id} className={`flex items-start justify-between py-3 ${item.kitchen_status === "done" ? "opacity-40" : ""}`}>
                        <div className="flex-1">
                          <span className="text-sm font-semibold">
                            {item.quantity > 1 && <span className="text-brand">{item.quantity}x </span>}
                            {item.product_name}
                          </span>
                          {item.variant_name && <p className="text-xs text-text-muted">{item.variant_name}</p>}
                          {formatModifiers(item.modifiers).length > 0 && (
                            <p className="text-xs text-text-muted">{formatModifiers(item.modifiers).join(", ")}</p>
                          )}
                          {item.notes && (
                            <p className="mt-1 rounded bg-kds-yellow/20 px-2 py-0.5 text-xs font-bold text-kds-yellow">
                              !! {item.notes}
                            </p>
                          )}
                        </div>
                        <button
                          onClick={() => markItemStatus(order.id, item.id, item.kitchen_status === "pending" ? "preparing" : "done")}
                          disabled={item.kitchen_status === "done"}
                          className={`ml-2 rounded-lg px-3 py-1 text-xs font-medium transition-colors ${
                            item.kitchen_status === "done" ? "bg-kds-green/20 text-kds-green"
                            : item.kitchen_status === "preparing" ? "bg-kds-yellow/20 text-kds-yellow hover:bg-kds-green/20 hover:text-kds-green"
                            : "bg-surface text-text-muted hover:bg-kds-yellow/20 hover:text-kds-yellow"
                          }`}>
                          {item.kitchen_status === "done" ? "Done" : item.kitchen_status === "preparing" ? "Mark Done" : "Start"}
                        </button>
                      </div>
                    ))}
                  </div>

                  {/* Complete */}
                  <div className="border-t border-border p-3">
                    <button onClick={() => markOrderDone(order.id)} disabled={allDone}
                      className={`w-full rounded-lg py-2 text-sm font-semibold transition-colors ${
                        allDone ? "bg-kds-green/20 text-kds-green" : "bg-kds-green text-white hover:bg-kds-green/80"
                      }`}>
                      {allDone ? "Order Complete" : "Complete All"}
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
