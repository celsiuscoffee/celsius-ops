import { NextRequest, NextResponse } from "next/server";
import webpush from "web-push";
import { getSupabaseAdmin } from "@/lib/supabase/server";
import type { OrderRow, OrderStatus } from "@/lib/supabase/types";

const VALID_TRANSITIONS: Record<string, OrderStatus[]> = {
  pending:   ["preparing"],  // cash orders or manual staff override
  paid:      ["preparing"],
  preparing: ["ready"],
  ready:     ["completed"],
};

function initVapid() {
  const pub  = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY;
  const priv = process.env.VAPID_PRIVATE_KEY;
  const email = process.env.VAPID_EMAIL ?? "mailto:hello@celsiuscoffee.com";
  if (pub && priv) {
    webpush.setVapidDetails(email, pub, priv);
  }
}

async function sendReadyPush(orderId: string, orderNumber: string) {
  try {
    initVapid();
    const supabase = getSupabaseAdmin();
    const { data: subs } = await supabase
      .from("push_subscriptions")
      .select("*")
      .eq("order_id", orderId);

    if (!subs?.length) return;

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
      subs.map((sub) =>
        webpush.sendNotification(
          { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } },
          payload
        )
      )
    );
  } catch (err) {
    console.warn("Push send failed:", err);
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
      .select("status, order_number")
      .eq("id", orderId)
      .single();

    if (fetchError || !data) {
      return NextResponse.json({ error: "Order not found" }, { status: 404 });
    }

    const order   = data as Pick<OrderRow, "status" | "order_number">;
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

    // Fire push notification when order becomes ready
    if (newStatus === "ready") {
      sendReadyPush(orderId, order.order_number); // fire-and-forget
    }

    return NextResponse.json({ ok: true, status: newStatus });
  } catch (err) {
    console.error("Status update error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
