import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/pickup/supabase";
import { requireRole } from "@/lib/auth";

// GET  — list outlet settings (Stripe, RM, Bukku fields)
// PATCH — toggle integration per outlet { storeId, field, value }
export async function GET(req: NextRequest) {
  try { await requireRole(req.headers, "ADMIN"); } catch { return NextResponse.json({ error: "Forbidden" }, { status: 403 }); }

  const supabase = getSupabaseAdmin();

  // outlet_settings view no longer exposes rmClientSecret / rmPrivateKey /
  // bukkuToken (stripped after they were leaking via anon PostgREST). Fetch
  // the safe view fields, then join the secret-presence indicators from
  // Outlet via service role for the admin masking display.
  const [settingsRes, outletRes] = await Promise.all([
    supabase.from("outlet_settings").select("*").order("store_id"),
    supabase.from("Outlet").select("pickupStoreId, rmClientSecret, rmPrivateKey, bukkuToken"),
  ]);

  if (settingsRes.error) return NextResponse.json({ error: settingsRes.error.message }, { status: 500 });
  if (outletRes.error) return NextResponse.json({ error: outletRes.error.message }, { status: 500 });

  function maskValue(val: string | null | undefined): string | null {
    if (!val) return null;
    if (val.length <= 8) return "\u2022\u2022\u2022\u2022\u2022\u2022\u2022\u2022";
    return val.slice(0, 4) + "\u2022".repeat(Math.min(val.length - 8, 16)) + val.slice(-4);
  }

  type OutletSecrets = { pickupStoreId: string | null; rmClientSecret: string | null; rmPrivateKey: string | null; bukkuToken: string | null };
  const secretsByStore = new Map<string, OutletSecrets>();
  for (const row of (outletRes.data ?? []) as OutletSecrets[]) {
    if (row.pickupStoreId) secretsByStore.set(row.pickupStoreId, row);
  }

  const masked = (settingsRes.data ?? []).map((o: Record<string, unknown>) => {
    const secrets = secretsByStore.get(o.store_id as string);
    return {
      ...o,
      rm_client_secret: maskValue(secrets?.rmClientSecret),
      rm_private_key: maskValue(secrets?.rmPrivateKey),
      bukku_token: maskValue(secrets?.bukkuToken),
    };
  });
  return NextResponse.json(masked);
}

export async function PATCH(req: NextRequest) {
  try { await requireRole(req.headers, "ADMIN"); } catch { return NextResponse.json({ error: "Forbidden" }, { status: 403 }); }

  const { storeId, field, value } = await req.json();

  // is_open is the manual "outlet open/closed right now" toggle the
  // backoffice flips from /pickup/settings. /api/checkout/initiate
  // rejects orders when is_open is false, separate from is_active
  // (which is the administrative "outlet is part of the business at
  // all" flag — set once at outlet creation, not used as a toggle).
  const allowed = ["rm_enabled", "bukku_enabled", "stripe_enabled", "is_open"];
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
