import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase/server";

// POST /api/push/subscribe
// Body: { subscription: PushSubscription, orderId?: string }
export async function POST(request: NextRequest) {
  try {
    const { subscription, orderId } = await request.json();

    if (!subscription?.endpoint || !subscription?.keys?.p256dh || !subscription?.keys?.auth) {
      return NextResponse.json({ error: "Invalid subscription object" }, { status: 400 });
    }

    const supabase = getSupabaseAdmin();

    // Upsert — endpoint is unique key
    const { error } = await supabase
      .from("push_subscriptions")
      .upsert({
        endpoint: subscription.endpoint,
        p256dh:   subscription.keys.p256dh,
        auth:     subscription.keys.auth,
        order_id: orderId ?? null,
      }, { onConflict: "endpoint" });

    if (error) {
      console.error("Push subscribe error:", error);
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("Push subscribe error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
