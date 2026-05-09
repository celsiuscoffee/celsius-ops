import { NextRequest, NextResponse } from "next/server";
import Stripe from "stripe";
import { getSupabaseAdmin } from "@/lib/supabase/server";
import { earnLoyaltyPoints, deductLoyaltyPoints } from "@/lib/loyalty/points";

function getStripe() {
  const key = process.env.STRIPE_SECRET_KEY?.trim();
  if (!key) throw new Error("STRIPE_SECRET_KEY env var is not set on this deployment");
  // Vercel cold starts + the SDK's 2x retry on connection error can exceed
  // the function timeout, surfacing as StripeConnectionError to the client.
  // Fail fast (no retries, 8s timeout) and let the client retry once warm.
  return new Stripe(key, {
    apiVersion: "2026-03-25.dahlia",
    maxNetworkRetries: 0,
    timeout: 8000,
  });
}

export async function POST(request: NextRequest) {
  try {
    const { orderId } = await request.json();

    if (!orderId) {
      return NextResponse.json({ error: "Missing orderId" }, { status: 400 });
    }

    const supabase = getSupabaseAdmin();
    const { data: order, error } = await supabase
      .from("orders")
      .select("id, order_number, total, payment_method")
      .eq("id", orderId)
      .single<{
        id: string;
        order_number: string;
        total: number;
        payment_method: string | null;
      }>();

    if (error || !order) {
      return NextResponse.json({ error: "Order not found" }, { status: 404 });
    }

    // Zero-amount orders (e.g. customer applied a free-drink reward
    // on a single-item cart) — Stripe rejects amounts below its MYR
    // minimum (~RM 2 / 200 sen) with a 500 error. Bypass Stripe
    // entirely in that case: mark the order paid here and run the
    // same earn/deduct hooks the Stripe webhook would have run.
    if (order.total <= 0) {
      const { data: updated } = await supabase
        .from("orders")
        .update({
          status: "preparing",
          payment_provider_ref: `zero-${order.id}`,
        } as Record<string, unknown>)
        .eq("id", order.id)
        .eq("status", "pending")
        .select("loyalty_id, loyalty_points_earned, reward_id, store_id")
        .single<{
          loyalty_id: string | null;
          loyalty_points_earned: number;
          reward_id: string | null;
          store_id: string;
        }>();

      // If the order wasn't pending (already advanced by another path)
      // just acknowledge the skip — the client will navigate to the
      // order page either way and it'll show the current status.
      if (updated?.loyalty_id) {
        const outletId = updated.store_id;
        if (updated.loyalty_points_earned > 0) {
          await earnLoyaltyPoints(
            updated.loyalty_id,
            order.id,
            updated.loyalty_points_earned,
            outletId,
          );
        }
        if (updated.reward_id) {
          const ok = await deductLoyaltyPoints(
            updated.loyalty_id,
            updated.reward_id,
            outletId,
          );
          if (!ok) {
            console.error(
              `[loyalty] zero-pay path: FAILED to deduct points for order=${order.id} reward=${updated.reward_id} — RECONCILE MANUALLY`,
            );
          }
        }
      }

      return NextResponse.json({
        skipPayment: true,
        orderId: order.id,
        status: "preparing",
      });
    }

    const stripe = getStripe();
    // Use automatic_payment_methods so Stripe surfaces every method enabled
    // on the dashboard (card, FPX, GrabPay, Apple Pay, Google Pay, etc.)
    // for the currency/country — keeps the app payment-method-agnostic.
    const paymentIntent = await stripe.paymentIntents.create({
      amount: order.total, // already in sen (smallest currency unit for MYR)
      currency: "myr",
      automatic_payment_methods: { enabled: true },
      metadata: {
        orderId: order.id,
        orderNumber: order.order_number,
      },
    });

    return NextResponse.json({
      clientSecret:    paymentIntent.client_secret,
      paymentIntentId: paymentIntent.id,
    });
  } catch (err: unknown) {
    console.error("Create payment intent error:", err);
    const message =
      err instanceof Error ? err.message : "Failed to create payment intent";
    const code =
      typeof err === "object" && err !== null && "code" in err
        ? (err as { code: string }).code
        : undefined;
    const stripeType =
      typeof err === "object" && err !== null && "type" in err
        ? (err as { type: string }).type
        : undefined;
    const keyPrefix = (process.env.STRIPE_SECRET_KEY ?? "").slice(0, 7);
    const keyLen    = (process.env.STRIPE_SECRET_KEY ?? "").length;
    return NextResponse.json(
      { error: message, code, type: stripeType, keyPrefix, keyLen },
      { status: 500 }
    );
  }
}

// GET probe — quick connectivity sanity check from the deployed runtime.
// Pings Stripe's account endpoint with the configured key and reports
// what's actually reachable.
export async function GET() {
  const keyPrefix = (process.env.STRIPE_SECRET_KEY ?? "").slice(0, 7);
  const keyLen    = (process.env.STRIPE_SECRET_KEY ?? "").length;
  try {
    const stripe = getStripe();
    const acct = await stripe.accounts.retrieve();
    return NextResponse.json({
      ok: true,
      keyPrefix,
      keyLen,
      account: acct.id,
      country: acct.country,
      defaultCurrency: acct.default_currency,
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    const stripeType =
      typeof err === "object" && err !== null && "type" in err
        ? (err as { type: string }).type
        : undefined;
    return NextResponse.json(
      { ok: false, keyPrefix, keyLen, error: message, type: stripeType },
      { status: 500 }
    );
  }
}
