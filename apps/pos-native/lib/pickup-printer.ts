import { useEffect, useRef } from "react";
import { supabase } from "./supabase";
import { usePos } from "./store";
import { printKitchenDocket80mm } from "./printer";

/**
 * Pickup-order kitchen-docket auto-printer for the native register.
 *
 * Mirrors the previous apps/pos hook (which never reached this device,
 * because production POS is this Expo app — apps/pos-native — not the
 * Capacitor sibling). When a pickup or QR-table dine-in order lands for
 * this outlet via the customer PWA (apps/order → POST /api/orders) and
 * the kitchen docket hasn't been printed yet, normalize the row into
 * the shape `printKitchenDocket80mm` expects and fire it onto the
 * SUNMI printer.
 *
 * Duplicate-print guard: `orders.kitchen_docket_printed_at` is updated
 * atomically AFTER the print succeeds (WHERE id = ? AND
 * kitchen_docket_printed_at IS NULL). If a second terminal in the same
 * outlet races us, the UPDATE returns zero rows on that terminal and
 * the second print is skipped. A local in-flight Set guards us against
 * an INSERT + UPDATE pair on the same id within milliseconds.
 *
 * Outlet identifier:
 *   The customer PWA writes a store slug ("conezion") on the orders
 *   row while this register uses a different outletId ("outlet-con");
 *   they're linked via outlet_settings.loyalty_outlet_id. The slug is
 *   resolved once at mount so the catch-up query, the per-row guard,
 *   and the Realtime filter all compare against the right identifier.
 *
 * Discovery:
 *   1. On mount: poll once for any already-paid orders whose docket
 *      hasn't been printed in the last 6h (covers the case where the
 *      POS was offline while the customer placed the order).
 *   2. Realtime subscription on `orders` INSERT and UPDATE — new
 *      orders fire on INSERT; paid-without-docket orders fire on
 *      UPDATE when the payment webhook flips status to
 *      paid / sent_to_kitchen.
 *
 * Per-line kitchen_station for routing comes from the `products`
 * catalog — the web `order_items` table doesn't carry station per-line.
 */

/** Statuses where the kitchen should start making the order. */
const PRINTABLE_STATUSES = new Set([
  "paid",
  "sent_to_kitchen",
  "preparing",
  "ready",
]);

type Row = {
  id: string;
  order_number: string;
  store_id: string;
  status: string;
  order_type: string | null;
  table_number: string | null;
  notes: string | null;
  customer_name: string | null;
  created_at: string;
  kitchen_docket_printed_at: string | null;
};

type ItemRow = {
  product_id: string;
  product_name: string;
  variant_name: string | null;
  quantity: number;
  modifiers: unknown;
};

