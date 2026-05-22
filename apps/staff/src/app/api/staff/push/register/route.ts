import { NextRequest, NextResponse } from "next/server";
import { getUser } from "@/lib/auth";
import { supabaseAdmin as supabase } from "@/lib/supabase";

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  const session = await getUser(req.headers);
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  let body: {
    token?: string;
    platform?: string;
    appVersion?: string | null;
  };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid request" }, { status: 400 });
  }

  const { token, platform, appVersion } = body;
  if (!token || token.length < 10) {
    return NextResponse.json({ error: "token required" }, { status: 400 });
  }
  if (platform !== "ios" && platform !== "android" && platform !== "web") {
    return NextResponse.json({ error: "platform must be ios/android/web" }, { status: 400 });
  }

  const { error } = await supabase
    .from("hr_push_tokens")
    .upsert(
      {
        user_id: session.id,
        token,
        platform,
        app_version: appVersion ?? null,
        is_active: true,
        last_seen_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      },
      { onConflict: "token" },
    );

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ success: true });
}
