import { useEffect, useRef, useState } from "react";
import { supabase } from "./supabase";
import { playChime, primeChime } from "./chime";

/**
 * Plays an audible chime when a NEW external order arrives for this outlet —
 * so staff away from the till still notice. Covers all three customer-initiated
 * channels:
 *
 *   - `orders`     (store_id)  → pickup-app + dine-in table-QR orders
 *   - `pos_orders` (outlet_id) → GrabFood only (source='grabfood')
 *
 * The cashier's OWN till sales (pos_orders with a non-grab source) are NOT
 * chimed — only orders that arrive without anyone ringing them up.
 *
 * Deliberately decoupled from the auto-printers (use-pickup-printer /
 * use-grab-printer):
 *   - it reacts ONLY to live Realtime events, so the print catch-up on app
 *     launch never triggers a burst of chimes for old orders, and
 *   - a chime can never disturb the critical print path.
 *
 * Dedup is by order id → exactly one chime per order, the first time it becomes
 * actionable (mirrors the status sets the Live Orders panel uses).
 */

// An order is "live / needs attention" — same buckets the orders-panel shows.
// Grab orders arrive already accepted, so 'paid' isn't part of their set.
const PICKUP_ACTIONABLE = new Set(["paid", "sent_to_kitchen", "preparing", "ready"]);
const GRAB_ACTIONABLE = new Set(["sent_to_kitchen", "preparing", "ready"]);

type ChangeRow = { id?: string; status?: string; source?: string } | undefined;

export function useOrderChime(outletId: string | null | undefined) {
  // Order ids already chimed this session → never chime the same order twice
  // (an order INSERTs pending then UPDATEs to paid; only the first actionable
  // event rings).
  const chimedRef = useRef<Set<string>>(new Set());
  const [storeId, setStoreId] = useState<string | null>(null);

  // POS outlet → pickup store_id (same mapping the printers / orders-panel use).
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

  useEffect(() => {
    if (!outletId) return;
    primeChime();

    const ring = (row: ChangeRow, actionable: Set<string>) => {
      const id = row?.id;
      const status = row?.status;
      if (!id || !status || !actionable.has(status)) return;
      if (chimedRef.current.has(id)) return;
      chimedRef.current.add(id);
      playChime();
    };

    const ch = supabase.channel(`order-chime-${outletId}`);

    // GrabFood → pos_orders (by outlet_id). Skip the till's own sales.
    ch.on(
      "postgres_changes",
      { event: "*", schema: "public", table: "pos_orders", filter: `outlet_id=eq.${outletId}` },
      (payload) => {
        const row = payload.new as ChangeRow;
        if (!row || row.source !== "grabfood") return;
        ring(row, GRAB_ACTIONABLE);
      },
    );

    // Pickup app + dine-in table QR → orders (by store_id, once resolved).
    if (storeId) {
      ch.on(
        "postgres_changes",
        { event: "*", schema: "public", table: "orders", filter: `store_id=eq.${storeId}` },
        (payload) => ring(payload.new as ChangeRow, PICKUP_ACTIONABLE),
      );
    }

    ch.subscribe();
    return () => { void supabase.removeChannel(ch); };
  }, [outletId, storeId]);
}