export function usePickupPrinter(): void {
  const outletId = usePos((s) => s.outletId);
  const storeIdRef = useRef<string | null>(null);
  const inFlightRef = useRef<Set<string>>(new Set());

  useEffect(() => {
    if (!outletId) return;
    let cancelled = false;
    let channel: ReturnType<typeof supabase.channel> | null = null;

    const tryPrint = async (orderId: string) => {
      if (inFlightRef.current.has(orderId)) return;
      inFlightRef.current.add(orderId);
      try {
        const { data: order } = await supabase
          .from("orders")
          .select(
            "id, order_number, store_id, status, order_type, table_number, notes, customer_name, created_at, kitchen_docket_printed_at",
          )
          .eq("id", orderId)
          .maybeSingle();
        const row = order as Row | null;
        if (!row) return;
        if (!storeIdRef.current || row.store_id !== storeIdRef.current) return;
        if (row.kitchen_docket_printed_at) return;
        if (!PRINTABLE_STATUSES.has(row.status)) return;

        const { data: items } = await supabase
          .from("order_items")
          .select("product_id, product_name, variant_name, quantity, modifiers")
          .eq("order_id", orderId);
        const itemRows = (items ?? []) as ItemRow[];
        if (itemRows.length === 0) return;

        // Pull kitchen_station per item from the products catalog —
        // the web `order_items` table doesn't carry it per-line, so
        // routing keys come from the product master.
        const productIds = Array.from(
          new Set(itemRows.map((i) => i.product_id).filter(Boolean)),
        );
        const stationByProduct = new Map<string, string | null>();
        if (productIds.length > 0) {
          const { data: prods } = await supabase
            .from("products")
            .select("id, kitchen_station")
            .in("id", productIds);
          for (const p of (prods ?? []) as Array<{
            id: string;
            kitchen_station: string | null;
          }>) {
            stationByProduct.set(p.id, p.kitchen_station);
          }
        }

        const isDineIn = row.order_type === "dine_in";
        const printOrder = {
          order_number: row.order_number,
          order_type: isDineIn ? "dine_in" : "takeaway",
          table_number: isDineIn ? row.table_number ?? null : null,
          queue_number: row.order_number,
          created_at: row.created_at,
          pos_order_items: itemRows.map((it) => ({
            product_name: it.product_name,
            variant_name: it.variant_name,
            quantity: it.quantity,
            unit_price: 0,
            modifier_total: 0,
            item_total: 0,
            modifiers: Array.isArray(it.modifiers) ? it.modifiers : [],
            kitchen_station: stationByProduct.get(it.product_id) ?? null,
            notes: null,
          })),
        };

        await printKitchenDocket80mm(
          // The print formatter accepts the full DocketOrder shape; we
          // only populate the fields it reads.
          printOrder as unknown as Parameters<typeof printKitchenDocket80mm>[0],
          isDineIn ? "Celsius Coffee Dine-in" : "Celsius Coffee Pickup",
        );

        // Atomic claim: only stamp printed_at if it's still NULL.
        // If the UPDATE returns no rows, another terminal beat us —
        // their print already fired and the row was claimed. Silent
        // no-op rather than reprinting.
        await supabase
          .from("orders")
          .update({ kitchen_docket_printed_at: new Date().toISOString() })
          .eq("id", orderId)
          .is("kitchen_docket_printed_at", null);
      } catch (e: unknown) {
        const msg = e instanceof Error ? e.message : String(e);
        console.error("[pickup-printer]", msg);
      } finally {
        setTimeout(() => inFlightRef.current.delete(orderId), 5000);
      }
    };

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
      const { data } = await supabase
        .from("orders")
        .select("id")
        .eq("store_id", storeId)
        .is("kitchen_docket_printed_at", null)
        .in("status", Array.from(PRINTABLE_STATUSES))
        // Last 6 hours only — we don't want to dump a day's worth of
        // historical orders onto the printer if the column was
        // backfilled. Same-day pickup; anything older is stale.
        .gte(
          "created_at",
          new Date(Date.now() - 6 * 60 * 60 * 1000).toISOString(),
        )
        .order("created_at", { ascending: true })
        .limit(20);
      if (cancelled) return;
      for (const r of (data ?? []) as Array<{ id: string }>) {
        if (cancelled) break;
        // Sequential — back-to-back prints can starve the SUNMI bridge
        // if fired in parallel.
        // eslint-disable-next-line no-await-in-loop
        await tryPrint(r.id);
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
            const id = (payload.new as Row | null)?.id;
            if (id) void tryPrint(id);
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
            const next = payload.new as Row | null;
            const prev = payload.old as Row | null;
            if (!next?.id) return;
            // Skip the UPDATE that sets printed_at (avoids an infinite
            // loop with our own claim write).
            if (next.kitchen_docket_printed_at) return;
            const becamePrintable =
              PRINTABLE_STATUSES.has(next.status) &&
              (!prev || !PRINTABLE_STATUSES.has(prev.status));
            if (becamePrintable) void tryPrint(next.id);
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

/**
 * Mount-only component that runs the printer hook for the lifetime of
 * the app. Drop it inside the root layout so the listener is alive
 * whenever the POS is open at an outlet.
 */
export function PickupPrinterMount(): null {
  usePickupPrinter();
  return null;
}
