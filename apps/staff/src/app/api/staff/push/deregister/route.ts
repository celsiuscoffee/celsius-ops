import { NextRequest, NextResponse } from "next/server";
import { getUser } from "@/lib/auth";
import { supabaseAdmin as supabase } from "@/lib/supabase";

export const dynamic = "force-dynamic";

// Deregister doesn't require auth — sign-out should be able to wipe the
// token even if the session has just been cleared. Token uniqueness is
// enough: callers can only deactivate their own token (the value is
// device-scoped and not guessable).
export async function POST(req: NextRequest) {
  let body: { token?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid request" }, { status: 400 });
  }

  const { token } = body;
  if (!token) {
    return NextResponse.json({ error: "token required" }, { status: 400 });
  }

  await supabase
    .from("hr_push_tokens")
    .update({ is_active: false, updated_at: new Date().toISOString() })
    .eq("token", token);

  return NextResponse.json({ success: true });
}
