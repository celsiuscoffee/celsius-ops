import { NextRequest, NextResponse } from "next/server";
import { reconcileRmOrder } from "@/lib/revenue-monster/reconcile";

/**
 * Ask RM directly whether an order's checkout has settled, and reconcile.
 *
 * RM Direct mode treats webhook delivery as best-effort and tells
 * integrators to poll. The order screens (web _OrderTrackingView +
 * pickup-native) hit this every few seconds while a pending RM order is
 * open, so a dropped/sig-failed webhook still settles in seconds.
 *
 * Thin wrapper over the shared reconcileRmOrder() — the single source of
 * truth used by the webhook, the ?payment=done redirect, this poll, and
 * the cron. Idempotent + never throws.
 */
export async function POST(request: NextRequest) {
  const { orderId } = (await request.json().catch(() => ({}))) as { orderId?: string };
  if (!orderId) {
    return NextResponse.json({ error: "Missing orderId" }, { status: 400 });
  }
  const result = await reconcileRmOrder({ orderId });
  return NextResponse.json(result);
}
