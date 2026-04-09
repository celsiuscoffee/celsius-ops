import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase/server";
import { validateWebhookSignature } from "@/lib/revenue-monster/client";

// .trim() guards against accidental trailing newlines in env var values
const LOYALTY_BASE     = (process.env.LOYALTY_BASE_URL  ?? "https://loyalty.celsiuscoffee.com").trim();
const LOYALTY_BRAND_ID = (process.env.LOYALTY_BRAND_ID  ?? "brand-celsius").trim();

/** Earn loyalty points after a confirmed payment. Fire-and-forget. */
async function earnLoyaltyPoints(loyaltyId: string, orderId: string, points: number) {
  if (points <= 0) return;
  try {
    await fetch(`${LOYALTY_BASE}/api/transactions`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        brand_id:     LOYALTY_BRAND_ID,
        member_id:    loyaltyId,
        type:         "earn",
        points,
        reference_id: orderId,
        description:  `Points earned for order`,
      }),
    });
  } catch (err) {
    console.error("Loyalty earn points error:", err);
  }
}

export async function POST(request: NextRequest) {
  try {
    const body      = await request.json();
    const nonce     = request.headers.get("x-nonce-str")  || "";
    const timestamp = request.headers.get("x-timestamp")  || "";
    const signature = request.headers.get("x-signature")  || "";
    const url       = request.nextUrl.toString();

    const isValid = validateWebhookSignature("POST", url, nonce, timestamp, body, signature);
    if (!isValid) {
      console.warn("Webhook signature mismatch");
      return NextResponse.json({ code: "SIGNATURE_ERROR" });
    }

    const { code, data } = body as {
      code: string;
      data?: { referenceId: string; transactionId: string; status: string };
    };

    if (code !== "SUCCESS" || !data) {
      return NextResponse.json({ code: "OK" });
    }

    const supabase = getSupabaseAdmin();

    if (data.status === "SUCCESS") {
      const { data: order } = await supabase
        .from("orders")
        .update({ status: "preparing", payment_provider_ref: data.transactionId } as Record<string, unknown>)
        .eq("id", data.referenceId)
        .eq("status", "pending")
        .select("loyalty_id, loyalty_points_earned")
        .single();

      if (order?.loyalty_id && order?.loyalty_points_earned > 0) {
        earnLoyaltyPoints(order.loyalty_id, data.referenceId, order.loyalty_points_earned);
      }
    } else if (data.status === "FAILED") {
      await supabase
        .from("orders")
        .update({ status: "failed" } as Record<string, unknown>)
        .eq("id", data.referenceId);
    }

    return NextResponse.json({ code: "SUCCESS" });
  } catch (err) {
    console.error("Webhook error:", err);
    return NextResponse.json({ code: "ERROR" });
  }
}
