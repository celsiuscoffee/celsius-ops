import { NextRequest, NextResponse } from "next/server";
import webpush from "web-push";
import { getSupabaseAdmin } from "@/lib/supabase/server";
import type { OrderRow, OrderStatus } from "@/lib/supabase/types";
import {
  notifyOrderPreparing,
  notifyOrderReady,
  notifyOrderCompleted,
  notifyOrderCancelled,
} from "@/lib/push/templates";

const VALID_TRANSITIONS: Record<string, OrderStatus[]> = {
  pending:   ["preparing", "failed"],  // cash orders or manual staff override
  paid:      ["preparing", "failed"],
  preparing: ["ready", "failed"],
  ready:     ["completed", "preparing"], // preparing = staff-undo of accidental Ready tap
};

function initVapid() {
  const pub  = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY;
  const priv = process.env.VAPID_PRIVATE_KEY;
  const email = process.env.VAPID_EMAIL ?? "mailto:hello@celsiuscoffee.com";
  if (pub && priv) {
    webpush.setVapidDetails(email, pub, priv);
  }
}

/** Web Push (PWA browser subscriptions, scoped to this order). Used
 *  for the legacy order.celsiuscoffee.com flow. Native pushes go
 *  through templates.ts above. */
async function sendOrderReadyWebPush(orderId: string, orderNumber: string) {
  try {
    initVapid();
    const supabase = getSupabaseAdmin();

    const { data: webSubs } = await supabase
      .from("push_subscriptions")
      .select("*")
      .eq("order_id", orderId);

    if (!webSubs?.length) return;

    const payload = JSON.stringify({
      title: "🎉 Order Ready!",
      body:  `Your order #${orderNumber} is ready for pickup!`,
      icon:  "/icons/icon-192.png",
      badge: "/icons/badge-72.png",
      tag:   `order-${orderId}`,
      requireInteraction: true,
      data: { orderId },
    });

    await Promise.allSettled(
      webSubs.map((sub) =>
        webpush.sendNotification(
          { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } },
          payload
        )
      )
    );
  } catch (err) {
    console.warn("[push/web] order-ready failed:", err);
  }
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ orderId: string }> }
) {
  try {
    const { orderId }          = await params;
    const { status: newStatus } = await request.json() as { status: OrderStatus };

    if (!newStatus) {
      return NextResponse.json({ error: "Missing status" }, { status: 400 });
    }

    const supabase = getSupabaseAdmin();

    const { data, error: fetchError } = await supabase
      .from("orders")
      .select("status, order_number, customer_phone")
      .eq("id", orderId)
      .single();

    if (fetchError || !data) {
      return NextResponse.json({ error: "Order not found" }, { status: 404 });
    }

    const order = data as Pick<OrderRow, "status" | "order_number" | "customer_phone">;
    const allowed = VALID_TRANSITIONS[order.status] ?? [];

    if (!allowed.includes(newStatus)) {
      return NextResponse.json(
        { error: `Cannot transition from ${order.status} to ${newStatus}` },
        { status: 422 }
      );
    }

    const { error: updateError } = await supabase
      .from("orders")
      .update({ status: newStatus })
      .eq("id", orderId);

    if (updateError) {
      return NextResponse.json({ error: "Update failed" }, { status: 500 });
    }

    // Fire the right push for each transition. All fire-and-forget so
    // a failed push never fails the status update. Native push goes
    // through templates.ts (member-scoped tokens); web push is only
    // wired for `ready` since that's the highest-stakes moment for
    // the PWA flow.
    const orderNum = order.order_number;
    const phone    = order.customer_phone ?? null;

    if (newStatus === "preparing" && order.status !== "preparing") {
      notifyOrderPreparing({ orderId, orderNumber: orderNum, customerPhone: phone })
        .catch((e) => console.warn("[push] order_preparing", e));
    } else if (newStatus === "ready") {
      notifyOrderReady({ orderId, orderNumber: orderNum, customerPhone: phone })
        .catch((e) => console.warn("[push] order_ready", e));
      sendOrderReadyWebPush(orderId, orderNum);
    } else if (newStatus === "completed") {
      notifyOrderCompleted({ orderId, orderNumber: orderNum, customerPhone: phone })
        .catch((e) => console.warn("[push] order_completed", e));
    } else if (newStatus === "failed") {
      notifyOrderCancelled({
        orderId,
        orderNumber: orderNum,
        customerPhone: phone,
        refundExpected: order.status === "paid" || order.status === "preparing",
      }).catch((e) => console.warn("[push] order_cancelled", e));
    }

    return NextResponse.json({ ok: true, status: newStatus });
  } catch (err) {
    console.error("Status update error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
