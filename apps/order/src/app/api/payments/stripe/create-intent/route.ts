import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase/server";
import { checkRateLimit, RATE_LIMITS } from "@celsius/shared";

export const preferredRegion = "iad1";

// POST /api/payments/stripe/create-intent
// Uses raw fetch instead of the Stripe Node SDK to avoid SDK networking issues on Vercel.
export async function POST(request: NextRequest) {
  // Rate limit — every PaymentIntent creation costs us a Stripe API
  // call + a row write. Without this, an attacker can flood Stripe
  // with intents and burn through our request budget.
  // RATE_LIMITS.PAYMENT_CREATE is 20/min per identifier.
  const ip = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "unknown";
  const rate = await checkRateLimit(ip, RATE_LIMITS.PAYMENT_CREATE);
  if (!rate.allowed) {
    return NextResponse.json(
      { error: "Too many payment attempts. Try again shortly." },
      {
        status: 429,
        headers: rate.retryAfter
          ? { "Retry-After": String(rate.retryAfter) }
          : undefined,
      },
    );
  }

  try {
    const { orderId, paymentMethod } = await request.json() as { orderId: string; paymentMethod?: string };
    if (!orderId) return NextResponse.json({ error: "Missing orderId" }, { status: 400 });

    const key = process.env.STRIPE_SECRET_KEY?.trim();
    if (!key) return NextResponse.json({ error: "Stripe not configured" }, { status: 500 });

    const supabase = getSupabaseAdmin();
    const { data: order, error } = await supabase
      .from("orders")
      .select("id, order_number, total, store_id")
      .eq("id", orderId)
      .single();

    if (error || !order) {
      return NextResponse.json({ error: "Order not found" }, { status: 404 });
    }

    // Build PaymentIntent params based on selected payment method:
    //  - fpx:    bank redirect (must allow redirects)
    //  - wallet: Apple Pay / Google Pay (no redirects needed)
    //  - card:   card + Stripe Link (no redirects, Link handled inline)
    const base: Record<string, string> = {
      amount:              String(Math.round(order.total)),
      currency:            "myr",
      "metadata[orderId]":      order.id,
      "metadata[orderNumber]":  order.order_number,
      "metadata[storeId]":      order.store_id ?? "",
    };

    let pmParams: Record<string, string>;
    if (paymentMethod === "fpx") {
      pmParams = { "payment_method_types[]": "fpx" };
    } else {
      // card and wallet: automatic methods, no redirects (keeps card+Link+Apple Pay)
      pmParams = {
        "automatic_payment_methods[enabled]":        "true",
        "automatic_payment_methods[allow_redirects]": "never",
      };
    }

    const body = new URLSearchParams({ ...base, ...pmParams });

    const stripeRes = await fetch("https://api.stripe.com/v1/payment_intents", {
      method:  "POST",
      headers: {
        "Authorization": `Bearer ${key}`,
        "Content-Type":  "application/x-www-form-urlencoded",
        "Stripe-Version": "2024-06-20",
      },
      body,
    });

    const data = await stripeRes.json() as { client_secret?: string; error?: { message: string } };

    if (!stripeRes.ok || !data.client_secret) {
      const msg = data.error?.message ?? "Stripe error";
      console.error("Stripe API error:", msg);
      return NextResponse.json({ error: msg }, { status: 500 });
    }

    return NextResponse.json({ clientSecret: data.client_secret });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("Stripe create-intent error:", message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
