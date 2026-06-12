export const dynamic = "force-dynamic";
// One RM/Stripe round-trip per failed order — same budget discipline as
// expire-orders: batch, and stop issuing work before the deadline.
export const maxDuration = 60;

import { NextRequest, NextResponse } from "next/server";
import Stripe from "stripe";
import { getSupabaseAdmin } from "@/lib/supabase/server";
import { checkCronAuth } from "@celsius/shared";
import { queryCheckoutStatus } from "@/lib/revenue-monster/client";
import { markRmOrderPaid } from "@/lib/revenue-monster/order-status";
import { earnLoyaltyPoints, deductLoyaltyPoints } from "@/lib/loyalty/points";

/**
 * Audit/backfill sweep for the "paid but failed" class of incident
 * (C-9782): a payment that succeeds AFTER the order was flipped to
 * failed used to have no path into the system, so the money sat at the
 * gateway while the order showed "failed".
 *
 * This endpoint asks the gateway about every failed order in the window
 * and reports the ones that were actually PAID. It is NOT on a cron
 * schedule — it's an operator tool for incident QA:
 *
 *   GET /api/cron/reconcile-failed?days=30             → dry-run report
 *   GET /api/cron/reconcile-failed?days=30&apply=true  → settle them too
 *
 * Dry-run is the default on purpose: a historical paid-but-failed order
 * may have been handled out-of-band (refunded at the portal, re-rung on
 * POS), so settling it blindly could double-fulfil. Review the dry-run
 * list, refund or settle each case deliberately, then use apply=true
 * only if every remaining row should be honoured as paid.
 *
 * apply=true settles through the same paths the live flows use
 * (markRmOrderPaid / the Stripe-succeeded update + loyalty earn), so
 * points and vouchers behave exactly like a normal payment.
 */

type FailedOrder = {
  id: string;
  order_number: string;
  store_id: string;
  status: string;
  total: number;
  payment_method: string | null;
  payment_checkout_id: string | null;
  payment_failure_reason: string | null;
  loyalty_id: string | null;
  loyalty_points_earned: number | null;
  reward_id: string | null;
  customer_phone: string | null;
  created_at: string;
};

type PaidButFailed = {
  orderNumber: string;
  orderId: string;
  storeId: string;
  totalSen: number;
  method: string | null;
  gateway: "revenue_monster" | "stripe";
  transactionId: string | null;
  failureReason: string | null;
  createdAt: string;
  applied: boolean;
};

function getStripe() {
  const key = process.env.STRIPE_SECRET_KEY?.trim();
  if (!key) return null;
  return new Stripe(key, { apiVersion: "2026-03-25.dahlia" });
}

export async function GET(request: NextRequest) {
  const cronAuth = checkCronAuth(request.headers);
  if (!cronAuth.ok) return NextResponse.json({ error: cronAuth.error }, { status: cronAuth.status });

  const params = request.nextUrl.searchParams;
  const days   = Math.min(Math.max(Number(params.get("days") ?? 30) || 30, 1), 90);
  const apply  = params.get("apply") === "true";

  const supabase = getSupabaseAdmin();
  const since    = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();

  const { data, error } = await supabase
    .from("orders")
    .select("id, order_number, store_id, status, total, payment_method, payment_checkout_id, payment_failure_reason, loyalty_id, loyalty_points_earned, reward_id, customer_phone, created_at")
    .eq("status", "failed")
    .gt("created_at", since)
    .order("created_at", { ascending: false })
    .limit(300);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  const orders = (data ?? []) as FailedOrder[];
  const stripe = getStripe();

  const paidButFailed: PaidButFailed[] = [];
  let checked = 0, deferred = 0;
  const errors: string[] = [];

  async function audit(order: FailedOrder): Promise<void> {
    // RM-routed: the checkout id is the authoritative handle. Orders
    // that never reached a checkout can't have taken money.
    if (order.payment_checkout_id) {
      const rm = await queryCheckoutStatus(order.payment_checkout_id);
      checked += 1;
      if (rm.status !== "SUCCESS") return;
      let applied = false;
      if (apply) {
        applied = (await markRmOrderPaid({ orderId: order.id }, rm.transactionId)) != null;
      }
      paidButFailed.push({
        orderNumber: order.order_number,
        orderId: order.id,
        storeId: order.store_id,
        totalSen: order.total,
        method: order.payment_method,
        gateway: "revenue_monster",
        transactionId: rm.transactionId,
        failureReason: order.payment_failure_reason,
        createdAt: order.created_at,
        applied,
      });
      return;
    }

    // No RM checkout — check Stripe by the intent's orderId metadata.
    // Covers the declined-then-retried-successfully intent case.
    if (!stripe) { deferred += 1; return; }
    const search = await stripe.paymentIntents.search({
      query: `metadata['orderId']:'${order.id}'`,
      limit: 1,
    });
    checked += 1;
    const intent = search.data[0];
    if (!intent || intent.status !== "succeeded") return;
    let applied = false;
    if (apply) {
      const { data: updated } = await supabase
        .from("orders")
        .update({
          status: "preparing",
          payment_provider_ref: intent.id,
          payment_failure_reason: null,
        } as Record<string, unknown>)
        .eq("id", order.id)
        .eq("status", "failed")
        .select("id")
        .maybeSingle();
      applied = updated != null;
      if (applied && order.loyalty_id) {
        if ((order.loyalty_points_earned ?? 0) > 0) {
          await earnLoyaltyPoints(order.loyalty_id, order.id, order.loyalty_points_earned ?? 0, order.store_id);
        }
        if (order.reward_id) {
          await deductLoyaltyPoints(order.loyalty_id, order.reward_id, order.store_id);
        }
      }
    }
    paidButFailed.push({
      orderNumber: order.order_number,
      orderId: order.id,
      storeId: order.store_id,
      totalSen: order.total,
      method: order.payment_method,
      gateway: "stripe",
      transactionId: intent.id,
      failureReason: order.payment_failure_reason,
      createdAt: order.created_at,
      applied,
    });
  }

  const CONCURRENCY = 6;
  const DEADLINE_MS = 50_000;
  const startedAt = Date.now();
  for (let i = 0; i < orders.length; i += CONCURRENCY) {
    if (Date.now() - startedAt > DEADLINE_MS) {
      deferred += orders.length - i;
      break;
    }
    await Promise.all(
      orders.slice(i, i + CONCURRENCY).map((o) =>
        audit(o).catch((e) => {
          deferred += 1;
          errors.push(`${o.order_number}: ${e instanceof Error ? e.message : String(e)}`);
        }),
      ),
    );
  }

  return NextResponse.json({
    mode: apply ? "apply" : "dry-run",
    windowDays: days,
    failedOrdersInWindow: orders.length,
    checked,
    deferred,
    paidButFailed,
    errors: errors.slice(0, 20),
  });
}
