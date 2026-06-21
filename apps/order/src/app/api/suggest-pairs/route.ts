import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase/server";
import { getMenuData } from "@/lib/menu-data";
import { triedProductIds } from "@/lib/poster/select-home";

// POST /api/suggest-pairs  — in-cart upsell ("goes well with your order").
// Body: { cart_product_ids: string[], member?: string }
//
// Targeted by the BASKET, not a generic best-seller rail: scores every other
// available menu item by
//   • complement  — a drinks-only cart wants a bite (and vice-versa)
//   • co-purchase — what's actually bought together (get_co_purchased_products)
//   • untried     — items this member hasn't ordered (discovery → trial → AOV)
//   • price       — light nudge to the higher-ticket add-on
// and returns the best 3 (distinct categories). Reuses getMenuData so the
// candidates are exactly the pickup-available menu (cart-ready shape).

const FOOD_CATEGORIES = new Set([
  "cakes", "cookies", "croissant", "fries", "nasi-lemak", "noodle", "pasta", "roti-bakar", "sandwiches",
]);

export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => ({}));
    const cartIds: string[] = Array.isArray(body?.cart_product_ids)
      ? body.cart_product_ids.filter((x: unknown): x is string => typeof x === "string")
      : [];
    const memberId: string | null = typeof body?.member === "string" ? body.member : null;
    if (!cartIds.length) return NextResponse.json({ pairs: [] });

    const supabase = getSupabaseAdmin();
    const menu = await getMenuData();
    const catOf = new Map(menu.products.map((p) => [p.id, p.categoryId] as const));
    const isFood = (id: string | undefined | null) => !!id && FOOD_CATEGORIES.has(catOf.get(id) ?? "");

    // Cart kind → bias the suggestion to the complementary kind.
    const cartFood = cartIds.filter((id) => isFood(id)).length;
    const cartDrink = cartIds.length - cartFood;
    const preferFood = cartDrink >= cartFood;
    const cartAllDrinks = cartFood === 0;
    const cartAllFood = cartDrink === 0;

    // Co-purchase: how often each candidate is bought with the cart items.
    const coScore = new Map<string, number>();
    await Promise.all(
      cartIds.map(async (pid) => {
        const { data } = await supabase.rpc("get_co_purchased_products", { for_product_id: pid, limit_count: 20 });
        for (const row of (data ?? []) as { paired_with: string; co_count: number }[]) {
          coScore.set(row.paired_with, (coScore.get(row.paired_with) ?? 0) + Number(row.co_count ?? 0));
        }
      }),
    );
    const maxCo = Math.max(1, ...coScore.values());

    const tried = await triedProductIds(supabase, memberId);
    const cartSet = new Set(cartIds);
    const candidates = menu.products.filter((p) => p.isAvailable && !cartSet.has(p.id));
    const maxPrice = Math.max(1, ...candidates.map((p) => p.basePrice));

    type Scored = { p: (typeof candidates)[number]; score: number; reason: string };
    const scored: Scored[] = [];
    for (const p of candidates) {
      const food = isFood(p.id);
      // Pure-kind cart → only the complementary kind (drinks cart → a bite).
      if (cartAllDrinks && !food) continue;
      if (cartAllFood && food) continue;
      const co = (coScore.get(p.id) ?? 0) / maxCo;
      const complement = (preferFood && food) || (!preferFood && !food) ? 1 : 0;
      const untried = memberId && !tried.has(p.id) ? 1 : 0;
      const priceN = p.basePrice / maxPrice;
      const score = 2.0 * co + 1.2 * complement + 0.8 * untried + 0.6 * priceN;
      if (score <= 0) continue;
      const reason = co > 0 ? "Often paired together"
        : complement ? (food ? "Add a bite" : "Add a drink")
        : untried ? "Haven't tried this" : "You might like";
      scored.push({ p, score, reason });
    }
    scored.sort((a, b) => b.score - a.score);

    // Top 3, spread across distinct categories so it's not three near-dupes.
    const picked: Scored[] = [];
    const cats = new Set<string>();
    for (const s of scored) {
      if (picked.length >= 3) break;
      if (cats.has(s.p.categoryId)) continue;
      picked.push(s); cats.add(s.p.categoryId);
    }
    for (const s of scored) {
      if (picked.length >= 3) break;
      if (!picked.includes(s)) picked.push(s);
    }

    return NextResponse.json({
      pairs: picked.map((s) => ({
        id: s.p.id,
        name: s.p.name,
        basePrice: s.p.basePrice,
        image: s.p.image,
        reason: s.reason,
      })),
    });
  } catch (err) {
    console.error("[suggest-pairs] error:", err);
    return NextResponse.json({ pairs: [] }, { status: 200 });
  }
}
