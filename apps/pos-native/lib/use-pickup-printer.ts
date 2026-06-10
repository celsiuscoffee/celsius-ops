import { useEffect, useRef } from "react";
import { AppState, Alert } from "react-native";
import { supabase } from "./supabase";
import { printKitchenDocket80mm, printReceipt80mm, isPrinterFault, shouldAlertPrinterFault, printerAvailable } from "./printer";

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
  // Totals needed for the customer receipt slip. All sen-based.
  subtotal: number | null;
  sst_amount: number | null;
  discount_amount: number | null;
  total: number | null;
  payment_method: string | null;
  loyalty_phone: string | null;
};

type PickupOrderItemRow = {
  product_id: string;
  product_name: string;
  variant_name: string | null;
  quantity: number;
  unit_price: number | null;
  item_total: number | null;
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

/** The pickup/order app stores per-item customer notes as
 *  `modifiers.specialInstructions` and chosen options as
 *  `modifiers.selections[].label` — NOT the flat array shape Grab uses. These
 *  two helpers normalize a pickup item's modifiers JSONB so the kitchen docket
 *  prints item notes + chosen options exactly like a Grab order does (this is
 *  why pickup item notes previously never printed — they were passed as null). */
function pickupItemNote(mods: unknown): string | null {
  if (mods && typeof mods === "object" && !Array.isArray(mods)) {
    const si = (mods as { specialInstructions?: unknown }).specialInstructions;
    if (typeof si === "string" && si.trim()) return si.trim();
  }
  return null;
}
function pickupItemModifiers(mods: unknown): { name: string }[] {
  // Already a flat array (older / Grab-style) → pass through unchanged.
  if (Array.isArray(mods)) return mods as { name: string }[];
  if (mods && typeof mods === "object") {
    const sels = (mods as { selections?: unknown }).selections;
    if (Array.isArray(sels)) {
      return sels
        .map((s: any) => ({ name: String(s?.label ?? s?.name ?? "") }))
        .filter((s) => s.name);
    }
  }
  return [];
}

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
      // A device without the native printer module must NEVER claim a
      // docket: printKitchenDocket80mm is a silent no-op there, so the
      // claim write below would stamp kitchen_docket_printed_at with no
      // paper anywhere — and the real register would skip the order as
      // already printed (tickets "vanish" until a manual reprint).
      if (!printerAvailable()) return;
      try {
        // Re-read so we have the latest status + don't fire if another
        // terminal already claimed the docket in the small Realtime →
        // print window.
        const { data: order } = await supabase
          .from("orders")
          .select(
            "id, order_number, store_id, status, order_type, table_number, pickup_at, notes, customer_name, customer_phone, created_at, kitchen_docket_printed_at, subtotal, sst_amount, discount_amount, total, payment_method, loyalty_phone",
          )
          .eq("id", orderId)
          .maybeSingle();
        const row = order as PickupOrderRow | null;
        if (!row) return;
        if (!storeIdRef.current || row.store_id !== storeIdRef.current) return;
        if (row.kitchen_docket_printed_at) return;
        if (!PRINTABLE_STATUSES.has(row.status)) return;

        // Claim the in-flight guard ONLY now — after confirming this order is
        // actually printable. Claiming it earlier (before the status check)
        // meant a still-pending card order's INSERT locked the id for 5s, so
        // the pending→preparing UPDATE ~2s later was skipped and the docket
        // never printed (root cause of pickup orders silently not printing).
        if (inFlightRef.current.has(orderId)) return;
        inFlightRef.current.add(orderId);

        // Items can arrive a beat after the order row when the writer
        // commits them in separate statements. The Realtime INSERT
        // delivers on the `orders` commit, so a single fetch sometimes
        // returns zero rows. Retry once after a short delay before
        // giving up — beats letting a real order print blank.
        let rows: PickupOrderItemRow[] = [];
        for (let attempt = 0; attempt < 3; attempt++) {
          const { data: items } = await supabase
            .from("order_items")
            .select("product_id, product_name, variant_name, quantity, unit_price, item_total, modifiers")
            .eq("order_id", orderId);
          rows = (items ?? []) as PickupOrderItemRow[];
          if (rows.length > 0) break;
          if (attempt < 2) {
            // eslint-disable-next-line no-await-in-loop
            await new Promise((r) => setTimeout(r, 400));
          }
        }
        if (rows.length === 0) {
          console.warn(`[pickup-printer] no items for order ${orderId} after 3 attempts; skipping`);
          return;
        }

        const products = productsRef.current;
        // Kitchen docket items — no prices needed.
        const docketItems = rows.map((r) => ({
          product_name: r.product_name,
          variant_name: r.variant_name,
          quantity: r.quantity,
          kitchen_station: products.get(r.product_id)?.kitchen_station ?? null,
          modifiers: pickupItemModifiers(r.modifiers),
          notes: pickupItemNote(r.modifiers),
        }));
        // Receipt items — prices needed for the customer slip.
        const receiptItems = rows.map((r) => ({
          product_name: r.product_name,
          variant_name: r.variant_name,
          quantity: r.quantity,
          unit_price: r.unit_price ?? 0,
          modifier_total: 0,
          item_total: r.item_total ?? (r.unit_price ?? 0) * r.quantity,
          modifiers: pickupItemModifiers(r.modifiers),
          notes: pickupItemNote(r.modifiers),
        }));

        // For QR-dine-in we surface "DINE-IN" + the table number so the
        // docket reads "TABLE N" instead of a counter queue label
        // (parity with PR #216). For pickup/takeaway we keep
        // order_number as the queue label.
        const isDineIn = row.order_type === "dine_in";
        const outletLabel = isDineIn ? "Celsius Coffee Dine-in" : "Celsius Coffee Pickup";
        const docketOrder = {
          order_number: row.order_number,
          order_type: isDineIn ? "dine_in" : "takeaway",
          table_number: isDineIn ? row.table_number ?? null : null,
          queue_number: row.order_number,
          created_at: row.created_at,
          notes: row.notes,                          // order note → docket (kitchen sees it)
          pos_order_items: docketItems,
        };
        // Customer-facing receipt — same shape as the register's receipt.
        // Pickup orders don't carry a service charge in the orders table
        // (web/native pickup app applies SST + discounts upstream), so
        // we pass 0 here and trust subtotal/discount/total from the row.
        const receiptOrder = {
          order_number: row.order_number,
          order_type: isDineIn ? "dine_in" : "takeaway",
          table_number: isDineIn ? row.table_number ?? null : null,
          queue_number: row.order_number,
          created_at: row.created_at,
          notes: row.notes,                           // order-level note → receipt
          subtotal: row.subtotal ?? 0,
          service_charge: 0,
          discount_amount: row.discount_amount ?? 0,
          sst_amount: row.sst_amount ?? 0,
          total: row.total ?? row.subtotal ?? 0,
          pos_order_items: receiptItems,
          pos_order_payments: [{
            payment_method: row.payment_method || "qr",
            amount: row.total ?? row.subtotal ?? 0,
          }],
        };

        // Kitchen docket first (station-routed). If THIS throws we fall to
        // the outer catch with printed_at still NULL → it reprints on the
        // next foreground once the head is fixed. That's the intended
        // docket-fault recovery.
        await printKitchenDocket80mm(docketOrder, outletLabel, outletId);

        // Claim the docket the instant it prints — BEFORE the receipt.
        // Atomic: only mark printed if still NULL, so a terminal that beat
        // us no-ops instead of reprinting. Claiming HERE (not after the
        // receipt) is the docket-reprint fix: a receipt-only fault used to
        // skip this claim, so the next catch-up pass reprinted the docket
        // the kitchen was already making.
        await supabase
          .from("orders")
          .update({ kitchen_docket_printed_at: new Date().toISOString() })
          .eq("id", orderId)
          .is("kitchen_docket_printed_at", null);

        // Customer receipt is best-effort + isolated: a receipt fault must
        // NOT bubble to the outer catch (the docket is already printed +
        // claimed). Alert staff but leave the docket claimed so it never
        // double-prints to the kitchen.
        try {
          await printReceipt80mm(receiptOrder, outletLabel, undefined, outletId);
        } catch (re) {
          console.error("[pickup-printer] receipt print failed (docket already printed):", re);
          if (isPrinterFault(re) && shouldAlertPrinterFault()) {
            Alert.alert("Printer needs attention", "The customer receipt couldn't print — the kitchen docket already printed. Check the paper roll, then reprint the receipt if needed.");
          }
        }
      } catch (e) {
        console.error("[pickup-printer]", e);
        // Printer faulted (paper out / cover open / offline): the docket
        // was NOT claimed, so it reprints on the next foreground once the
        // head is fixed. Surface it so staff know to check the printer.
        if (isPrinterFault(e) && shouldAlertPrinterFault()) {
          Alert.alert("Printer needs attention", "A kitchen docket couldn't print — check the paper roll and cover, then it'll reprint automatically.");
        }
      } finally {
        // Free the local guard after 5s — a manual reprint feature
        // (future) can re-trigger without an app reload.
        setTimeout(() => inFlightRef.current.delete(orderId), 5000);
      }
    };

    let channel: ReturnType<typeof supabase.channel> | null = null;
    let cancelled = false;

    // Catch-up pass — anything printable + unprinted in the last 6h.
    // Runs (a) once on mount and (b) every time the POS app returns to
    // the foreground. (b) is the fix for card/pickup orders that flip
    // pending → preparing server-side (gateway/Maybank-QR confirm) while
    // the register was backgrounded or the device was asleep: the live
    // UPDATE is missed because the socket is suspended, so we reconcile
    // on resume. The atomic printed_at claim + inFlight guard make
    // re-running idempotent (already-printed rows are skipped).
    const runCatchUp = async () => {
      const storeId = storeIdRef.current;
      if (!storeId || cancelled) return;
      const { data } = await supabase
        .from("orders")
        .select("id")
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
    };

    // Re-reconcile whenever the app comes back to the foreground.
    let lastAppState = AppState.currentState;
    const appStateSub = AppState.addEventListener("change", (next) => {
      const resumed = lastAppState.match(/inactive|background/) && next === "active";
      lastAppState = next;
      if (resumed) {
        console.log("[pickup-printer] app resumed → catch-up rescan");
        void runCatchUp();
      }
    });

    // …and on a fixed interval. A register stays foregrounded all day, so
    // the resume hook above never fires there — a silently dropped realtime
    // socket (Wi-Fi blip / Supabase reconnect loses in-gap events) used to
    // leave orders unprinted for arbitrarily long ("tickets came 20 minutes
    // late"). The sweep is cheap (one indexed select, usually 0 rows) and
    // idempotent via the atomic printed_at claim, so 90s caps the worst-case
    // delay for ANY missed order at ~1.5 min.
    const sweepTimer = setInterval(() => void runCatchUp(), 90_000);

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

      // 1. Catch-up pass on mount.
      await runCatchUp();
      if (cancelled) return;

      // 2. Live: INSERT covers new orders; UPDATE covers webhook-flipped
      //    status (pending → preparing on gateway confirm, or
      //    pending → preparing on Maybank-QR staff release).
      console.log(`[pickup-printer] subscribing channel=pickup-printer-${outletId} filter=store_id=eq.${storeId}`);
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
            console.log(`[pickup-printer] INSERT event id=${id} store=${(payload.new as PickupOrderRow | null)?.store_id}`);
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
        .subscribe((status, err) => {
          console.log(`[pickup-printer] subscribe status=${status}${err ? " err=" + err.message : ""}`);
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
