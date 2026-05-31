"use client";

import { useEffect, useRef } from "react";
import { createClient } from "./supabase-browser";
import { printKitchenDocket80mm } from "./sunmi-printer";

/**
 * Pickup-order kitchen-docket auto-printer.
 *
 * Mounts on the POS register at each outlet. When a pickup order
 * lands for that outlet (created via apps/pickup-native → POST
 * /api/orders) and the kitchen docket hasn't been printed yet,
 * this hook normalizes the pickup row into the same shape the
 * in-store `printKitchenDocket80mm` expects and fires it onto the
 * station-routed printers (Bar / Kitchen / Pastry).
 *
 * Duplicate-print guard:
 *   `orders.kitchen_docket_printed_at` is updated atomically AFTER
 *   the print succeeds, using `WHERE store_id = ? AND id = ? AND
 *   kitchen_docket_printed_at IS NULL`. If a second POS terminal
 *   in the same outlet races us, the UPDATE returns zero rows on
 *   that terminal and the second print is skipped.
 *
 * Discovery:
 *   1. On mount: poll once for any already-paid pickup orders
 *      whose docket hasn't been printed (covers the case where
 *      the POS was offline while the customer placed the order).
 *   2. Realtime subscription on `orders` INSERT and UPDATE — new
 *      orders fire on INSERT (status=pending → likely no docket
 *      yet); paid-without-docket orders fire on UPDATE when the
 *      payment webhook flips status to "paid" / "sent_to_kitchen".
 *
 * Station mapping comes from `products.kitchen_station`. The
 * pickup `order_items` table doesn't carry station per-line, so
 * we join through the local products catalog (already loaded in
 * POSContext) to attach it before printing.
 */

type ProductLite = {
  id: string;
  kitchen_station?: string | null;
};

type PickupOrderRow = {
  id: string;
  order_number: string;
  store_id: string;
  status: string;
  order_type: string | null;
  table_number: string | null;
  pickup_at: string | null;
  notes: string | null;
  customer_name: string | null;
  customer_phone: string | null;
  created_at: string;
  kitchen_docket_printed_at: string | null;
};

type PickupOrderItemRow = {
  product_id: string;
  product_name: string;
  variant_name: string | null;
  quantity: number;
  modifiers: unknown;
};

/** Status values that mean "this order is real and the kitchen
 *  should start making it." Anything else (pending payment,
 *  cancelled, refunded) is excluded — we don't want to print
 *  a docket for an unpaid order. */
const PRINTABLE_STATUSES = new Set([
  "paid",
  "sent_to_kitchen",
  "preparing",
  "ready",
]);

