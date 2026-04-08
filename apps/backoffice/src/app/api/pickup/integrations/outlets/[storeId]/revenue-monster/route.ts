import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/pickup/supabase";
import { requireRole } from "@/lib/auth";

// POST — save Revenue Monster credentials for an outlet
export async function POST(req: NextRequest, { params }: { params: Promise<{ storeId: string }> }) {
  try { await requireRole(req.headers, "ADMIN"); } catch { return NextResponse.json({ error: "Forbidden" }, { status: 403 }); }

  const { storeId } = await params;
  const { merchant_id, client_id, client_secret, private_key, is_production } = await req.json();

  const update: Record<string, unknown> = { updated_at: new Date().toISOString() };
  if (merchant_id !== undefined) update.rm_merchant_id = merchant_id;
  if (client_id !== undefined) update.rm_client_id = client_id;
  if (client_secret !== undefined) update.rm_client_secret = client_secret;
  if (private_key !== undefined) update.rm_private_key = private_key;
  if (is_production !== undefined) update.rm_is_production = is_production;

  const supabase = getSupabaseAdmin();
  const { error } = await supabase
    .from("outlet_settings")
    .update(update)
    .eq("store_id", storeId);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
