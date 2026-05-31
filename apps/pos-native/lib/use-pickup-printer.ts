import { useEffect, useRef } from "react";
import { supabase } from "./supabase";
import { printKitchenDocket80mm } from "./printer";

/**
 * Pickup-order kitchen-docket auto-printer (native port of
 * apps/pos/src/lib/use-pickup-printer.ts).
 *
 * Mounts on the register. When a pickup or QR-dine-in order lands for
 * this outlet (created via apps/pickup-native → POST /api/orders) and
 * the kitchen docket hasn't been printed yet, this hook normalizes the
 * row into the same shape printKitchenDocket80mm expects and fires it
 * onto the native SUNMI printer module.
 *
 * Outlet-slug resolution:
 *   The customer app writes a pickup slug ("conezion") on the orders
 *   row, while the POS uses an internal id ("outlet-con"). They're
 *   linked via outlet_settings.loyalty_outlet_id → store_id. Without
 *   this resolver every web order failed the store_id check and the
 *   docket never printed (root cause of PR #218 on the web POS).
 *
 * Duplicate-print guard:
 *   orders.kitchen_docket_printed_at is updated atomically AFTER the
 *   print succeeds (WHERE id = ? AND kitchen_docket_printed_at IS NULL).
 *   If another terminal beat us, the UPDATE returns zero rows and the
 *   second print is skipped. A 5s in-flight Set prevents the same row
 *   from double-firing within a single terminal when Realtime delivers
 *   INSERT + UPDATE back-to-back.
 *
 * Discovery:
 *   1. Catch-up pass on mount: anything paid + unprinted in the last
 *      6 hours gets printed once (covers POS offline / network blip).
 *   2. Realtime INSERT (new orders) + UPDATE (gateway-confirm flips
 *      pending → preparing). Skips UPDATEs that set printed_at to
 *      avoid an infinite loop with our own claim write.
 *
 * Station mapping comes from the local products catalog because the
 * customer-app order_items table doesn't carry kitchen_station per-line.
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

/** Statuses that mean "this order is real and the kitchen should start
 *  making it." Anything else (pending payment, cancelled, refunded) is
 *  excluded — we don't print a docket for an unpaid order. */
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
  // Refs so the Realtime callback always sees the latest values without
  // retriggering the subscribe-effect every time the products query
  // refreshes.
  const outletRef = useRef(outletId);
  const productsRef = useRef(productsById);
  // Pickup-app slug ("conezion") that maps to this POS outletId
  // ("outlet-con") — resolved once at mount via outlet_settings.
  const storeIdRef = useRef<string | null>(null);
  useEffect(() => { outletRef.current = outletId; }, [outletId]);
  useEffect(() => { productsRef.current = productsById; }, [productsById]);

  // Intra-terminal guard against double-fires (5s window). The DB
  // column gives us cross-terminal safety; this Set covers the case
  // where Realtime delivers INSERT then UPDATE on status change within
  // a few hundred ms.
  const inFlightRef = useRef<Set<string>>(new Set());

  useEffect(() => {
    if (!outletId) return;

    const tryPrintOrder = async (orderId: string) => {
      if (inFlightRef.current.has(orderId)) return;
      inFlightRef.current.add(orderId);
      try {
        // Re-read so we have the latest status + don't fire if another
        // terminal already claimed the docket in the small Realtime →
        // print window.
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

        const products = productsRef.current;
        const pos_order_items = rows.map((r) => ({
          product_name: r.product_name,
          variant_name: r.variant_name,
          quantity: r.quantity,
          kitchen_station: products.get(r.product_id)?.kitchen_station ?? null,
          modifiers: r.modifiers,
          notes: null,
        }));

        // For QR-dine-in we surface "DINE-IN" + the table number so the
        // docket reads "TABLE N" instead of a counter queue label
        // (parity with PR #216). For pickup/takeaway we keep
        // order_number as the queue label.
        const isDineIn = row.order_type === "dine_in";
        const orderForPrint = {
          order_number: row.order_number,
          order_type: isDineIn ? "dine_in" : "takeaway",
          table_number: isDineIn ? row.table_number ?? null : null,
          queue_number: row.order_number,
          created_at: row.created_at,
          pos_order_items,
        };

        await printKitchenDocket80mm(
          orderForPrint,
          isDineIn ? "Celsius Coffee Dine-in" : "Celsius Coffee Pickup",
        );

        // Atomic claim: only mark printed if still NULL. If another
        // terminal beat us, the UPDATE matches zero rows and we
        // silently no-op rather than reprinting.
        await supabase
          .from("orders")
          .update({ kitchen_docket_printed_at: new Date().toISOString() })
          .eq("id", orderId)
          .is("kitchen_docket_printed_at", null);
      } catch (e) {
        console.error("[pickup-printer]", e);
      } finally {
        // Free the local guard after 5s — a manual reprint feature
        // (future) can re-trigger without an app reload.
        setTimeout(() => inFlightRef.current.delete(orderId), 5000);
      }
    };

    let channel: ReturnType<typeof supabase.channel> | null = null;
    let cancelled = false;

    (async () => {
      // 0. Map POS outletId → pickup store_id via outlet_settings (the
      //    fix from PR #218 — without this every web order silently
      //    failed the store_id filter and never printed).
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

      // 1. Catch-up pass — anything paid + unprinted in the last 6h.
      //    Limit prevents dumping a backfill onto the SUNMI head if RLS
      //    was just flipped or the flag was reset.
      const { data } = await supabase
        .from("orders")
        .select("id, status")
        .eq("store_id", storeId)
        .is("kitchen_docket_printed_at", null)
        .in("status", Array.from(PRINTABLE_STATUSES))
        .gte("created_at", new Date(Date.now() - 6 * 60 * 60 * 1000).toISOString())
        .order("created_at", { ascending: true })
        .limit(20);
      if (cancelled) return;
      for (const r of (data ?? []) as { id: string }[]) {
        if (cancelled) break;
        // Sequential — back-to-back prints can starve the SUNMI bridge
        // if fired in parallel.
        // eslint-disable-next-line no-await-in-loop
        await tryPrintOrder(r.id);
      }
      if (cancelled) return;

      // 2. Live: INSERT covers new orders; UPDATE covers webhook-flipped
      //    status (pending → preparing on gateway confirm, or
      //    pending → preparing on Maybank-QR staff release).
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
            // Skip our own claim write (sets printed_at) to avoid an
            // infinite re-print loop.
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
