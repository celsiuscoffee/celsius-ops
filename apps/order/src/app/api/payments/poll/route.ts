import { NextRequest, NextResponse } from "next/server";
import { after } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase/server";
import { queryCheckoutStatus } from "@/lib/revenue-monster/client";
import { markRmOrderPaid, markRmOrderFailed } from "@/lib/revenue-monster/order-status";
import { notifyOrderPreparing } from "@/lib/push/templates";

/**
 * Poll RM's Query Payment Checkout for a given order and reconcile.
 *
 * Why: in Direct Payment Checkout mode RM treats webhook delivery as
 * best-effort and explicitly tells integrators to poll. Right now the
 * native order detail screen has a 5s React Query poll on /api/orders/[id]
 * but if the webhook is dropped (or fails signature verification, which
 * has been happening) the order is stuck pending forever even though RM
 * has the money. This endpoint asks RM directly and updates the row when
 * RM says SUCCESS / FAILED.
 *
 * No-op if the order is already in a non-pending state (idempotent).
 */
export async function POST(request: NextRequest) {
  try {
    const { orderId } = (await request.json()) as { orderId?: string };
    if (!orderId) {
      return NextResponse.json({ error: "Missing orderId" }, { status: 400 });
    }

    const supabase = getSupabaseAdmin();
    const { data: order, error } = await supabase
      .from("orders")
      .select("id, status, payment_checkout_id, payment_method")
      .eq("id", orderId)
      .single<{
        id: string;
        status: string;
        payment_checkout_id: string | null;
        payment_method: string | null;
      }>();

    if (error || !order) {
      return NextResponse.json({ error: "Order not found" }, { status: 404 });
    }
    // Already settled — nothing to do.
    if (order.status !== "pending") {
      return NextResponse.json({ status: order.status, source: "db" });
    }
    if (!order.payment_checkout_id) {
      // Pre-poll orders or non-RM orders don't have a checkoutId stashed.
      // Caller can fall back to the standard order screen flow.
      return NextResponse.json({ status: "pending", source: "no_checkout_id" });
    }

    const result = await queryCheckoutStatus(order.payment_checkout_id);
    if (result.status === "SUCCESS") {
      const paid = await markRmOrderPaid({ orderId: order.id }, result.transactionId);
      if (paid && !paid.scheduled) {
        // Suppress for scheduled orders — promote-scheduled fires
        // the push at brew-window-open time. See the equivalent
        // suppression in the RM webhook handler.
        after(async () => {
          await notifyOrderPreparing({
            orderId:       paid.orderId,
            orderNumber:   paid.orderNumber,
            customerPhone: paid.customerPhone,
          }).catch((e) => console.warn("[push] order_preparing rm poll", e));
        });
      }
      return NextResponse.json({
        status: paid?.scheduled ? "paid" : "preparing",
        source: "rm",
        transactionId: result.transactionId,
      });
    }
    if (result.status === "FAILED" || result.status === "EXPIRED" || result.status === "CANCELLED") {
      await markRmOrderFailed({ orderId: order.id });
      return NextResponse.json({ status: "failed", source: "rm", rmStatus: result.status });
    }
    return NextResponse.json({ status: "pending", source: "rm", rmStatus: result.status });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Poll failed";
    console.error("RM poll error:", err);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
