export const dynamic = "force-dynamic";
// Declare the time budget explicitly — this route now makes one RM round-trip
// per stale order. We batch and bail before the deadline so a backlog never
// times out mid-sweep (leftovers re-qualify on the next run).
export const maxDuration = 60;

import { NextRequest, NextResponse, after } from "next/server";
import * as Sentry from "@sentry/nextjs";
import { getSupabaseAdmin } from "@/lib/supabase/server";
import { checkCronAuth } from "@celsius/shared";
import { queryCheckoutStatus } from "@/lib/revenue-monster/client";
import { markRmOrderPaid, markRmOrderFailed } from "@/lib/revenue-monster/order-status";

// Runs every 15 minutes. Marks any "pending" order older than 10 minutes as "failed".
// This cleans up abandoned payments (user left FPX page, browser closed, etc.).
// reconcile-pending runs every 5 min and resolves Stripe-known cases earlier.

export async function GET(request: NextRequest) {
  const cronAuth = checkCronAuth(request.headers);
  if (!cronAuth.ok) return NextResponse.json({ error: cronAuth.error }, { status: cronAuth.status });

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
      .select("id, order_number, payment_checkout_id, store_id, total, table_number, created_at")
      .eq("status", "pending")
      .lt("created_at", cutoff)
      .limit(100);

    if (error) throw error;

    type StaleOrder = {
      id: string;
      order_number: string;
      payment_checkout_id: string | null;
      store_id: string;
      total: number | null;
      table_number: string | null;
      created_at: string;
    };
    const orders = (stale ?? []) as StaleOrder[];
    let settled = 0, failed = 0, deferred = 0;

    // 2026-08-20 incident (C-8ZXV75): RM answered PENDING for ~2h on a paid
    // FPX order, so the deferral loop below was correct but SILENT — the
    // customer complained before anyone knew. Any checkout-bearing order
    // still deferred past this age is a possible paid-but-invisible order;
    // raise a Sentry issue (fingerprinted per order, so the alert fires once
    // and later sweeps fold into the same issue) telling staff to check the
    // RM portal. Detection only — settlement behavior is unchanged.
    const STUCK_ALERT_MS = 30 * 60 * 1000;
    const stuck: StaleOrder[] = [];

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
        noteIfStuck(o);
        return "deferred"; // still pending/unknown at RM — retry next sweep
      } catch (e) {
        console.warn(`[expire-orders] RM query failed for ${o.order_number}; deferring`, e);
        noteIfStuck(o);
        return "deferred";
      }
    }

    function noteIfStuck(o: StaleOrder) {
      if (Date.now() - new Date(o.created_at).getTime() > STUCK_ALERT_MS) stuck.push(o);
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

    for (const o of stuck) {
      const ageMin = Math.round((Date.now() - new Date(o.created_at).getTime()) / 60_000);
      const amount = o.total != null ? `RM${(o.total / 100).toFixed(2)}` : "unknown amount";
      const where = o.table_number ? `${o.store_id} table ${o.table_number}` : o.store_id;
      Sentry.withScope((scope) => {
        scope.setLevel("error");
        scope.setFingerprint(["stuck-pending-order", o.order_number]);
        scope.setTag("store_id", o.store_id);
        scope.setContext("order", {
          order_number: o.order_number,
          store_id: o.store_id,
          table_number: o.table_number,
          total_sen: o.total,
          created_at: o.created_at,
          payment_checkout_id: o.payment_checkout_id,
        });
        Sentry.captureMessage(
          `[stuck-pending] ${o.order_number} (${where}) ${amount} pending ${ageMin} min — gateway still answers PENDING; check the RM portal whether the customer was charged`,
        );
      });
    }
    if (stuck.length > 0) after(() => Sentry.flush(2000));

    console.log(`[expire-orders] stale=${orders.length} settled=${settled} failed=${failed} deferred=${deferred} stuck=${stuck.length}`);
    return NextResponse.json({ stale: orders.length, settled, failed, deferred, stuck: stuck.length });
  } catch (err) {
    console.error("[expire-orders] Error:", err);
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
