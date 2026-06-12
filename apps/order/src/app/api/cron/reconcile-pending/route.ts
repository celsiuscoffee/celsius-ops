export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";
import Stripe from "stripe";
import { getSupabaseAdmin } from "@/lib/supabase/server";
import { earnLoyaltyPoints, deductLoyaltyPoints } from "@/lib/loyalty/points";
import { checkCronAuth } from "@celsius/shared";
import { queryCheckoutStatus } from "@/lib/revenue-monster/client";
import { markRmOrderPaid, markRmOrderFailed } from "@/lib/revenue-monster/order-status";

// Finds "pending" orders between 45s and 55 minutes old and reconciles them
// against Stripe (and Revenue Monster) — covers wallet/card confirms where the
// gateway webhook never fired. The 45s floor (was 2 min) is the safety net for
// customers who close the app/browser before the on-screen poll
// (_OrderTrackingView / pickup-native) settles the order; both the cron and the
// poll are idempotent (gated on status=pending), so they can't double-process.
// Older rows are left to /api/cron/expire-orders, which fails them at 60 min.

function getStripe() {
  const key = process.env.STRIPE_SECRET_KEY?.trim();
  if (!key) return null;
  return new Stripe(key, { apiVersion: "2026-03-25.dahlia" });
}

type OrderLite = {
  id: string;
  order_number: string;
  status: string;
  store_id: string;
  loyalty_id: string | null;
  loyalty_points_earned: number | null;
  reward_id: string | null;
  payment_method: string | null;
  payment_checkout_id: string | null;
};

const RM_METHODS = new Set(["fpx", "tng", "boost", "shopeepay", "grabpay", "duitnow", "card"]);

export async function GET(request: NextRequest) {
  const cronAuth = checkCronAuth(request.headers);
  if (!cronAuth.ok) return NextResponse.json({ error: cronAuth.error }, { status: cronAuth.status });

  const stripe = getStripe();
  if (!stripe) {
    return NextResponse.json({ error: "Stripe not configured" }, { status: 500 });
  }

  const supabase = getSupabaseAdmin();
  const now      = Date.now();
  const olderThan  = new Date(now - 45 * 1000).toISOString();
  const youngerThan = new Date(now - 55 * 60 * 1000).toISOString();

  // "failed" rows are swept too: a customer can retry payment on the same
  // order after a failed attempt, so money can land on an order already
  // flipped to failed (the C-9782 card→FPX case). reconcileRmOrder re-asks
  // RM and markRmOrderPaid accepts failed → paid; the Stripe branch below
  // still only transitions pending rows, so failed non-RM orders are
  // skipped in the loop.
  const { data: pending, error } = await supabase
    .from("orders")
    .select("id, order_number, status, store_id, loyalty_id, loyalty_points_earned, reward_id, payment_method, payment_checkout_id")
    .in("status", ["pending", "failed"])
    .lt("created_at", olderThan)
    .gt("created_at", youngerThan);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  const orders = (pending ?? []) as OrderLite[];
  const result = { checked: orders.length, advanced: 0, failed: 0, unresolved: 0 };

  for (const order of orders) {
    try {
      // RM-routed orders are reconciled against Revenue Monster's
      // Query Payment Checkout endpoint via the same code path the
      // order-page poll uses. Webhooks are best-effort on RM Direct
      // mode, so this catches the dropped-webhook case for any RM
      // method (TNG, FPX, Boost, ShopeePay, GrabPay, DuitNow, card).
      if (order.payment_method && RM_METHODS.has(order.payment_method)) {
        if (!order.payment_checkout_id) {
          result.unresolved += 1;
          continue;
        }
        const rm = await queryCheckoutStatus(order.payment_checkout_id);
        if (rm.status === "SUCCESS") {
          const paid = await markRmOrderPaid({ orderId: order.id }, rm.transactionId);
          if (paid) result.advanced += 1;
          else      result.unresolved += 1;
        } else if (rm.status === "FAILED" || rm.status === "CANCELLED" || rm.status === "EXPIRED") {
          // No-op for rows already failed (markRmOrderFailed is gated on
          // status='pending'); only counts a fresh pending → failed flip.
          if (order.status === "pending") {
            await markRmOrderFailed({ orderId: order.id }, `rm_${rm.status.toLowerCase()}`);
            result.failed += 1;
          }
        } else {
          result.unresolved += 1;
        }
        continue;
      }

      // Failed non-RM (Stripe) orders aren't retryable on the same order —
      // only pending rows are reconciled against Stripe.
      if (order.status !== "pending") continue;

      // Stripe indexes metadata for search within a few seconds of intent creation.
      const search = await stripe.paymentIntents.search({
        query: `metadata['orderId']:'${order.id}'`,
        limit: 1,
      });
      const intent = search.data[0];

      if (!intent) {
        result.unresolved += 1;
        continue;
      }

      if (intent.status === "succeeded") {
        const { data: updated } = await supabase
          .from("orders")
          .update({
            status: "preparing",
            payment_provider_ref: intent.id,
          } as Record<string, unknown>)
          .eq("id", order.id)
          .eq("status", "pending")
          .select("id")
          .maybeSingle();

        if (updated) {
          if (order.loyalty_id) {
            if ((order.loyalty_points_earned ?? 0) > 0) {
              earnLoyaltyPoints(order.loyalty_id, order.id, order.loyalty_points_earned ?? 0, order.store_id);
            }
            if (order.reward_id) {
              deductLoyaltyPoints(order.loyalty_id, order.reward_id, order.store_id);
            }
          }
          result.advanced += 1;
        }
      } else if (intent.status === "canceled" || intent.status === "requires_payment_method") {
        // requires_payment_method after a failed attempt means the wallet /
        // card rejected — treat as failed so the KDS stops seeing a ghost row.
        const reason = intent.status === "canceled"
          ? `cancelled${intent.cancellation_reason ? `: ${intent.cancellation_reason}` : ""}`
          : (intent.last_payment_error?.code
              ?? intent.last_payment_error?.decline_code
              ?? intent.last_payment_error?.message
              ?? "payment_failed");
        await supabase
          .from("orders")
          .update({ status: "failed", payment_failure_reason: reason } as Record<string, unknown>)
          .eq("id", order.id)
          .eq("status", "pending");
        result.failed += 1;
      } else {
        result.unresolved += 1;
      }
    } catch (err) {
      console.error("[reconcile-pending]", order.order_number, err);
      result.unresolved += 1;
    }
  }

  return NextResponse.json(result);
}
