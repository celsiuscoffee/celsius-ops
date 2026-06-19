import { useCallback, useEffect, useRef, useState } from "react";
import { supabase } from "./supabase";

/**
 * Live Grab + Pickup + Counter order feed for the POS-native register's
 * order-management panel (an on-register KDS). Lets the cashier see
 * incoming / in-progress orders and bump them through to handover, just
 * like the kitchen display.
 *
 * Three sources, unified:
 *   - Pickup app orders  → `orders`     (store_id, order_type pickup/takeaway)
 *   - GrabFood orders    → `pos_orders` (source='grabfood', outlet_id)
 *   - Counter (till)     → `pos_orders` (source='pos', outlet_id) — dine-in
 *                          "Stand #" + takeaway "Queue #" rung up at the till.
 *
 * Pickup/Grab use a STATUS lifecycle (paid → … → ready → completed). Counter
 * orders are a completed sale the instant they're rung up (so the Z-report /
 * sales totals stay exact — see migration 030), so their live state is the
 * separate `served_at` timestamp instead: served_at IS NULL = still being
 * served. Marking one served stamps served_at and it drops off here.
 *
 * Dine-in QR orders live in `orders` too but are owned by the Tables
 * panel, so we filter them out here (order_type != dine_in).
 *
 * Reads are anon SELECT + Realtime. Status / served_at writes do NOT go through
 * the anon client — the `orders` RLS only allows anon UPDATE on unprinted rows,
 * and these are already printed. The register posts to the service-role route
 * /api/pos/order-status instead (see advanceStatus / markCounterServed in
 * register.tsx). On success the Realtime UPDATE flows back here and the card
 * re-buckets automatically.
 */

// Statuses that are "in the kitchen / awaiting handover" — what the
// cashier still needs to act on. completed / cancelled / failed drop off.
const PICKUP_LIVE = ["paid", "sent_to_kitchen", "preparing", "ready"];
// "open" is included so a Grab order that an out-of-order webhook push re-maps
// to "open" still surfaces here for the cashier to action, instead of silently
// vanishing off the live panel — which is what stranded orders at "open" with
// no way to advance them. Bounded by GRAB_WINDOW_MS below so a backlog of stale
// "open" orders can't flood the live KDS (and its serving-time alarm).
const GRAB_LIVE = ["open", "sent_to_kitchen", "preparing", "ready"];
// Counter orders are status='completed' from the start, so "live" is served_at
// IS NULL — but a voided/refunded sale must still drop off. These statuses are
// "dead" and are filtered out regardless of served_at.
const COUNTER_DEAD = new Set(["cancelled", "failed", "refunded", "voided"]);
// Only surface recent un-served counter orders, so an order someone forgot to
// mark served eventually falls off the live queue (and stops the alarm) instead
// of lingering — and the partial-index query stays bounded.
const COUNTER_WINDOW_MS = 6 * 60 * 60 * 1000; // last 6h
// Bound the live Grab list to recent orders. GrabFood orders fulfil within ~1h,
// so a live order is always well inside this window; the bound just stops a
// historical backlog of un-advanced "open" orders from flooding the panel.
const GRAB_WINDOW_MS = 12 * 60 * 60 * 1000; // last 12h
const SAFETY_REFRESH_MS = 60 * 1000; // backstop refetch if a Realtime event is dropped

export type KdsSource = "pickup" | "grab" | "counter";

export type KdsItem = { name: string; qty: number; variant?: string | null };

export type KdsOrder = {
  uid: string; // `${source}:${id}` — stable React key
  id: string;
  source: KdsSource;
  orderNumber: string;
  status: string;
  orderType: string;
  total: number; // sen
  createdAt: string;
  items: KdsItem[];
  // Counter only — the placard / queue number shown on the card so a runner
  // knows where it goes (dine-in → Stand #, takeaway → Queue #).
  tableNumber?: string | null;
  queueNumber?: string | null;
};

type PickupRow = {
  id: string;
  order_number: string;
  status: string;
  order_type: string | null;
  total: number | null;
  created_at: string;
};
type GrabRow = {
  id: string;
  order_number: string;
  status: string;
  order_type: string | null;
  total: number | null;
  created_at: string;
};
type CounterRow = {
  id: string;
  order_number: string;
  status: string;
  order_type: string | null;
  table_number: string | null;
  queue_number: string | null;
  total: number | null;
  created_at: string;
};

