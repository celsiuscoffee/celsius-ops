import { useCallback, useEffect, useRef, useState } from "react";
import { supabase } from "./supabase";

/**
 * Live Grab + Pickup order feed for the POS-native register's
 * order-management panel (an on-register KDS). Lets the cashier see
 * incoming delivery / pickup orders and bump them preparing → ready →
 * collected, just like the kitchen display.
 *
 * Two sources, unified:
 *   - Pickup app orders  → `orders`     (store_id, order_type pickup/takeaway)
 *   - GrabFood orders    → `pos_orders` (source='grabfood', outlet_id)
 *
 * Dine-in QR orders live in `orders` too but are owned by the Tables
 * panel, so we filter them out here (order_type != dine_in).
 *
 * Reads are anon SELECT + Realtime. Status writes do NOT go through the
 * anon client — the `orders` RLS only allows anon UPDATE on unprinted
 * rows, and these are already printed. The register posts to the
 * service-role route /api/pos/order-status instead (see advanceStatus in
 * register.tsx). On success the Realtime UPDATE flows back here and the
 * card re-buckets automatically.
 */

// Statuses that are "in the kitchen / awaiting handover" — what the
// cashier still needs to act on. completed / cancelled / failed drop off.
const PICKUP_LIVE = ["paid", "sent_to_kitchen", "preparing", "ready"];
const GRAB_LIVE = ["sent_to_kitchen", "preparing", "ready"];
const SAFETY_REFRESH_MS = 60 * 1000; // backstop refetch if a Realtime event is dropped

export type KdsSource = "pickup" | "grab";

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
    if (!storeId || !outletId) return;
    // ── Pickup orders + their items ──
    const { data: pickupRows } = await supabase
      .from("orders")
      .select("id, order_number, status, order_type, total, created_at")
      .eq("store_id", storeId)
      .neq("order_type", "dine_in")
      .in("status", PICKUP_LIVE)
      .order("created_at", { ascending: true });
    const pickups = (pickupRows ?? []) as PickupRow[];

    // ── Grab orders + their items ──
    const { data: grabRows } = await supabase
      .from("pos_orders")
      .select("id, order_number, status, order_type, total, created_at")
      .eq("source", "grabfood")
      .eq("outlet_id", outletId)
      .in("status", GRAB_LIVE)
      .order("created_at", { ascending: true });
    const grabs = (grabRows ?? []) as GrabRow[];

    // Batch-fetch items for both sets.
    const pickupIds = pickups.map((o) => o.id);
    const grabIds = grabs.map((o) => o.id);
    const [pickupItems, grabItems] = await Promise.all([
      pickupIds.length
        ? supabase.from("order_items").select("order_id, product_name, variant_name, quantity").in("order_id", pickupIds)
        : Promise.resolve({ data: [] as any[] }),
      grabIds.length
        ? supabase.from("pos_order_items").select("order_id, product_name, variant_name, quantity").in("order_id", grabIds)
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
    const gItems = byOrder(grabItems.data ?? []);

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
        items: gItems.get(o.id) ?? [],
      })),
    ].sort((a, b) => +new Date(a.createdAt) - +new Date(b.createdAt));

    setOrders(merged);
    setLoading(false);
  }, [storeId, outletId]);

  // 2. Initial load + Realtime (debounced reload on any change).
  useEffect(() => {
    if (!storeId || !outletId) return;
    let cancelled = false;
    setLoading(true);
    void load();

    const scheduleReload = () => {
      if (reloadTimer.current) clearTimeout(reloadTimer.current);
      reloadTimer.current = setTimeout(() => { if (!cancelled) void load(); }, 250);
    };

    const ch = supabase
      .channel(`orders-panel-${outletId}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "orders", filter: `store_id=eq.${storeId}` }, scheduleReload)
      .on("postgres_changes", { event: "*", schema: "public", table: "pos_orders", filter: `outlet_id=eq.${outletId}` }, scheduleReload)
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
