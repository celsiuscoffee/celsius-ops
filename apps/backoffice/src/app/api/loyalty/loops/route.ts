import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth";
import { supabaseAdmin } from "@/lib/loyalty/supabase";

// GET /api/loyalty/loops — list loop rounds (newest first) with their per-arm
// stats (populated once measured). Powers the backoffice loop dashboard.
export async function GET(request: NextRequest) {
  const auth = await requireAuth(request);
  if (auth.error) return auth.error;
  try {
    const { data, error } = await supabaseAdmin
      .from("loop_rounds")
      .select("*")
      .order("prepared_at", { ascending: false })
      .limit(50);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json(data ?? []);
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Failed to list rounds";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
