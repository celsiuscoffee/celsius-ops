import { NextRequest, NextResponse } from "next/server";
import { validateWebhookSignature } from "@/lib/revenue-monster/client";
import { reconcileRmOrder } from "@/lib/revenue-monster/reconcile";

/**
 * Revenue Monster webhook (FPX, ewallet, card-via-RM).
 *
 * This handler treats the callback as a HINT, not as the source of truth.
 * RM Direct-mode webhook delivery is best-effort and its signature has
 * been bouncing legitimate callbacks — so trusting the payload's claimed
 * `status` (and dropping the event when the signature won't verify) used
 * to strand paid orders as `pending` until the 5-min reconcile cron.
 *
 * Instead we resolve the order and call reconcileRmOrder(), which asks
 * RM's Query Payment Checkout endpoint directly and settles the order on
 * RM's authoritative answer. Consequences:
 *   • A dropped / signature-failed webhook no longer strands a payment —
 *     any trigger (this, the ?payment=done redirect, the poll, the cron)
 *     settles it from RM's truth.
 *   • A spoofed webhook can't mark an order paid — RM still reports the
 *     real status, so we never trust attacker-supplied "SUCCESS".
 * Signature verification is kept for observability/anti-abuse only; it no
 * longer gates settlement.
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

    // Verify for observability/anti-abuse only — do NOT gate settlement on
    // it. A bouncing signature must not strand a real payment; reconcile
    // re-verifies against RM regardless, so an unverifiable (or spoofed)
    // callback can never mark an unpaid order paid.
    const isValid = validateWebhookSignature("POST", url, nonce, timestamp, body, signature);
    if (!isValid) {
      console.warn("[rm webhook] signature did not verify — treating callback as a re-query trigger only");
    }

    const { data } = body as {
      code: string;
      data?: {
        referenceId: string;
        additionalData?: string;
      };
    };

    if (!data?.referenceId && !data?.additionalData) {
      return NextResponse.json({ code: "OK" });
    }

    // Prefer the order UUID (additionalData) RM echoes back; fall back to a
    // suffix-safe order_number strip. Handles numeric AND alphanumeric order
    // numbers — see resolveOrderTarget.
    const target = resolveOrderTarget(data.referenceId ?? "", data.additionalData);

    // Authoritative settle: ignore the payload's claimed status and ask RM
    // directly. Awaited so the order flips (and the kitchen docket fires via
    // Realtime) before we ack; the loyalty push is deferred inside reconcile.
    await reconcileRmOrder(target);

    return NextResponse.json({ code: "SUCCESS" });
  } catch (err) {
    console.error("Webhook error:", err);
    return NextResponse.json({ code: "ERROR" });
  }
}
