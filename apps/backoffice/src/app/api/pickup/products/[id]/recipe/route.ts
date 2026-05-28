import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/pickup/supabase";
import { requireAuth } from "@/lib/auth";

// Catalog product recipe (BOM): which inventory ingredients a catalog
// product consumes per unit sold. Drives POS inventory depletion.

interface RecipeRowIn {
  ingredient_id: string;
  quantity_used: number;
  uom: string;
}

// GET /api/pickup/products/[id]/recipe
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const auth = await requireAuth(request);
  if (auth.error) return auth.error;
  const { id } = await params;

  const supabase = getSupabaseAdmin();
  const { data, error } = await supabase
    .from("product_recipes")
    .select("id, ingredient_id, quantity_used, uom")
    .eq("product_id", id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const rows = data ?? [];
  // Decorate with ingredient name/sku so the editor can render labels
  // without a second round-trip from the client.
  const ingredientIds = [...new Set(rows.map((r) => r.ingredient_id as string))];
  const nameById = new Map<string, { name: string; sku: string }>();
  if (ingredientIds.length > 0) {
    const { data: ings } = await supabase
      .from("Product")
      .select("id, name, sku")
      .in("id", ingredientIds);
    for (const ing of ings ?? []) {
      nameById.set(ing.id as string, {
        name: (ing.name as string) ?? "",
        sku: (ing.sku as string) ?? "",
      });
    }
  }

  const items = rows.map((r) => ({
    ingredient_id: r.ingredient_id as string,
    quantity_used: Number(r.quantity_used),
    uom: r.uom as string,
    ingredient_name: nameById.get(r.ingredient_id as string)?.name ?? "",
    ingredient_sku: nameById.get(r.ingredient_id as string)?.sku ?? "",
  }));

  return NextResponse.json({ items });
}

// PUT /api/pickup/products/[id]/recipe — replace the product's full recipe.
export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const auth = await requireAuth(request);
  if (auth.error) return auth.error;
  const { id } = await params;
  const body = (await request.json()) as { items?: RecipeRowIn[] };

  const incoming = Array.isArray(body.items) ? body.items : [];

  // Validate + dedupe by ingredient (last wins). Drop blank/zero rows so the
  // editor can leave an empty trailing row without persisting it.
  const byIngredient = new Map<string, RecipeRowIn>();
  for (const r of incoming) {
    if (!r || typeof r.ingredient_id !== "string" || r.ingredient_id.trim() === "") continue;
    const qty = Number(r.quantity_used);
    if (!Number.isFinite(qty) || qty <= 0) continue;
    byIngredient.set(r.ingredient_id, {
      ingredient_id: r.ingredient_id,
      quantity_used: qty,
      uom: typeof r.uom === "string" && r.uom.trim() !== "" ? r.uom.trim() : "unit",
    });
  }

  const supabase = getSupabaseAdmin();

  // Replace-all: clear existing rows, then insert the validated set.
  const { error: delErr } = await supabase
    .from("product_recipes")
    .delete()
    .eq("product_id", id);
  if (delErr) return NextResponse.json({ error: delErr.message }, { status: 500 });

  const rows = [...byIngredient.values()].map((r) => ({
    product_id: id,
    ingredient_id: r.ingredient_id,
    quantity_used: r.quantity_used,
    uom: r.uom,
  }));

  if (rows.length > 0) {
    const { error: insErr } = await supabase.from("product_recipes").insert(rows);
    if (insErr) return NextResponse.json({ error: insErr.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true, count: rows.length });
}
