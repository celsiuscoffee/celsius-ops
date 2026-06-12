import { NextRequest, NextResponse } from "next/server";
import { after } from "next/server";
import Stripe from "stripe";
import { getSupabaseAdmin } from "@/lib/supabase/server";
import { earnLoyaltyPoints, deductLoyaltyPoints } from "@/lib/loyalty/points";
import { applyOrderV2Hooks } from "@/lib/loyalty/v2";
import { notifyOrderPreparing } from "@/lib/push/templates";
import { shouldHoldForScheduled } from "@/lib/revenue-monster/order-status";

export const preferredRegion = "iad1";

function getStripe() {
  const key = process.env.STRIPE_SECRET_KEY?.trim();
  if (!key) throw new Error("STRIPE_SECRET_KEY is not set");
  return new Stripe(key, { apiVersion: "2026-03-25.dahlia" });
}

export async function POST(request: NextRequest) {
  const body      = await request.text();
  const signature = request.headers.get("stripe-signature") ?? "";
  const secret    = process.env.STRIPE_WEBHOOK_SECRET ?? "";

  let event: Stripe.Event;
  try {
    event = getStripe().webhooks.constructEvent(body, signature, secret);
  } catch (err) {
    console.error("Stripe webhook signature error:", err);
    return NextResponse.json({ error: "Invalid signature" }, { status: 400 });
  }

  const supabase = getSupabaseAdmin();

  if (event.type === "payment_intent.succeeded") {
    const intent  = event.data.object as Stripe.PaymentIntent;
    const orderId = intent.metadata?.orderId;
    if (orderId) {
      // Peek for pickup_at + outlet prep_time so we can hold the row
      // in "paid" for scheduled pickups instead of jumping straight
      // to "preparing". Mirrors the RM + confirm-stripe paths.
      const { data: peek } = await supabase
        .from("orders")
        .select("store_id, pickup_at")
        .eq("id", orderId)
        .maybeSingle();
      let prepTimeMins = 10;
      if ((peek as { store_id?: string | null } | null)?.store_id) {
        const { data: outlet } = await supabase
          .from("outlet_settings")
          .select("pickup_time_mins")
          .eq("store_id", (peek as { store_id: string }).store_id)
          .maybeSingle();
        const ptm = (outlet as { pickup_time_mins?: number } | null)?.pickup_time_mins;
        if (typeof ptm === "number" && ptm > 0) prepTimeMins = ptm;
      }
      const pickupAt = (peek as { pickup_at?: string | null } | null)?.pickup_at ?? null;
      const scheduled = shouldHoldForScheduled(pickupAt, prepTimeMins);
      const nextStatus = scheduled ? "paid" : "preparing";

      const { data: order } = await supabase
        .from("orders")
        .update({
          status:               nextStatus,
          payment_provider_ref: intent.id,
          payment_failure_reason: null,
        } as Record<string, unknown>)
        .eq("id", orderId)
        // "failed" settles too: payment_failed fires on a declined FIRST
        // attempt while the customer is still on the payment sheet, so a
        // successful retry on the same intent lands after we've already
        // flipped the order to failed. Money received always wins (same
        // rule as markRmOrderPaid). Still a no-op for preparing/paid rows,
        // so duplicate deliveries don't double-earn points.
        .in("status", ["pending", "failed"])
        .select("loyalty_id, loyalty_points_earned, reward_id, wallet_voucher_id, store_id, order_number, customer_phone, created_at")
        .single();

      if (order?.loyalty_id) {
        const outletId = order.store_id as string;
        // Awaited so Vercel doesn't kill the function mid-write —
        // returning the 200 to Stripe before the points actually
        // persist used to leave silent ledger gaps. The order-row
        // update above is gated on status="pending" so duplicate
        // webhook deliveries skip these calls (idempotent).
        if ((order.loyalty_points_earned as number) > 0) {
          await earnLoyaltyPoints(
            order.loyalty_id,
            orderId,
            order.loyalty_points_earned as number,
            outletId,
          );
        }
        if (order.reward_id) {
          const ok = await deductLoyaltyPoints(
            order.loyalty_id,
            order.reward_id as string,
            outletId,
          );
          if (!ok) {
            console.error(
              `[loyalty] Stripe webhook: FAILED to deduct points for order=${orderId} reward=${order.reward_id} — RECONCILE MANUALLY`,
            );
          }
        }

        // ─── Rewards v2 hooks ────────────────────────────────────────
        // Mark wallet voucher redeemed, advance missions, generate
        // mystery drop, pay out referral. Shared with the zero-pay
        // route + confirm-stripe fallback so adding a new payment path
        // only needs to call this helper. Runs in after() so the 200
        // to Stripe isn't blocked.
        const loyaltyId = order.loyalty_id as string;
        const orderCreatedAt = (order.created_at as string) ?? new Date().toISOString();
        const walletVoucherId = (order.wallet_voucher_id as string | null) ?? null;
        after(async () => {
          await applyOrderV2Hooks({
            memberId: loyaltyId,
            orderId,
            outletId,
            orderCreatedAt,
            walletVoucherId,
          });
        });
      }

      // "Brewing now ☕" push at the payment-confirmed moment. Before
      // this, customers got NO push between paying and the order being
      // marked ready — payment-success was silent because the webhook
      // bypasses the status PATCH route (which is where the preparing
      // push already fires for cash / manual flows). after() keeps the
      // Vercel invocation alive until the Expo fetch completes.
      // Gated on the row actually transitioning (data !== null) so a
      // duplicate webhook delivery doesn't re-fire the push.
      if (order && !scheduled) {
        const orderRow = order as { order_number: string; customer_phone: string | null };
        after(async () => {
          await notifyOrderPreparing({
            orderId,
            orderNumber:   orderRow.order_number,
            customerPhone: orderRow.customer_phone,
          }).catch((e) => console.warn("[push] order_preparing webhook", e));
        });
      }
    }
  }

  if (event.type === "payment_intent.payment_failed" || event.type === "payment_intent.canceled") {
    const intent  = event.data.object as Stripe.PaymentIntent;
    const orderId = intent.metadata?.orderId;
    if (orderId) {
      // Capture WHY: Stripe's decline code/message on a failure, or the
      // cancellation reason (often the customer dismissing the Apple/Google
      // Pay sheet). Surfaced in the backoffice so a failure isn't a mystery.
      const reason =
        event.type === "payment_intent.canceled"
          ? `cancelled${intent.cancellation_reason ? `: ${intent.cancellation_reason}` : ""}`
          : (intent.last_payment_error?.code
              ?? intent.last_payment_error?.decline_code
              ?? intent.last_payment_error?.message
              ?? "payment_failed");
      await supabase
        .from("orders")
        .update({ status: "failed", payment_failure_reason: reason } as Record<string, unknown>)
        .eq("id", orderId)
        .eq("status", "pending");
    }
  }

  return NextResponse.json({ received: true });
}
