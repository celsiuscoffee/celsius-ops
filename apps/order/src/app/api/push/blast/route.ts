import { NextRequest, NextResponse } from "next/server";
import webpush from "web-push";
import { getSupabaseAdmin } from "@/lib/supabase/server";

function initVapid() {
  const pub   = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY;
  const priv  = process.env.VAPID_PRIVATE_KEY;
  const email = process.env.VAPID_EMAIL ?? "mailto:hello@celsiuscoffee.com";
  if (pub && priv) {
    webpush.setVapidDetails(email, pub, priv);
  }
}

// POST /api/push/blast
// Body: { title: string, body: string, url?: string }
// Sends a push notification to ALL subscriptions in push_subscriptions table
export async function POST(request: NextRequest) {
  try {
    initVapid();
    const { title, body, url } = await request.json();

    if (!title || !body) {
      return NextResponse.json({ error: "Missing title or body" }, { status: 400 });
    }

    const supabase = getSupabaseAdmin();

    // Fetch ALL subscriptions
    const { data: subs, error } = await supabase
      .from("push_subscriptions")
      .select("*");

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    if (!subs || subs.length === 0) {
      return NextResponse.json({ sent: 0, failed: 0, message: "No subscriptions found" });
    }

    const payload = JSON.stringify({
      title,
      body,
      icon:  "/icons/icon-192.png",
      badge: "/icons/badge-72.png",
      tag:   `blast-${Date.now()}`,
      requireInteraction: false,
      data:  { url: url ?? "/" },
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
    console.error("Push blast error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