export function useOrdersPanel(outletId: string | null | undefined) {
  const [storeId, setStoreId] = useState<string | null>(null);
  const [orders, setOrders] = useState<KdsOrder[]>([]);
  const [loading, setLoading] = useState(true);
  const reloadTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // 1. POS outlet → pickup store_id (same mapping the printer/tables use).
  useEffect(() => {
    let cancelled = false;
    setStoreId(null);
    if (!outletId) return;
    (async () => {
      const { data } = await supabase
        .from("outlet_settings")
        .select("store_id")
        .eq("loyalty_outlet_id", outletId)
        .maybeSingle();
      if (!cancelled) setStoreId((data as { store_id?: string } | null)?.store_id ?? null);
    })();
    return () => { cancelled = true; };
  }, [outletId]);

  const load = useCallback(async () => {
    // Counter + Grab are keyed by outletId alone, so the panel works even before
    // (or without) a pickup store_id mapping — only the Pickup query needs it.
    if (!outletId) return;
    // ── Pickup orders + their items (only when this outlet has a pickup store) ──
    let pickups: PickupRow[] = [];
    if (storeId) {
      const { data: pickupRows } = await supabase
        .from("orders")
        .select("id, order_number, status, order_type, total, created_at")
        .eq("store_id", storeId)
        .neq("order_type", "dine_in")
        .in("status", PICKUP_LIVE)
        .order("created_at", { ascending: true });
      pickups = (pickupRows ?? []) as PickupRow[];
    }

    // ── Grab orders + their items ──
    const grabSince = new Date(Date.now() - GRAB_WINDOW_MS).toISOString();
    const { data: grabRows } = await supabase
      .from("pos_orders")
      .select("id, order_number, status, order_type, total, created_at")
      .eq("source", "grabfood")
      .eq("outlet_id", outletId)
      .in("status", GRAB_LIVE)
      .gte("created_at", grabSince)
      .order("created_at", { ascending: true });
    const grabs = (grabRows ?? []) as GrabRow[];

    // ── Counter (till) orders — un-served, recent. Live = served_at IS NULL
    //    (status stays 'completed', so this is independent of the sale total). ──
    const counterSince = new Date(Date.now() - COUNTER_WINDOW_MS).toISOString();
    const { data: counterRows } = await supabase
      .from("pos_orders")
      .select("id, order_number, status, order_type, table_number, queue_number, total, created_at")
      .eq("source", "pos")
      .eq("outlet_id", outletId)
      .is("served_at", null)
      .gte("created_at", counterSince)
      .order("created_at", { ascending: true });
    const counters = ((counterRows ?? []) as CounterRow[]).filter((o) => !COUNTER_DEAD.has(o.status));

    // Batch-fetch items for all sets (Grab + Counter both live in pos_order_items).
    const pickupIds = pickups.map((o) => o.id);
    const grabIds = grabs.map((o) => o.id);
    const counterIds = counters.map((o) => o.id);
    const posItemIds = [...grabIds, ...counterIds];
    const [pickupItems, posItems] = await Promise.all([
      pickupIds.length
        ? supabase.from("order_items").select("order_id, product_name, variant_name, quantity").in("order_id", pickupIds)
        : Promise.resolve({ data: [] as any[] }),
      posItemIds.length
        ? supabase.from("pos_order_items").select("order_id, product_name, variant_name, quantity").in("order_id", posItemIds)
        : Promise.resolve({ data: [] as any[] }),
    ]);
    const byOrder = (rows: any[]): Map<string, KdsItem[]> => {
      const m = new Map<string, KdsItem[]>();
      for (const r of rows ?? []) {
        const arr = m.get(r.order_id) ?? [];
        arr.push({ name: r.product_name, qty: r.quantity, variant: r.variant_name });
        m.set(r.order_id, arr);
      }
      return m;
    };
    const pItems = byOrder(pickupItems.data ?? []);
    const posItemsByOrder = byOrder(posItems.data ?? []);

    const merged: KdsOrder[] = [
      ...pickups.map((o) => ({
        uid: `pickup:${o.id}`,
        id: o.id,
        source: "pickup" as const,
        orderNumber: o.order_number,
        status: o.status,
        orderType: o.order_type ?? "pickup",
        total: o.total ?? 0,
        createdAt: o.created_at,
        items: pItems.get(o.id) ?? [],
      })),
      ...grabs.map((o) => ({
        uid: `grab:${o.id}`,
        id: o.id,
        source: "grab" as const,
        orderNumber: o.order_number,
        status: o.status,
        orderType: o.order_type ?? "takeaway",
        total: o.total ?? 0,
        createdAt: o.created_at,
        items: posItemsByOrder.get(o.id) ?? [],
      })),
      ...counters.map((o) => ({
        uid: `counter:${o.id}`,
        id: o.id,
        source: "counter" as const,
        orderNumber: o.order_number,
        status: o.status,
        orderType: o.order_type ?? "takeaway",
        total: o.total ?? 0,
        createdAt: o.created_at,
        items: posItemsByOrder.get(o.id) ?? [],
        tableNumber: o.table_number,
        queueNumber: o.queue_number,
      })),
    ].sort((a, b) => +new Date(a.createdAt) - +new Date(b.createdAt));

    setOrders(merged);
    setLoading(false);
  }, [storeId, outletId]);

  // 2. Initial load + Realtime (debounced reload on any change).
  useEffect(() => {
    if (!outletId) return;
    let cancelled = false;
    setLoading(true);
    void load();

    const scheduleReload = () => {
      if (reloadTimer.current) clearTimeout(reloadTimer.current);
      reloadTimer.current = setTimeout(() => { if (!cancelled) void load(); }, 250);
    };

    // pos_orders (Grab + Counter) is keyed by outletId; the `orders` table
    // (Pickup) only matters once a pickup store_id is mapped.
    const ch = supabase.channel(`orders-panel-${outletId}`);
    if (storeId) {
      ch.on("postgres_changes", { event: "*", schema: "public", table: "orders", filter: `store_id=eq.${storeId}` }, scheduleReload);
    }
    ch.on("postgres_changes", { event: "*", schema: "public", table: "pos_orders", filter: `outlet_id=eq.${outletId}` }, scheduleReload)
      .subscribe();

    // Safety-net refetch in case a Realtime event is dropped (flaky venue
    // Wi-Fi): an order completed elsewhere would otherwise linger in this
    // live list and keep the serving-time alarm sounding with no live orders.
    const poll = setInterval(() => { if (!cancelled) void load(); }, SAFETY_REFRESH_MS);

    return () => {
      cancelled = true;
      if (reloadTimer.current) clearTimeout(reloadTimer.current);
      clearInterval(poll);
      void supabase.removeChannel(ch);
    };
  }, [storeId, outletId, load]);

  return { orders, loading, reload: load };
}
