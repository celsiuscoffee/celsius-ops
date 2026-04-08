import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/pickup/supabase";
import { requireRole } from "@/lib/auth";

// GET  — list outlet settings (Stripe, RM, Bukku fields)
// PATCH — toggle integration per outlet { storeId, field, value }
export async function GET(req: NextRequest) {
  try { await requireRole(req.headers, "ADMIN"); } catch { return NextResponse.json({ error: "Forbidden" }, { status: 403 }); }

  const supabase = getSupabaseAdmin();
  const { data, error } = await supabase
    .from("outlet_settings")
    .select("*")
    .order("store_id");

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  // Mask sensitive credential fields before returning
  function maskValue(val: string | null | undefined): string | null {
    if (!val) return null;
    if (val.length <= 8) return "\u2022\u2022\u2022\u2022\u2022\u2022\u2022\u2022";
    return val.slice(0, 4) + "\u2022".repeat(Math.min(val.length - 8, 16)) + val.slice(-4);
  }

  const masked = (data ?? []).map((o: Record<string, unknown>) => ({
    ...o,
    rm_client_secret: maskValue(o.rm_client_secret as string | null),
    rm_private_key: maskValue(o.rm_private_key as string | null),
    bukku_token: maskValue(o.bukku_token as string | null),
  }));
  return NextResponse.json(masked);
}

export async function PATCH(req: NextRequest) {
  try { await requireRole(req.headers, "ADMIN"); } catch { return NextResponse.json({ error: "Forbidden" }, { status: 403 }); }

  const { storeId, field, value } = await req.json();

  const allowed = ["rm_enabled", "bukku_enabled", "stripe_enabled"];
  if (!storeId || !allowed.includes(field)) {
    return NextResponse.json({ error: "Invalid params" }, { status: 400 });
  }

  const supabase = getSupabaseAdmin();
  const { error } = await supabase
    .from("outlet_settings")
    .update({ [field]: value, updated_at: new Date().toISOString() })
    .eq("store_id", storeId);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
