import { useEffect, useRef } from "react";
import { AppState, Alert } from "react-native";
import { supabase } from "./supabase";
import { printKitchenDocket80mm, printReceipt80mm, isPrinterFault, shouldAlertPrinterFault, printerAvailable } from "./printer";

/**
 * GrabFood-order kitchen-docket auto-printer.
 *
 * Sibling to use-pickup-printer.ts. Where that hook listens on `orders`
 * for orders from the customer pickup app, this one listens on
 * `pos_orders` for rows inserted by the inbound Grab webhook
 * (apps/pos/src/app/api/grab/webhook → source='grabfood', filtered by
 * outlet_id resolved from outlets.grab_merchant_id).
 *
 * Same duplicate-print guards apply:
 *   pos_orders.kitchen_docket_printed_at is updated atomically AFTER the
 *   print succeeds (WHERE id = ? AND kitchen_docket_printed_at IS NULL).
 *   If another terminal beat us, the UPDATE returns zero rows and the
 *   second print is skipped. A 5s in-flight Set prevents the same row
 *   from double-firing within a single terminal when Realtime delivers
 *   INSERT + UPDATE back-to-back.
 *
 * Discovery:
 *   1. Catch-up pass on mount: anything in PRINTABLE_STATUSES that's
 *      unprinted in the last 6 hours.
 *   2. Realtime INSERT (new Grab orders) + UPDATE (state-change webhooks
 *      that flip status to a printable state).
 */

type ProductLite = {
  id: string;
  kitchen_station?: string | null;
};

type GrabPosOrderRow = {
  id: string;
  order_number: string;
  outlet_id: string;
  source: string;
  status: string;
  order_type: string | null;
  table_number: string | null;
  notes: string | null;
  customer_name: string | null;
  customer_phone: string | null;
  created_at: string;
  kitchen_docket_printed_at: string | null;
  // Totals — needed for the customer receipt (printReceipt80mm). All
  // sen-based. We don't print these on the kitchen docket but they
  // appear on the receipt slip that goes out with the food.
  subtotal: number | null;
  sst_amount: number | null;
  discount_amount: number | null;
  total: number | null;
};

type GrabPosOrderItemRow = {
  product_id: string;
  product_name: string;
  variant_name: string | null;
  quantity: number;
  unit_price: number | null;
  modifier_total: number | null;
  item_total: number | null;
  modifiers: unknown;
  notes: string | null;
};

/** Statuses that mean "Grab is sending this to the kitchen." Submit Order
 *  webhook initially writes 'sent_to_kitchen'; ACCEPTED / DRIVER_ALLOCATED
 *  state transitions can flip it but should still print on the first
 *  printable status seen. */
const PRINTABLE_STATUSES = new Set([
  "sent_to_kitchen",
  "preparing",
  "ready",
]);

