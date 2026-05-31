import { useEffect, useState } from "react";
import { supabase } from "./supabase";

/**
 * Live dine-in table state for the POS-native Tables panel.
 *
 * Subscribes to `orders` for the outlet (via outlet_settings → store_id)
 * and groups any active dine-in orders by table_number. Each grouping
 * returns the current order id, status, total, item count, and the time
 * it was placed — enough to colour a tile and let staff drill in.
 *
 * Buckets:
 *   - pending  → status='pending' (Maybank QR awaiting payment, etc.)
 *   - active   → status='paid' / 'sent_to_kitchen' / 'preparing'
 *   - ready    → status='ready' (out at the counter / on the way)
 *   - free     → table has no active dine-in order
 *
 * `completed`, `cancelled`, `failed`, `refunded` are ignored so a
 * cleared table goes back to free immediately.
 */

const ACTIVE_STATUSES = new Set(["paid", "sent_to_kitchen", "preparing"]);
const PENDING_STATUSES = new Set(["pending"]);
const READY_STATUSES = new Set(["ready"]);
const LIVE_STATUSES = new Set<string>([
  ...ACTIVE_STATUSES,
  ...PENDING_STATUSES,
  ...READY_STATUSES,
]);

export type TableState = "free" | "pending" | "active" | "ready";

export type TableSlot = {
  label: string;            // "T1", "T2", ...
  state: TableState;
  orderId: string | null;
  orderNumber: string | null;
  total: number;            // sen
  itemCount: number;        // best-effort; 0 until items load
  createdAt: string | null;
};

type LiveOrderRow = {
  id: string;
  order_number: string;
  store_id: string;
  status: string;
  order_type: string | null;
  table_number: string | null;
  total: number | null;
  created_at: string;
};

function bucketFor(status: string): TableState {
  if (PENDING_STATUSES.has(status)) return "pending";
  if (READY_STATUSES.has(status)) return "ready";
  if (ACTIVE_STATUSES.has(status)) return "active";
  return "free";
}

/** Live table grid driven by the orders feed. Pass the cashier's POS
 *  outletId (e.g. "outlet-sa") + how many tables the outlet has
 *  (from settings.table_count). */
export function useTablesPanel(outletId: string | null | undefined, count: number) {
  const [storeId, setStoreId] = useState<string | null>(null);
  // Map<table_number, LiveOrderRow> — only one active order per table
  // at a time (the most recent live one).
  const [activeByTable, setActiveByTable] = useState<Map<string, LiveOrderRow>>(new Map());

  // 1. Resolve POS outlet → pickup store_id (same mapping the pickup
  //    printer hook uses).
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
      const sid = (data as { store_id?: string } | null)?.store_id ?? null;
      if (!cancelled) setStoreId(sid);
    })();
    return () => { cancelled = true; };
  }, [outletId]);

  // 2. Initial catch-up + Realtime subscribe for this store_id.
  useEffect(() => {
    if (!storeId) return;
    let cancelled = false;
    let channel: ReturnType<typeof supabase.channel> | null = null;

    function upsertRow(row: LiveOrderRow | null) {
      if (!row) return;
      if (row.order_type !== "dine_in") return;
      if (!row.table_number) return;
      setActiveByTable((prev) => {
        const next = new Map(prev);
        if (LIVE_STATUSES.has(row.status)) {
          next.set(row.table_number!, row);
        } else {
          // Status flipped to completed/cancelled — clear the table.
          const cur = next.get(row.table_number!);
          if (cur?.id === row.id) next.delete(row.table_number!);
        }
        return next;
      });
    }

    (async () => {
      // Catch-up: any live dine-in order for this store in the last 24h.
      const { data } = await supabase
        .from("orders")
        .select("id, order_number, store_id, status, order_type, table_number, total, created_at")
        .eq("store_id", storeId)
        .eq("order_type", "dine_in")
        .in("status", Array.from(LIVE_STATUSES))
        .gte("created_at", new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString())
        .order("created_at", { ascending: false });
      if (cancelled) return;
      const seen = new Map<string, LiveOrderRow>();
      for (const r of (data ?? []) as LiveOrderRow[]) {
        if (!r.table_number) continue;
        if (!seen.has(r.table_number)) seen.set(r.table_number, r);
      }
      setActiveByTable(seen);

      // Live: INSERT (new dine-in) + UPDATE (status flips).
      channel = supabase
        .channel(`tables-panel-${storeId}`)
        .on("postgres_changes", {
          event: "INSERT",
          schema: "public",
          table: "orders",
          filter: `store_id=eq.${storeId}`,
        }, (payload) => upsertRow(payload.new as LiveOrderRow))
        .on("postgres_changes", {
          event: "UPDATE",
          schema: "public",
          table: "orders",
          filter: `store_id=eq.${storeId}`,
        }, (payload) => upsertRow(payload.new as LiveOrderRow))
        .subscribe();
    })();

    return () => {
      cancelled = true;
      if (channel) void supabase.removeChannel(channel);
    };
  }, [storeId]);

  // 3. Compose the slot list T1..Tn with active order overlay.
  const slots: TableSlot[] = [];
  for (let i = 1; i <= count; i++) {
    const label = `T${i}`;
    // Tables QR generator uses "T1", "T2"... but customer-facing URL is
    // /table/{outlet}/{tableId} where tableId is also "T1". Some legacy
    // pickup-web orders may save table_number as just the number "1".
    // Match either form so we don't show as free when an order exists.
    const order = activeByTable.get(label) ?? activeByTable.get(String(i));
    slots.push({
      label,
      state: order ? bucketFor(order.status) : "free",
      orderId: order?.id ?? null,
      orderNumber: order?.order_number ?? null,
      total: order?.total ?? 0,
      itemCount: 0,
      createdAt: order?.created_at ?? null,
    });
  }
  return slots;
}
