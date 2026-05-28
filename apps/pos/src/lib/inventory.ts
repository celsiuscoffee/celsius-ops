import { createClient, type SupabaseClient } from "@supabase/supabase-js";

/**
 * BOM-based inventory depletion / restoration for POS orders.
 *
 * A catalog product's recipe (public.product_recipes) lists the inventory
 * ingredients (public."Product") it consumes per unit sold. Selling deducts
 * those ingredients from StockBalance; refunds and voids add them back.
 *
 * Outlet mapping: pos_orders.outlet_id carries the *loyalty* outlet id
 * (e.g. "outlet-con"), whereas StockBalance.outletId is the inventory
 * Outlet.id (a uuid). We bridge via "Outlet".loyaltyOutletId.
 *
 * All writes are clamped at zero and best-effort: a stock hiccup must never
 * break a sale or a refund that already landed in the books.
 */

// Service-role required: product_recipes + StockBalance are RLS-locked and
// have no anon policy, so the anon fallback would silently no-op.
const supabase: SupabaseClient = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
);

export interface RecipeLine {
  productId: string;
  qty: number;
}

export interface ApplyResult {
  ok: boolean;
  reason?: string;
  ingredientsAffected: number;
}

export async function applyRecipeStock(opts: {
  outletRef: string;
  lines: RecipeLine[];
  direction: "deplete" | "restore";
}): Promise<ApplyResult> {
  const { outletRef, lines, direction } = opts;
  const sign = direction === "deplete" ? -1 : 1;

  const cleanLines = lines.filter(
    (l) => l.productId && Number.isFinite(l.qty) && l.qty > 0,
  );
  if (cleanLines.length === 0) return { ok: true, ingredientsAffected: 0 };

  // 1. Resolve the inventory outlet id.
  const outletId = await resolveOutletId(outletRef);
  if (!outletId) {
    console.warn("[inventory] no inventory outlet for", outletRef, "— skipping");
    return { ok: false, reason: "outlet_unmapped", ingredientsAffected: 0 };
  }

  // 2. Load recipes for the sold products.
  const productIds = [...new Set(cleanLines.map((l) => l.productId))];
  const { data: recipes, error: recErr } = await supabase
    .from("product_recipes")
    .select("product_id, ingredient_id, quantity_used")
    .in("product_id", productIds);
  if (recErr) {
    console.warn("[inventory] recipe load failed:", recErr.message);
    return { ok: false, reason: "recipe_load_failed", ingredientsAffected: 0 };
  }
  if (!recipes || recipes.length === 0) {
    return { ok: true, ingredientsAffected: 0 };
  }

  // 3. Aggregate the signed delta per ingredient.
  const qtyByProduct = new Map<string, number>();
  for (const l of cleanLines) {
    qtyByProduct.set(l.productId, (qtyByProduct.get(l.productId) ?? 0) + l.qty);
  }
  const deltaByIngredient = new Map<string, number>();
  for (const r of recipes) {
    const soldQty = qtyByProduct.get(r.product_id as string) ?? 0;
    if (soldQty <= 0) continue;
    const used = Number(r.quantity_used) * soldQty * sign;
    const key = r.ingredient_id as string;
    deltaByIngredient.set(key, (deltaByIngredient.get(key) ?? 0) + used);
  }

  // 4. Apply to the base StockBalance rows (productPackageId IS NULL).
  let affected = 0;
  for (const [ingredientId, delta] of deltaByIngredient) {
    if (delta === 0) continue;
    try {
      await adjustBalance(outletId, ingredientId, delta);
      affected++;
    } catch (e) {
      console.warn("[inventory] adjust failed for", ingredientId, e);
    }
  }
  return { ok: true, ingredientsAffected: affected };
}

async function resolveOutletId(ref: string): Promise<string | null> {
  // pos_orders.outlet_id is normally the loyalty outlet id.
  const { data: byLoy } = await supabase
    .from("Outlet")
    .select("id")
    .eq("loyaltyOutletId", ref)
    .limit(1)
    .maybeSingle();
  if (byLoy?.id) return byLoy.id as string;

  // Fall back to treating it as an inventory Outlet.id directly.
  const { data: byId } = await supabase
    .from("Outlet")
    .select("id")
    .eq("id", ref)
    .limit(1)
    .maybeSingle();
  return (byId?.id as string) ?? null;
}

async function adjustBalance(
  outletId: string,
  productId: string,
  delta: number,
): Promise<void> {
  // Nulls are distinct in the unique index, so guard against duplicate base
  // rows by taking the most recently touched one.
  const { data: rows } = await supabase
    .from("StockBalance")
    .select("id, quantity")
    .eq("outletId", outletId)
    .eq("productId", productId)
    .is("productPackageId", null)
    .order("lastUpdated", { ascending: false })
    .limit(1);

  const existing = rows?.[0];
  const now = new Date().toISOString();

  if (existing) {
    const next = Math.max(0, Number(existing.quantity) + delta);
    await supabase
      .from("StockBalance")
      .update({ quantity: next, lastUpdated: now })
      .eq("id", existing.id as string);
    return;
  }

  // No base row yet. A deplete has nothing to take; only a restore seeds one.
  if (delta > 0) {
    await supabase.from("StockBalance").insert({
      id: `sb-${Date.now()}-${Math.floor(Math.random() * 9000 + 1000)}`,
      outletId,
      productId,
      productPackageId: null,
      quantity: Math.max(0, delta),
      lastUpdated: now,
    });
  }
}
