import { NextRequest, NextResponse } from "next/server";
import { after } from "next/server";
import { validateWebhookSignature } from "@/lib/revenue-monster/client";
import { markRmOrderPaid, markRmOrderFailed } from "@/lib/revenue-monster/order-status";
import { notifyOrderPreparing } from "@/lib/push/templates";

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
/** Map an RM callback's referenceId/additionalData to a markRm* target.
 *  additionalData is the order UUID we set in createPayment — unambiguous, so
 *  prefer it. Otherwise strip the trailing "-<base36 timestamp>" createPayment
 *  appends to order_number. The base36 suffix is lowercase and >=6 chars, which
 *  never collides with an order_number's own digits-only or UPPERCASE trailing
 *  segment (C-0937 / C-LVU802), so suffix-less legacy ids pass through intact.
 *  The old /^(C-\d+)/ matched only numeric order numbers, silently dropping
 *  every alphanumeric checkout/initiate order's payment. */
function resolveOrderTarget(
  referenceId: string,
  additionalData?: string,
): { orderId?: string; orderNumber?: string } {
  if (
    additionalData &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(additionalData)
  ) {
    return { orderId: additionalData };
  }
  return { orderNumber: referenceId.replace(/-[0-9a-z]{6,}$/, "") };
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
      data?: {
        referenceId: string;
        transactionId: string;
        status: string;
        additionalData?: string;
      };
    };

    if (code !== "SUCCESS" || !data) {
      return NextResponse.json({ code: "OK" });
    }

    // Prefer the order UUID (additionalData) RM echoes back; fall back to a
    // suffix-safe order_number strip. Handles numeric AND alphanumeric order
    // numbers — see resolveOrderTarget.
    const target = resolveOrderTarget(data.referenceId, data.additionalData);

    if (data.status === "SUCCESS") {
      const paid = await markRmOrderPaid(target, data.transactionId);
      if (paid && !paid.scheduled) {
        // Same "Brewing now" push the Stripe webhook fires. Suppressed
        // when the order was held for scheduled pickup — promote-
        // scheduled cron fires the push at brew-window-open time
        // instead, so the customer doesn't get a "brewing now" ping
        // 30 min before their drink is actually being made.
        after(async () => {
          await notifyOrderPreparing({
            orderId:       paid.orderId,
            orderNumber:   paid.orderNumber,
            customerPhone: paid.customerPhone,
          }).catch((e) => console.warn("[push] order_preparing rm webhook", e));
        });
      }
    } else if (data.status === "FAILED") {
      await markRmOrderFailed(target);
    }

    return NextResponse.json({ code: "SUCCESS" });
  } catch (err) {
    console.error("Webhook error:", err);
    return NextResponse.json({ code: "ERROR" });
  }
}
