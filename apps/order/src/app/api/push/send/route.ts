import { NextRequest, NextResponse } from "next/server";
import webpush from "web-push";
import { getSupabaseAdmin } from "@/lib/supabase/server";

function initVapid() {
  const pub  = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY;
  const priv = process.env.VAPID_PRIVATE_KEY;
  const email = process.env.VAPID_EMAIL ?? "mailto:hello@celsiuscoffee.com";
  if (pub && priv) {
    webpush.setVapidDetails(email, pub, priv);
  }
}

// POST /api/push/send
// Body: { orderId: string, title: string, body: string }
// Called by the KDS (staff tablet) or webhook when order is ready
export async function POST(request: NextRequest) {
  try {
    initVapid();
    const { orderId, title, body, requireInteraction } = await request.json();

    if (!orderId) {
      return NextResponse.json({ error: "Missing orderId" }, { status: 400 });
    }

    const supabase = getSupabaseAdmin();

    // Get all subscriptions for this order
    const { data: subs, error } = await supabase
      .from("push_subscriptions")
      .select("*")
      .eq("order_id", orderId);

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    if (!subs || subs.length === 0) {
      return NextResponse.json({ sent: 0, message: "No subscriptions for this order" });
    }

    const payload = JSON.stringify({
      title: title ?? "🎉 Order Ready!",
      body:  body  ?? "Your Celsius Coffee order is ready for pickup!",
      icon:  "/icons/icon-192.png",
      badge: "/icons/badge-72.png",
      tag:   `order-${orderId}`,
      requireInteraction: requireInteraction ?? true,
      data:  { orderId },
    });

    const results = await Promise.allSettled(
      subs.map(async (sub) => {
        const pushSub = {
          endpoint: sub.endpoint,
          keys: { p256dh: sub.p256dh, auth: sub.auth },
        };
        await webpush.sendNotification(pushSub, payload);
      })
    );

    const sent   = results.filter((r) => r.status === "fulfilled").length;
    const failed = results.filter((r) => r.status === "rejected").length;

    return NextResponse.json({ sent, failed });
  } catch (err) {
    console.error("Push send error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
