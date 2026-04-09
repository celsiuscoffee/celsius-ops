import { NextRequest, NextResponse } from "next/server";
import Stripe from "stripe";
import { getSupabaseAdmin } from "@/lib/supabase/server";
import { earnLoyaltyPoints, deductLoyaltyPoints } from "@/lib/loyalty/points";

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
    const { data: updated } = await supabase
      .from("orders")
      .update({
        status:               "preparing",
        payment_provider_ref: intent.id,
      } as Record<string, unknown>)
      .eq("id", orderId)
      .eq("status", "pending") // idempotent — only acts if still pending
      .select("loyalty_id, loyalty_points_earned, reward_id, store_id")
      .single();

    if (updated?.loyalty_id) {
      const outletId = updated.store_id as string;
      if ((updated.loyalty_points_earned as number) > 0) {
        earnLoyaltyPoints(updated.loyalty_id as string, orderId, updated.loyalty_points_earned as number, outletId);
      }
      if (updated.reward_id) {
        deductLoyaltyPoints(updated.loyalty_id as string, updated.reward_id as string, outletId);
      }
    }

    return NextResponse.json({ confirmed: true });
  } catch (err) {
    console.error("confirm-stripe error:", err);
    return NextResponse.json({ error: "Failed to confirm" }, { status: 500 });
  }
}
