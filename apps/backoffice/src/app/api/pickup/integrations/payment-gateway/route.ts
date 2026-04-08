import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/pickup/supabase";
import { requireRole } from "@/lib/auth";

// GET — list payment gateway config
export async function GET(req: NextRequest) {
  try { await requireRole(req.headers, "ADMIN"); } catch { return NextResponse.json({ error: "Forbidden" }, { status: 403 }); }

  const supabase = getSupabaseAdmin();
  const { data, error } = await supabase
    .from("payment_gateway_config")
    .select("*")
    .order("method_id");

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json(data ?? []);
}

// POST — upsert payment method config { method_id, enabled?, provider? }
export async function POST(req: NextRequest) {
  try { await requireRole(req.headers, "ADMIN"); } catch { return NextResponse.json({ error: "Forbidden" }, { status: 403 }); }

  const { method_id, enabled, provider } = await req.json();
  if (!method_id) return NextResponse.json({ error: "method_id required" }, { status: 400 });

  const update: Record<string, unknown> = { updated_at: new Date().toISOString() };
  if (enabled !== undefined) update.enabled = enabled;
  if (provider !== undefined) update.provider = provider;

  const supabase = getSupabaseAdmin();
  const { error } = await supabase
    .from("payment_gateway_config")
    .upsert({ method_id, ...update }, { onConflict: "method_id" });

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