export function usePickupPrinter(
  outletId: string | null | undefined,
  productsById: Map<string, ProductLite>,
) {
  // Refs so the Realtime callback always sees the latest values
  // without retriggering the subscribe-effect every time products
  // refresh.
  const outletRef = useRef(outletId);
  const productsRef = useRef(productsById);
  // Web slug that maps to this POS outletId, resolved at mount via
  // outlet_settings.loyalty_outlet_id. The customer PWA writes a
  // different identifier on the orders row (e.g. "conezion") than
  // the POS uses internally (e.g. "outlet-con"); without this
  // resolver every web order failed the store_id check and silently
  // never printed.
  const storeIdRef = useRef<string | null>(null);
  useEffect(() => { outletRef.current = outletId; }, [outletId]);
  useEffect(() => { productsRef.current = productsById; }, [productsById]);

  // Local in-flight guard. Realtime can deliver the same row twice
  // (INSERT then UPDATE on status change) within a few hundred ms.
  // The DB column gives us cross-terminal safety; this Set gives us
  // intra-terminal safety so we don't fire two prints back-to-back.
  const inFlightRef = useRef<Set<string>>(new Set());

  useEffect(() => {
    if (!outletId) return;
    const supabase = createClient();

    const tryPrintOrder = async (orderId: string) => {
      if (inFlightRef.current.has(orderId)) return;
      inFlightRef.current.add(orderId);
      try {
        // Re-read the row to make sure status is still printable +
        // the docket hasn't been printed by another terminal in
        // the small window between Realtime notification and now.
        const { data: order } = await supabase
          .from("orders")
          .select(
            "id, order_number, store_id, status, order_type, table_number, pickup_at, notes, customer_name, customer_phone, created_at, kitchen_docket_printed_at",
          )
          .eq("id", orderId)
          .maybeSingle();
        const row = order as PickupOrderRow | null;
        if (!row) return;
        if (!storeIdRef.current || row.store_id !== storeIdRef.current) return;
        if (row.kitchen_docket_printed_at) return;
        if (!PRINTABLE_STATUSES.has(row.status)) return;

        const { data: items } = await supabase
          .from("order_items")
          .select("product_id, product_name, variant_name, quantity, modifiers")
          .eq("order_id", orderId);
        const rows = (items ?? []) as PickupOrderItemRow[];
        if (rows.length === 0) return;

        // Normalize to the shape printKitchenDocket80mm expects.
        // Per-item kitchen_station is looked up from the local
        // products catalog — pickup orders don't store it on the
        // line item, so the routing key has to come from the
        // product master.
        const products = productsRef.current;
        const pos_order_items = rows.map((r) => ({
          product_name: r.product_name,
          variant_name: r.variant_name,
          quantity: r.quantity,
          kitchen_station: products.get(r.product_id)?.kitchen_station ?? null,
          modifiers: r.modifiers,
          notes: null,
        }));

        // Build the "order" shape. For pickup/takeaway we surface
        // order_number as the queue label; for QR dine-in we pass
        // order_type "dine_in" + the table number so the docket
        // shows "TABLE N" instead of a counter queue label.
        const isDineIn = row.order_type === "dine_in";
        const orderForPrint = {
          order_number: row.order_number,
          order_type: isDineIn ? "dine_in" : "takeaway",
          table_number: isDineIn ? row.table_number ?? null : null,
          queue_number: row.order_number,
          created_at: row.created_at,
          pos_order_items,
        };

        await printKitchenDocket80mm(orderForPrint, isDineIn ? "Celsius Coffee Dine-in" : "Celsius Coffee Pickup");

        // Atomic claim: only mark printed if it's still NULL. If
        // the UPDATE returns no rows, another terminal beat us —
        // their print already fired and the row was claimed. We
        // silently no-op rather than reprinting.
        await supabase
          .from("orders")
          .update({ kitchen_docket_printed_at: new Date().toISOString() })
          .eq("id", orderId)
          .is("kitchen_docket_printed_at", null);
      } catch (e) {
        console.error("[pickup-printer]", e);
      } finally {
        // Free the local guard after 5s so a manual reprint
        // (future feature) can re-trigger if needed without a
        // page reload.
        setTimeout(() => inFlightRef.current.delete(orderId), 5000);
      }
    };

    // The customer PWA (apps/order) writes a different outlet identifier
    // on the orders row (e.g. "conezion") than the POS uses internally
    // (e.g. "outlet-con"). They're linked via outlet_settings.loyalty_outlet_id.
    // Resolve the web slug once here so the catch-up query, the per-row
    // guard, and the Realtime filter all compare against the right
    // identifier. Until this resolver was added every web order failed
    // the store_id check and silently never printed.
    let channel: ReturnType<typeof supabase.channel> | null = null;
    let cancelled = false;

    (async () => {
      const { data: settings } = await supabase
        .from("outlet_settings")
        .select("store_id")
        .eq("loyalty_outlet_id", outletId)
        .maybeSingle();
      const storeId = (settings as { store_id?: string } | null)?.store_id;
      if (cancelled) return;
      if (!storeId) {
        console.warn(
          "[pickup-printer] no outlet_settings.store_id maps to loyalty_outlet_id",
          outletId,
        );
        return;
      }
      storeIdRef.current = storeId;

      // ── 1. Catch-up pass ──────────────────────────────────────
      // Anything paid + unprinted right now (POS was just opened,
      // network blip, etc.) gets printed once on mount.
      const { data } = await supabase
        .from("orders")
        .select("id, status")
        .eq("store_id", storeId)
        .is("kitchen_docket_printed_at", null)
        .in("status", Array.from(PRINTABLE_STATUSES))
        // Last 6 hours only — we don't want to dump a day's worth
        // of historical orders onto the printer if the column was
        // backfilled or RLS was just flipped. Pickup orders are
        // for same-day collection; anything older is stale.
        .gte("created_at", new Date(Date.now() - 6 * 60 * 60 * 1000).toISOString())
        .order("created_at", { ascending: true })
        .limit(20);
      if (cancelled) return;
      for (const r of (data ?? []) as { id: string }[]) {
        if (cancelled) break;
        // Sequential — back-to-back prints can starve the SUNMI
        // bridge if fired in parallel.
        // eslint-disable-next-line no-await-in-loop
        await tryPrintOrder(r.id);
      }
      if (cancelled) return;

      // ── 2. Live subscription ──────────────────────────────────
      channel = supabase
        .channel(`pickup-printer-${outletId}`)
        .on(
          "postgres_changes",
          {
            event: "INSERT",
            schema: "public",
            table: "orders",
            filter: `store_id=eq.${storeId}`,
          },
          (payload) => {
            const id = (payload.new as PickupOrderRow | null)?.id;
            if (id) void tryPrintOrder(id);
          },
        )
        .on(
          "postgres_changes",
          {
            event: "UPDATE",
            schema: "public",
            table: "orders",
            filter: `store_id=eq.${storeId}`,
          },
          (payload) => {
            const next = payload.new as PickupOrderRow | null;
            const prev = payload.old as PickupOrderRow | null;
            if (!next?.id) return;
            // Only react when a status transition pushed the row
            // into a printable state — paying for an existing
            // pending order, or moving from "preparing" back into
            // queue. Skip the UPDATE that sets printed_at (avoids
            // an infinite loop with our own claim write).
            if (next.kitchen_docket_printed_at) return;
            const becamePrintable =
              PRINTABLE_STATUSES.has(next.status) &&
              (!prev || !PRINTABLE_STATUSES.has(prev.status));
            if (becamePrintable) void tryPrintOrder(next.id);
          },
        )
        .subscribe();
    })();

    return () => {
      cancelled = true;
      if (channel) void supabase.removeChannel(channel);
    };
  }, [outletId]);
}
