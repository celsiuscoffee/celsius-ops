import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase/server";
import { validateWebhookSignature } from "@/lib/revenue-monster/client";
import { earnLoyaltyPoints, deductLoyaltyPoints } from "@/lib/loyalty/points";

/**
 * Revenue Monster webhook (FPX, ewallet, card-via-RM).
 *
 * Mirrors the Stripe webhook at /api/payments/stripe/webhook. Both
 * endpoints land on confirmed-payment events and use the direct-
 * Supabase loyalty helpers in lib/loyalty/points.ts to:
 *   • earn points for the order (via earnLoyaltyPoints)
 *   • burn the redeemed reward, if any (via deductLoyaltyPoints)
 *
 * Idempotency: the orders update is gated on status="pending" so a
 * duplicate webhook delivery doesn't trigger the points calls again.
 *
 * Was: this file had a local fire-and-forget HTTP-fetch earnLoyalty
 * helper that POSTed to loyalty/api/transactions — an endpoint that
 * only accepts GET, so every RM-paid order was silently 405'ing the
 * earn call. No deduct call existed at all, so RM-paid reward
 * redemptions were never recorded.
 */
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
      // referenceId is what we passed to RM as order.id — and that's
      // the customer-facing order_number (e.g. "C-6319"), not the
      // Supabase UUID. RM caps order.id at 24 chars so we couldn't
      // send the UUID. Look up by order_number instead.
      const { data: order } = await supabase
        .from("orders")
        .update({
          status: "preparing",
          payment_provider_ref: data.transactionId,
        } as Record<string, unknown>)
        .eq("order_number", data.referenceId)
        .eq("status", "pending")
        .select("id, loyalty_id, loyalty_points_earned, reward_id, store_id")
        .single<{
          id: string;
          loyalty_id: string | null;
          loyalty_points_earned: number;
          reward_id: string | null;
          store_id: string;
        }>();

      if (order?.loyalty_id) {
        const outletId = order.store_id;
        if (order.loyalty_points_earned > 0) {
          // earn/deduct loyalty calls expect the internal UUID, not
          // RM's truncated reference, so use the row we just fetched.
          await earnLoyaltyPoints(
            order.loyalty_id,
            order.id,
            order.loyalty_points_earned,
            outletId,
          );
        }
        if (order.reward_id) {
          const ok = await deductLoyaltyPoints(order.loyalty_id, order.reward_id, outletId);
          if (!ok) {
            console.error(
              `[loyalty] RM webhook: FAILED to deduct points for order=${order.id} reward=${order.reward_id} — RECONCILE MANUALLY`,
            );
          }
        }
      }
    } else if (data.status === "FAILED") {
      // Same order_number lookup — referenceId is the order_number we
      // sent to RM, not the Supabase UUID.
      await supabase
        .from("orders")
        .update({ status: "failed" } as Record<string, unknown>)
        .eq("order_number", data.referenceId);
    }

    return NextResponse.json({ code: "SUCCESS" });
  } catch (err) {
    console.error("Webhook error:", err);
    return NextResponse.json({ code: "ERROR" });
  }
}
