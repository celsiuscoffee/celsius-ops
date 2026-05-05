import { NextRequest, NextResponse } from "next/server";
import Stripe from "stripe";
import { getSupabaseAdmin } from "@/lib/supabase/server";

function getStripe() {
  const key = process.env.STRIPE_SECRET_KEY?.trim();
  if (!key) throw new Error("STRIPE_SECRET_KEY env var is not set on this deployment");
  return new Stripe(key, { apiVersion: "2026-03-25.dahlia" });
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
      .single();

    if (error || !order) {
      return NextResponse.json({ error: "Order not found" }, { status: 404 });
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
