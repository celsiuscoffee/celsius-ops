import { NextRequest, NextResponse } from "next/server";
import { after } from "next/server";
import Stripe from "stripe";
import { getSupabaseAdmin } from "@/lib/supabase/server";
import { earnLoyaltyPoints, deductLoyaltyPoints } from "@/lib/loyalty/points";
import { applyOrderV2Hooks } from "@/lib/loyalty/v2";
import { notifyOrderPreparing } from "@/lib/push/templates";
import { shouldHoldForScheduled } from "@/lib/revenue-monster/order-status";

function getStripe() {
  const key = process.env.STRIPE_SECRET_KEY?.trim();
  if (!key) return null;
  return new Stripe(key, { apiVersion: "2026-03-25.dahlia" });
}

/**
 * POST /api/orders/[orderId]/confirm-stripe
 *
 * Client-side fallback for when the Stripe webhook is delayed or misconfigured.
 * Called from the order tracking page when the customer returns from Stripe with
 * redirect_status=succeeded but the order is still "pending" in our DB.
 *
 * Verifies the PaymentIntent server-side and, if succeeded, advances the order
 * to "preparing" — same as the webhook handler does.
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ orderId: string }> }
) {
  const { orderId } = await params;

  try {
    const body = await request.json() as { paymentIntentId?: string };
    const { paymentIntentId } = body;

    if (!paymentIntentId) {
      return NextResponse.json({ error: "Missing paymentIntentId" }, { status: 400 });
    }

    const stripe = getStripe();
    if (!stripe) {
      return NextResponse.json({ error: "Stripe not configured" }, { status: 500 });
    }

    const intent = await stripe.paymentIntents.retrieve(paymentIntentId);

    if (intent.status !== "succeeded") {
      return NextResponse.json({ confirmed: false, status: intent.status });
    }

    // Security: the PaymentIntent metadata must carry the orderId we're confirming
    if (intent.metadata?.orderId !== orderId) {
      return NextResponse.json({ error: "Order mismatch" }, { status: 403 });
    }

    const supabase = getSupabaseAdmin();

    // Decide hold-for-scheduled vs preparing — same logic as the RM
    // path. Peek at the row + outlet to know pickup_at + prep_time
    // before the actual status update.
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

    const { data: updated } = await supabase
      .from("orders")
      .update({
        status:               nextStatus,
        payment_provider_ref: intent.id,
        payment_failure_reason: null,
      } as Record<string, unknown>)
      .eq("id", orderId)
      // Idempotent — no-op for already-settled rows. "failed" is rescued:
      // a declined first attempt flips the order to failed (webhook/cron)
      // while the customer can still retry the same intent, and Stripe has
      // verified `succeeded` above. Money received always wins.
      .in("status", ["pending", "failed"])
      .select("loyalty_id, loyalty_points_earned, reward_id, wallet_voucher_id, store_id, order_number, customer_phone, created_at")
      .single();

    if (updated?.loyalty_id) {
      const outletId = updated.store_id as string;
      const loyaltyId = updated.loyalty_id as string;
      const pointsEarned = (updated.loyalty_points_earned as number) ?? 0;
      const rewardId = (updated.reward_id as string | null) ?? null;
      const orderCreatedAt = (updated.created_at as string) ?? new Date().toISOString();
      const walletVoucherId = (updated.wallet_voucher_id as string | null) ?? null;

      // Loyalty earn/deduct + v2 hooks — all post-response via after()
      // so the customer isn't blocked, but AWAITED inside it: these were
      // fire-and-forget promises before, so a rejection vanished and a
      // serverless freeze could drop the write entirely (silent points
      // loss the reconcile cron then had to repair).
      after(async () => {
        try {
          if (pointsEarned > 0) {
            await earnLoyaltyPoints(loyaltyId, orderId, pointsEarned, outletId);
          }
          if (rewardId) {
            await deductLoyaltyPoints(loyaltyId, rewardId, outletId);
          }
        } catch (e) {
          console.error(`[confirm-stripe] loyalty earn/deduct failed for order=${orderId}`, e);
        }
        await applyOrderV2Hooks({
          memberId: loyaltyId,
          orderId,
          outletId,
          orderCreatedAt,
          walletVoucherId,
        });
      });
    }

    // "Brewing now" push — suppressed for scheduled orders (the
    // promote-scheduled cron fires it at brew-window-open time
    // instead).
    if (updated && !scheduled) {
      const orderRow = updated as { order_number: string; customer_phone: string | null };
      after(async () => {
        await notifyOrderPreparing({
          orderId,
          orderNumber:   orderRow.order_number,
          customerPhone: orderRow.customer_phone,
        }).catch((e) => console.warn("[push] order_preparing confirm-stripe", e));
      });
    }

    return NextResponse.json({ confirmed: true });
  } catch (err) {
    console.error("confirm-stripe error:", err);
    return NextResponse.json({ error: "Failed to confirm" }, { status: 500 });
  }
}
