import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase/server";

export async function GET(req: NextRequest) {
  const supabase = getSupabaseAdmin();
  const store_id = req.nextUrl.searchParams.get("store_id");

  if (!store_id) return NextResponse.json({ error: "Missing store_id" }, { status: 400 });

  // Fetch stock levels with ingredient info
  const { data: levels, error } = await supabase
    .from("stock_levels")
    .select("*, ingredients(name, unit, par_level)")
    .eq("store_id", store_id);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  // Fetch outlet-specific PAR level overrides
  const { data: overrides } = await supabase
    .from("ingredient_outlet_settings")
    .select("ingredient_id, par_level")
    .eq("store_id", store_id);

  const overrideMap: Record<string, number> = {};
  for (const o of (overrides ?? [])) {
    overrideMap[o.ingredient_id] = o.par_level;
  }

  // Merge: use outlet-specific PAR if available, else fall back to ingredient default
  const result = (levels ?? []).map((lvl) => {
    const ing      = lvl.ingredients as { name: string; unit: string; par_level: number } | null;
    const par      = overrideMap[lvl.ingredient_id] ?? ing?.par_level ?? 0;
    const qty      = parseFloat(lvl.quantity) ?? 0;
    const status   = qty <= 0 ? "OUT" : qty < par ? "LOW" : "OK";
    return {
      ingredient_id: lvl.ingredient_id,
      store_id:      lvl.store_id,
      quantity:      qty,
      name:          ing?.name ?? "Unknown",
      unit:          ing?.unit ?? "",
      par_level:     par,
      status,
    };
  });

  return NextResponse.json(result);
}
