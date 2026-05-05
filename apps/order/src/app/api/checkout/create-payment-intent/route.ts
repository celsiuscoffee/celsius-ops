import { NextRequest, NextResponse } from "next/server";
import Stripe from "stripe";
import { getSupabaseAdmin } from "@/lib/supabase/server";

function getStripe() {
  return new Stripe(process.env.STRIPE_SECRET_KEY!);
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
    // Surface the underlying Stripe error so the client can show a useful
    // message instead of "Failed to create payment intent".
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
    return NextResponse.json(
      { error: message, code, type: stripeType },
      { status: 500 }
    );
  }
}
