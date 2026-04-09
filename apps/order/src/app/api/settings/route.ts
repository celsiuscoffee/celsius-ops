import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase/server";

// GET /api/settings?key=promo_banner
export async function GET(request: NextRequest) {
  const key = request.nextUrl.searchParams.get("key");
  if (!key) return NextResponse.json({ error: "Missing key" }, { status: 400 });

  const supabase = getSupabaseAdmin();
  const { data, error } = await supabase
    .from("app_settings")
    .select("value")
    .eq("key", key)
    .single();

  if (error || !data) return NextResponse.json(null);
  return NextResponse.json(data.value);
}

// PUT /api/settings — backoffice only (protected by middleware)
// Body: { key: string, value: unknown }
export async function PUT(request: NextRequest) {
  try {
    const { key, value } = await request.json();
    if (!key) return NextResponse.json({ error: "Missing key" }, { status: 400 });

    const supabase = getSupabaseAdmin();
    const { error } = await supabase
      .from("app_settings")
      .upsert({ key, value, updated_at: new Date().toISOString() }, { onConflict: "key" });

    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("Settings PUT error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
