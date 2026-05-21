import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/pickup/supabase";
import { requireRole } from "@/lib/auth";

// Per-outlet menu availability — admin equivalent of the POS /oos screen.
// Reads (and writes) the same `outlet_product_availability` table the POS
// uses, so an admin override here is identical to a barista marking the
// item OOS at their counter.

// GET — list products + every existing override row.
export async function GET(req: NextRequest) {
  try { await requireRole(req.headers, "ADMIN"); } catch { return NextResponse.json({ error: "Forbidden" }, { status: 403 }); }

  const supabase = getSupabaseAdmin();
  const [productsRes, overridesRes] = await Promise.all([
    supabase
      .from("products")
      .select("id, name, category, is_available")
      .eq("brand_id", "brand-celsius")
      .order("category")
      .order("name"),
    supabase
      .from("outlet_product_availability")
      .select("outlet_id, product_id, is_available, reason, updated_at"),
  ]);

  if (productsRes.error)  return NextResponse.json({ error: productsRes.error.message  }, { status: 500 });
  if (overridesRes.error) return NextResponse.json({ error: overridesRes.error.message }, { status: 500 });

  return NextResponse.json({
    products:  productsRes.data  ?? [],
    overrides: overridesRes.data ?? [],
  });
}

// POST — upsert one (outlet_id, product_id) override. Body:
//   { outlet_id: string, product_id: string, is_available: boolean, reason?: string }
// Mirrors the POS /oos upsert exactly so admin and staff writes don't
// drift in shape.
export async function POST(req: NextRequest) {
  try { await requireRole(req.headers, "ADMIN"); } catch { return NextResponse.json({ error: "Forbidden" }, { status: 403 }); }

  const { outlet_id, product_id, is_available, reason } = await req.json();
  if (!outlet_id || !product_id || typeof is_available !== "boolean") {
    return NextResponse.json(
      { error: "outlet_id, product_id, is_available required" },
      { status: 400 },
    );
  }

  const supabase = getSupabaseAdmin();
  const { error } = await supabase
    .from("outlet_product_availability")
    .upsert(
      {
        outlet_id,
        product_id,
        is_available,
        reason: reason ?? null,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "outlet_id,product_id" },
    );

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
