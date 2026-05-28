import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/pickup/supabase";
import { requireAuth } from "@/lib/auth";

// GET /api/pickup/ingredients
// Inventory ingredients used to build a catalog product's recipe (BOM).
// Reads the Prisma-managed "Product" master that lives in the same project
// as the catalog, so the recipe editor and the POS depletion engine resolve
// the same ingredient ids.
export async function GET(request: NextRequest) {
  const auth = await requireAuth(request);
  if (auth.error) return auth.error;

  const supabase = getSupabaseAdmin();
  const { data, error } = await supabase
    .from("Product")
    .select("id, name, sku, baseUom, itemType, isActive")
    .eq("isActive", true)
    .order("name");

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const ingredients = (data ?? []).map((p: Record<string, unknown>) => ({
    id: p.id as string,
    name: p.name as string,
    sku: (p.sku as string) ?? "",
    baseUom: (p.baseUom as string) ?? "",
    itemType: (p.itemType as string) ?? "INGREDIENT",
  }));

  return NextResponse.json({ ingredients });
}
