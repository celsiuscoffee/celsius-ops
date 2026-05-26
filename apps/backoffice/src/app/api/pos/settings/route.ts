import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/pickup/supabase";
import { requireAuth } from "@/lib/auth";

/**
 * POS branch settings — canonical owner is the main backoffice.
 *
 * GET  /api/pos/settings           → list all outlets + their settings
 * GET  /api/pos/settings?outlet_id → single outlet
 * PUT  /api/pos/settings           → upsert one (body must include outlet_id)
 *
 * The POS app reads the same pos_branch_settings rows via its own RLS-anon
 * client; this BO route is the authoritative editor.
 */

export async function GET(request: NextRequest) {
  const auth = await requireAuth(request);
  if (auth.error) return auth.error;

  const supabase = getSupabaseAdmin();
  const outletId = request.nextUrl.searchParams.get("outlet_id");

  if (outletId) {
    const { data, error } = await supabase
      .from("pos_branch_settings")
      .select("*")
      .eq("outlet_id", outletId)
      .maybeSingle();
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ settings: data });
  }

  const { data, error } = await supabase
    .from("pos_branch_settings")
    .select("*")
    .order("outlet_id");
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ settings: data ?? [] });
}

export async function PUT(request: NextRequest) {
  const auth = await requireAuth(request);
  if (auth.error) return auth.error;

  const body = await request.json();
  if (!body?.outlet_id) {
    return NextResponse.json({ error: "outlet_id required" }, { status: 400 });
  }

  const supabase = getSupabaseAdmin();
  // Allow only the columns we own — guards against accidental writes to
  // queue_counter / created_at, plus future-proofs against client typos.
  const allowed = [
    "service_charge_rate",
    "default_order_type",
    "checkout_option",
    "receipt_header",
    "receipt_footer",
    "receipt_show_logo",
    "receipt_qr_url",
    "receipt_qr_label",
    "receipt_promo_enabled",
    "receipt_promo_text",
    "ghl_merchant_id",
    "ghl_terminal_id",
    "grid_columns",
    "layout_mode",
    // Outlet-level tax + LHDN e-Invoice defaults (per-product can override).
    "default_tax_rate",
    "default_tax_inclusive",
    "einvoice_tin",
    "einvoice_brn",
    "einvoice_sst_no",
  ] as const;
  const updates: Record<string, unknown> = { outlet_id: body.outlet_id, updated_at: new Date().toISOString() };
  for (const k of allowed) if (k in body) updates[k] = body[k];

  const { data, error } = await supabase
    .from("pos_branch_settings")
    .upsert(updates, { onConflict: "outlet_id" })
    .select()
    .single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ settings: data });
}