export function useGrabPrinter(
  outletId: string | null | undefined,
  productsById: Map<string, ProductLite>,
) {
  const outletRef = useRef(outletId);
  const productsRef = useRef(productsById);
  useEffect(() => { outletRef.current = outletId; }, [outletId]);
  useEffect(() => { productsRef.current = productsById; }, [productsById]);

  // Intra-terminal 5s window guard against INSERT+UPDATE double-fire.
  const inFlightRef = useRef<Set<string>>(new Set());

  useEffect(() => {
    if (!outletId) return;

    const tryPrintOrder = async (orderId: string) => {
      if (inFlightRef.current.has(orderId)) return;
      // No native printer module on this device → never claim a docket here
      // (printKitchenDocket80mm would no-op "successfully" and the claim
      // would mark the order printed with no paper anywhere).
      if (!printerAvailable()) return;
      try {
        const { data: order } = await supabase
          .from("pos_orders")
          .select(
            "id, order_number, outlet_id, source, status, order_type, table_number, notes, customer_name, customer_phone, created_at, kitchen_docket_printed_at, subtotal, sst_amount, discount_amount, total",
          )
          .eq("id", orderId)
          .maybeSingle();
        const row = order as GrabPosOrderRow | null;
        if (!row) return;
        if (row.source !== "grabfood") return;
        if (row.outlet_id !== outletRef.current) return;
        if (row.kitchen_docket_printed_at) return;
        if (!PRINTABLE_STATUSES.has(row.status)) return;

        // Claim the in-flight guard ONLY now — after confirming printable.
        // Claiming before the status check would lock a not-yet-printable
        // order for 5s and skip its print on the next status flip.
        if (inFlightRef.current.has(orderId)) return;
        inFlightRef.current.add(orderId);

        // Race: Realtime INSERT on pos_orders fires before pos_order_items
        // commit in the Grab webhook (separate inserts). Retry once
        // before giving up so a real order doesn't print blank.
        let rows: GrabPosOrderItemRow[] = [];
        for (let attempt = 0; attempt < 3; attempt++) {
          const { data: items } = await supabase
            .from("pos_order_items")
            .select("product_id, product_name, variant_name, quantity, unit_price, modifier_total, item_total, modifiers, notes")
            .eq("order_id", orderId);
          rows = (items ?? []) as GrabPosOrderItemRow[];
          if (rows.length > 0) break;
          if (attempt < 2) {
            // eslint-disable-next-line no-await-in-loop
            await new Promise((r) => setTimeout(r, 400));
          }
        }
        if (rows.length === 0) {
          console.warn(`[grab-printer] no items for order ${orderId} after 3 attempts; skipping`);
          return;
        }

        const products = productsRef.current;
        // Build kitchen-docket-shaped items (no prices needed) AND
        // receipt-shaped items (need unit_price + item_total for the slip
        // the customer gets with their delivery).
        const docketItems = rows.map((r) => ({
          product_name: r.product_name,
          variant_name: r.variant_name,
          quantity: r.quantity,
          kitchen_station: products.get(r.product_id)?.kitchen_station ?? null,
          modifiers: r.modifiers,
          notes: r.notes,
        }));
        const receiptItems = rows.map((r) => ({
          product_name: r.product_name,
          variant_name: r.variant_name,
          quantity: r.quantity,
          unit_price: r.unit_price ?? 0,
          modifier_total: r.modifier_total ?? 0,
          item_total: r.item_total ?? ((r.unit_price ?? 0) + (r.modifier_total ?? 0)) * r.quantity,
          modifiers: r.modifiers,
          notes: r.notes,
        }));

        const docketOrder = {
          order_number: row.order_number,            // "GF-12345"
          order_type: "takeaway",                    // Grab = takeaway from kitchen POV
          table_number: null,
          queue_number: row.order_number,
          created_at: row.created_at,
          notes: row.notes,                          // order note → docket (kitchen sees it)
          pos_order_items: docketItems,
        };
        const receiptOrder = {
          order_number: row.order_number,
          order_type: "takeaway",
          table_number: null,
          queue_number: row.order_number,
          created_at: row.created_at,
          notes: row.notes,                           // Grab order note → receipt
          subtotal: row.subtotal ?? 0,
          service_charge: 0,                          // Grab handles its own fees off-receipt
          discount_amount: row.discount_amount ?? 0,
          sst_amount: row.sst_amount ?? 0,
          total: row.total ?? row.subtotal ?? 0,
          pos_order_items: receiptItems,
          pos_order_payments: [{
            payment_method: "grabfood",
            amount: row.total ?? row.subtotal ?? 0,
          }],
        };

        // Kitchen docket first (routes to station printers / falls through
        // to one combined KITCHEN docket if no stations are set). If THIS
        // throws we fall to the outer catch with printed_at still NULL → it
        // reprints next foreground once the head is fixed.
        await printKitchenDocket80mm(docketOrder, "Celsius Coffee GrabFood", outletId);

        // Claim the docket the instant it prints — BEFORE the receipt.
        // Atomic: only mark printed if still NULL. Claiming HERE (not after
        // the receipt) is the docket-reprint fix: a receipt-only fault used
        // to skip this claim, so the next catch-up pass reprinted the docket
        // the kitchen was already making.
        await supabase
          .from("pos_orders")
          .update({ kitchen_docket_printed_at: new Date().toISOString() })
          .eq("id", orderId)
          .is("kitchen_docket_printed_at", null);

        // Customer receipt (rider hands it over with the food) is best-effort
        // + isolated: a receipt fault must NOT bubble to the outer catch and
        // trigger a docket reprint — the docket is already printed + claimed.
        try {
          await printReceipt80mm(receiptOrder, "Celsius Coffee GrabFood", undefined, outletId);
        } catch (re) {
          console.error("[grab-printer] receipt print failed (docket already printed):", re);
          if (isPrinterFault(re) && shouldAlertPrinterFault()) {
            Alert.alert("Printer needs attention", "The customer receipt couldn't print — the kitchen docket already printed. Check the paper roll, then reprint the receipt if needed.");
          }
        }
      } catch (e) {
        console.error("[grab-printer]", e);
        if (isPrinterFault(e) && shouldAlertPrinterFault()) {
          Alert.alert("Printer needs attention", "A kitchen docket couldn't print — check the paper roll and cover, then it'll reprint automatically.");
        }
      } finally {
        setTimeout(() => inFlightRef.current.delete(orderId), 5000);
      }
    };

    let channel: ReturnType<typeof supabase.channel> | null = null;
    let cancelled = false;

    // Catch-up: unprinted Grab orders for this outlet, last 6h. Runs on
    // mount AND whenever the POS app returns to the foreground — Grab
    // state-change webhooks (ACCEPTED → preparing) can land while the
    // register is backgrounded/asleep and the live UPDATE is missed; the
    // resume rescan reconciles. Idempotent via the atomic printed_at
    // claim + inFlight guard.
    const runCatchUp = async () => {
      if (cancelled) return;
      const { data } = await supabase
        .from("pos_orders")
        .select("id")
        .eq("source", "grabfood")
        .eq("outlet_id", outletId)
        .is("kitchen_docket_printed_at", null)
        .in("status", Array.from(PRINTABLE_STATUSES))
        .gte("created_at", new Date(Date.now() - 6 * 60 * 60 * 1000).toISOString())
        .order("created_at", { ascending: true })
        .limit(20);
      if (cancelled) return;
      for (const r of (data ?? []) as { id: string }[]) {
        if (cancelled) break;
        // eslint-disable-next-line no-await-in-loop
        await tryPrintOrder(r.id);
      }
    };

    let lastAppState = AppState.currentState;
    const appStateSub = AppState.addEventListener("change", (next) => {
      const resumed = lastAppState.match(/inactive|background/) && next === "active";
      lastAppState = next;
      if (resumed) {
        console.log("[grab-printer] app resumed → catch-up rescan");
        void runCatchUp();
      }
    });

    // …and on a fixed interval: a register never backgrounds, so the resume
    // hook alone can't recover orders whose realtime event was lost to a
    // dropped socket. 90s caps any missed Grab docket's delay at ~1.5 min.
    const sweepTimer = setInterval(() => void runCatchUp(), 90_000);

    (async () => {
      // 1. Catch-up on mount.
      await runCatchUp();
      if (cancelled) return;

      // 2. Live: INSERT (new Grab order) + UPDATE (state change flips status).
      console.log(`[grab-printer] subscribing channel=grab-printer-${outletId} filter=outlet_id=eq.${outletId}`);
      channel = supabase
        .channel(`grab-printer-${outletId}`)
        .on(
          "postgres_changes",
          {
            event: "INSERT",
            schema: "public",
            table: "pos_orders",
            filter: `outlet_id=eq.${outletId}`,
          },
          (payload) => {
            const row = payload.new as GrabPosOrderRow | null;
            console.log(`[grab-printer] INSERT event id=${row?.id} source=${row?.source}`);
            if (row?.source === "grabfood" && row.id) void tryPrintOrder(row.id);
          },
        )
        .on(
          "postgres_changes",
          {
            event: "UPDATE",
            schema: "public",
            table: "pos_orders",
            filter: `outlet_id=eq.${outletId}`,
          },
          (payload) => {
            const next = payload.new as GrabPosOrderRow | null;
            const prev = payload.old as GrabPosOrderRow | null;
            if (next?.source !== "grabfood" || !next.id) return;
            // Skip our own claim write to avoid an infinite re-print loop.
            if (next.kitchen_docket_printed_at) return;
            const becamePrintable =
              PRINTABLE_STATUSES.has(next.status) &&
              (!prev || !PRINTABLE_STATUSES.has(prev.status));
            if (becamePrintable) void tryPrintOrder(next.id);
          },
        )
        .subscribe((status, err) => {
          console.log(`[grab-printer] subscribe status=${status}${err ? " err=" + err.message : ""}`);
        });
    })();

    return () => {
      cancelled = true;
      appStateSub.remove();
      clearInterval(sweepTimer);
      if (channel) void supabase.removeChannel(channel);
    };
  }, [outletId]);
}
