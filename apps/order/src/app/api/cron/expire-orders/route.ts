export const dynamic = "force-dynamic";
// Declare the time budget explicitly — this route now makes one RM round-trip
// per stale order. We batch and bail before the deadline so a backlog never
// times out mid-sweep (leftovers re-qualify on the next run).
export const maxDuration = 60;

import { NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase/server";
import { cronRoute } from "@/lib/cron-monitor";
import { queryCheckoutStatus } from "@/lib/revenue-monster/client";
import { markRmOrderPaid, markRmOrderFailed } from "@/lib/revenue-monster/order-status";

// Runs every 15 minutes. Marks any "pending" order older than 10 minutes as "failed".
// This cleans up abandoned payments (user left FPX page, browser closed, etc.).
// reconcile-pending runs every 5 min and resolves Stripe-known cases earlier.

async function runExpireOrders() {
  try {
    const supabase = getSupabaseAdmin();
    const cutoff   = new Date(Date.now() - 10 * 60 * 1000).toISOString(); // 10 minutes ago

    // Do NOT bulk-fail. An order can be "pending" past the window only because
    // its RM success was dropped (webhook signature failure / the client poll
    // watched a superseded checkout / the app was closed). Blindly failing here
    // is what turned PAID orders into "failed" and drove re-payments. So for any
    // order that reached an RM checkout, ASK RM first: settle if it was paid,
    // fail only when RM confirms not-paid, and on ANY uncertainty leave it for
    // the next sweep rather than risk failing a payment in flight.
    const { data: stale, error } = await supabase
      .from("orders")
      .select("id, order_number, payment_checkout_id")
      .eq("status", "pending")
      .lt("created_at", cutoff)
      .limit(100);

    if (error) throw error;

    type StaleOrder = { id: string; order_number: string; payment_checkout_id: string | null };
    const orders = (stale ?? []) as StaleOrder[];
    let settled = 0, failed = 0, deferred = 0;

    // One order -> one RM round-trip (or a direct fail for never-paid abandons).
    async function reconcile(o: StaleOrder): Promise<"settled" | "failed" | "deferred"> {
      if (!o.payment_checkout_id) {
        // Never reached an RM checkout — abandoned before paying, safe to fail.
        await markRmOrderFailed({ orderId: o.id }, "abandoned_unpaid");
        return "failed";
      }
      try {
        const r = await queryCheckoutStatus(o.payment_checkout_id);
        if (r.status === "SUCCESS") {
          await markRmOrderPaid({ orderId: o.id }, r.transactionId);
          return "settled";
        }
        if (r.status === "FAILED" || r.status === "EXPIRED" || r.status === "CANCELLED") {
          await markRmOrderFailed({ orderId: o.id }, `rm_${r.status.toLowerCase()}`);
          return "failed";
        }
        return "deferred"; // still pending/unknown at RM — retry next sweep
      } catch (e) {
        console.warn(`[expire-orders] RM query failed for ${o.order_number}; deferring`, e);
        return "deferred";
      }
    }

    // Small concurrent batches (polite to RM, fast wall-clock); stop issuing
    // new work before maxDuration so a large backlog can't time out mid-flight
    // — leftovers simply re-qualify on the next 15-min sweep.
    const CONCURRENCY = 6;
    const DEADLINE_MS = 50_000; // headroom under maxDuration=60
    const startedAt = Date.now();
    for (let i = 0; i < orders.length; i += CONCURRENCY) {
      if (Date.now() - startedAt > DEADLINE_MS) {
        deferred += orders.length - i;
        break;
      }
      const results = await Promise.all(orders.slice(i, i + CONCURRENCY).map(reconcile));
      for (const r of results) {
        if (r === "settled") settled++;
        else if (r === "failed") failed++;
        else deferred++;
      }
    }

    console.log(`[expire-orders] stale=${orders.length} settled=${settled} failed=${failed} deferred=${deferred}`);
    return NextResponse.json({ stale: orders.length, settled, failed, deferred });
  } catch (err) {
    console.error("[expire-orders] Error:", err);
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}

// Heartbeat tier: if this sweep silently stops, abandoned pending orders
// pile up and dropped RM successes never settle — that costs money/orders.
export const GET = cronRoute("expire-orders", runExpireOrders, {
  schedule: "*/15 * * * *",
});
