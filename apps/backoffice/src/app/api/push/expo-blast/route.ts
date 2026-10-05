import { NextRequest, NextResponse } from "next/server";
import { requireAuth, hasModulePermission } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { getSupabaseAdmin } from "@/lib/pickup/supabase";

// POST /api/push/expo-blast
// Body: { title: string, body: string, data?: Record<string, string> }
// Sends an Expo push notification to every token in expo_push_tokens.
export async function POST(request: NextRequest) {
  const auth = await requireAuth(request);
  if (auth.error) return auth.error;
  if (!(await hasModulePermission(auth.user, "loyalty:campaigns", prisma))) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  try {
    const { title, body, data } = await request.json() as {
      title: string;
      body:  string;
      data?: Record<string, string>;
    };

    if (!title?.trim() || !body?.trim()) {
      return NextResponse.json({ error: "title and body are required" }, { status: 400 });
    }

    const supabase = getSupabaseAdmin();
    const { data: rows, error } = await supabase
      .from("expo_push_tokens")
      .select("token");

    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    if (!rows || rows.length === 0) {
      return NextResponse.json({ sent: 0, failed: 0, message: "No registered tokens" });
    }

    const tokens = rows
      .map((r) => r.token as string)
      .filter((t) => t?.startsWith("ExponentPushToken["));

    // Expo push API accepts up to 100 messages per request
    const CHUNK = 100;
    let sent = 0;
    let failed = 0;

    for (let i = 0; i < tokens.length; i += CHUNK) {
      const chunk = tokens.slice(i, i + CHUNK);
      const messages = chunk.map((to) => ({
        to,
        title,
        body,
        sound: "default",
        data:  data ?? {},
      }));

      try {
        const res = await fetch("https://exp.host/--/api/v2/push/send", {
          method:  "POST",
          headers: {
            "Content-Type":    "application/json",
            Accept:            "application/json",
            "Accept-Encoding": "gzip, deflate",
          },
          body: JSON.stringify(messages),
        });

        if (res.ok) {
          sent += chunk.length;
        } else {
          failed += chunk.length;
        }
      } catch {
        failed += chunk.length;
      }
    }

    return NextResponse.json({ sent, failed });
  } catch (err) {
    console.error("expo blast error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
