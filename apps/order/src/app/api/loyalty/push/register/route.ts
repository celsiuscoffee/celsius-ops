import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase/server";

// POST /api/loyalty/push/register
// Body: { token, phone?, memberId?, platform?, appVersion? }
//
// Upserts an Expo push token so the order-status route can find every
// device a member has signed in on. Token is the unique key — re-installs
// on the same device generate a new token.
export async function POST(request: NextRequest) {
  try {
    const body = (await request.json()) as {
      token?:      string;
      phone?:      string;
      memberId?:   string;
      platform?:   string;
      appVersion?: string;
    };

    if (!body.token || !body.token.startsWith("ExponentPushToken[")) {
      return NextResponse.json({ error: "Invalid token" }, { status: 400 });
    }

    const supabase = getSupabaseAdmin();
    const { error } = await supabase
      .from("expo_push_tokens")
      .upsert(
        {
          token:        body.token,
          phone:        body.phone ?? null,
          member_id:    body.memberId ?? null,
          platform:     body.platform ?? null,
          app_version:  body.appVersion ?? null,
          last_seen_at: new Date().toISOString(),
        },
        { onConflict: "token" }
      );

    if (error) {
      console.error("expo push register error:", error);
      return NextResponse.json({ error: "Failed to register" }, { status: 500 });
    }

    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("push register route error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
