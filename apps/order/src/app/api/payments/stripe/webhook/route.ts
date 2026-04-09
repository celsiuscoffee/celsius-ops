import { NextRequest, NextResponse } from "next/server";
import Stripe from "stripe";
import { getSupabaseAdmin } from "@/lib/supabase/server";
import { earnLoyaltyPoints, deductLoyaltyPoints } from "@/lib/loyalty/points";

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
      const { data: order } = await supabase
        .from("orders")
        .update({
          status:               "preparing",
          payment_provider_ref: intent.id,
        } as Record<string, unknown>)
        .eq("id", orderId)
        .eq("status", "pending")
        .select("loyalty_id, loyalty_points_earned, reward_id, store_id")
        .single();

      if (order?.loyalty_id) {
        const outletId = order.store_id as string;
        if ((order.loyalty_points_earned as number) > 0) {
          earnLoyaltyPoints(order.loyalty_id, orderId, order.loyalty_points_earned as number, outletId);
        }
        if (order.reward_id) {
          deductLoyaltyPoints(order.loyalty_id, order.reward_id as string, outletId);
        }
      }
    }
  }

  if (event.type === "payment_intent.payment_failed" || event.type === "payment_intent.canceled") {
    const intent  = event.data.object as Stripe.PaymentIntent;
    const orderId = intent.metadata?.orderId;
    if (orderId) {
      await supabase
        .from("orders")
        .update({ status: "failed" } as Record<string, unknown>)
        .eq("id", orderId)
        .eq("status", "pending");
    }
  }

  return NextResponse.json({ received: true });
}
