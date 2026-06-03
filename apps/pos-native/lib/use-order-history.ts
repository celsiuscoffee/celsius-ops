import { useCallback, useEffect, useState } from "react";
import { supabase } from "./supabase";

/**
 * Today's order history across ALL channels for the Orders panel's History
 * tab — so the counter can double-check the day's sales (any channel) at a
 * glance and reopen a receipt.
 *
 * Three sources, unified + channel-tagged:
 *   - Counter → pos_orders (source != 'grabfood', outlet_id)   [register sales]
 *   - Grab    → pos_orders (source = 'grabfood',  outlet_id)
 *   - Pickup  → orders     (store_id, order_type != dine_in)
 *
 * "Today" = since local (MYT, UTC+8 — no DST) midnight. Read-only review feed;
 * line items are fetched alongside so a tap can expand the receipt. anon
 * SELECT only — no writes here.
 */

export type HistoryChannel = "counter" | "grab" | "pickup";
export type HistoryItem = { name: string; qty: number; variant?: string | null };
export type HistoryOrder = {
  uid: string; // `${channel}:${id}` — stable React key
  id: string;
  channel: HistoryChannel;
  orderNumber: string;
  status: string;
  total: number; // sen
  createdAt: string;
  items: HistoryItem[];
};

/** UTC instant of today's 00:00 in MYT (UTC+8, no DST). */
function mytMidnightIso(): string {
  const now = new Date();
  const myt = new Date(now.getTime() + 8 * 3600 * 1000);
  const midnight = Date.UTC(myt.getUTCFullYear(), myt.getUTCMonth(), myt.getUTCDate()) - 8 * 3600 * 1000;
  return new Date(midnight).toISOString();
}

type OrderRow = { id: string; order_number: string | null; status: string; total: number | null; created_at: string };

export function useOrderHistory(outletId: string | null | undefined) {
  const [storeId, setStoreId] = useState<string | null>(null);
  const [orders, setOrders] = useState<HistoryOrder[]>([]);
  const [loading, setLoading] = useState(true);

  // outlet → pickup store_id (same mapping the KDS / tables panels use).
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
    if (!outletId) return;
    const since = mytMidnightIso();
    const [{ data: posRows }, pickupRes] = await Promise.all([
      // Counter + Grab both live in pos_orders; split by source below.
      supabase
        .from("pos_orders")
        .select("id, order_number, status, total, created_at, source")
        .eq("outlet_id", outletId)
        .gte("created_at", since)
        .order("created_at", { ascending: false }),
      storeId
        ? supabase
            .from("orders")
            .select("id, order_number, status, total, created_at")
            .eq("store_id", storeId)
            .neq("order_type", "dine_in")
            .gte("created_at", since)
            .order("created_at", { ascending: false })
        : Promise.resolve({ data: [] as OrderRow[] }),
    ]);
    const pos = (posRows ?? []) as (OrderRow & { source: string | null })[];
    const counter = pos.filter((o) => o.source !== "grabfood");
    const grab = pos.filter((o) => o.source === "grabfood");
    const pickup = ((pickupRes as { data?: OrderRow[] | null }).data ?? []) as OrderRow[];

    // Items: pos_order_items for counter + grab; order_items for pickup.
    const posIds = pos.map((o) => o.id);
    const pickupIds = pickup.map((o) => o.id);
    const [posItems, pickupItems] = await Promise.all([
      posIds.length
        ? supabase.from("pos_order_items").select("order_id, product_name, variant_name, quantity").in("order_id", posIds)
        : Promise.resolve({ data: [] as any[] }),
      pickupIds.length
        ? supabase.from("order_items").select("order_id, product_name, variant_name, quantity").in("order_id", pickupIds)
        : Promise.resolve({ data: [] as any[] }),
    ]);
    const byOrder = (rows: any[]): Map<string, HistoryItem[]> => {
      const m = new Map<string, HistoryItem[]>();
      for (const r of rows ?? []) {
        const arr = m.get(r.order_id) ?? [];
        arr.push({ name: r.product_name, qty: r.quantity, variant: r.variant_name });
        m.set(r.order_id, arr);
      }
      return m;
    };
    const pItems = byOrder(posItems.data ?? []);
    const oItems = byOrder(pickupItems.data ?? []);

    const mk = (o: OrderRow, channel: HistoryChannel, items: Map<string, HistoryItem[]>): HistoryOrder => ({
      uid: `${channel}:${o.id}`,
      id: o.id,
      channel,
      orderNumber: o.order_number ?? o.id.slice(0, 6),
      status: o.status,
      total: o.total ?? 0,
      createdAt: o.created_at,
      items: items.get(o.id) ?? [],
    });
    const merged: HistoryOrder[] = [
      ...counter.map((o) => mk(o, "counter", pItems)),
      ...grab.map((o) => mk(o, "grab", pItems)),
      ...pickup.map((o) => mk(o, "pickup", oItems)),
    ].sort((a, b) => +new Date(b.createdAt) - +new Date(a.createdAt));

    setOrders(merged);
    setLoading(false);
  }, [outletId, storeId]);

  useEffect(() => {
    setLoading(true);
    void load();
  }, [load]);

  return { orders, loading, reload: load };
}
