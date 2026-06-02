import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

/**
 * POST /api/pos/loyalty/suggest-pairs
 * Body: { outlet_id?, cart_product_ids: string[], usual_product_ids?: string[] }
 *
 * The shared pairing "agent" for both POS screens — given what's in the cart,
 * it scores every other available product and returns the best 3 to suggest
 * ("pair with a bite"). The customer display shows them; the register mirrors
 * them so the cashier can add on request. One source of truth → identical
 * suggestions on both surfaces.
 *
 * Scoring blends every signal we have, weighted:
 *   - co-purchase  → how often this item is bought together with the cart
 *                    (Postgres get_co_purchased_products over 12mo of baskets)
 *   - combo/promo  → does adding it COMPLETE an active combo with the cart?
 *                    (strongest — it's a real saving + AOV bump; shows a badge)
 *   - usual        → is it one of this member's regulars? (personalisation)
 *   - round        → is it a top seller for the current day-part round?
 *                    (read from a nightly-refreshed cache; 0 until populated)
 *   - complement   → if the cart is all drinks, prefer food (and vice-versa)
 *
 * Weights live in app_settings.pair_weights (a nightly AI job tunes them per
 * outlet); defaults below are used until then. Round popularity lives in
 * app_settings.pair_round_scores, also refreshed nightly.
 */

const BRAND_ID = "brand-celsius";

// Food (bite) categories — everything else is treated as a drink. Used for the
// drink↔food complementarity term (pair a bite with a drink and vice-versa).
const FOOD_CATEGORIES = new Set([
  "cakes", "cookies", "croissant", "fries", "nasi-lemak", "noodle", "pasta", "roti-bakar", "sandwiches",
]);

type Weights = { combo: number; co: number; usual: number; round: number; complement: number };
const DEFAULT_WEIGHTS: Weights = { combo: 3.0, co: 2.0, usual: 1.5, round: 1.0, complement: 1.0 };

const ROUNDS: { key: string; startH: number; endH: number }[] = [
  { key: "breakfast", startH: 8, endH: 10 }, { key: "brunch", startH: 10, endH: 12 },
  { key: "lunch", startH: 12, endH: 14 }, { key: "midday", startH: 14, endH: 17 },
  { key: "evening", startH: 17, endH: 19 }, { key: "dinner", startH: 19, endH: 21 },
  { key: "supper", startH: 21, endH: 23 },
];
function currentRoundKey(): string | null {
  // KL time (UTC+8) so the round matches the floor, not the server clock.
  const h = (new Date().getUTCHours() + 8) % 24;
  return ROUNDS.find((r) => h >= r.startH && h < r.endH)?.key ?? null;
}

function getAdmin() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
  );
}
type Admin = ReturnType<typeof getAdmin>;

type Product = { id: string; name: string; category: string | null; price_sen: number; image_url: string | null };

async function loadSetting<T>(supabase: Admin, key: string): Promise<T | null> {
  const { data } = await supabase.from("app_settings").select("value").eq("key", key).maybeSingle();
  return (data?.value as T) ?? null;
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const cartIds: string[] = Array.isArray(body?.cart_product_ids) ? body.cart_product_ids : [];
    const usualIds: Set<string> = new Set(Array.isArray(body?.usual_product_ids) ? body.usual_product_ids : []);
    const outletId: string | null = body?.outlet_id ?? null;

    const supabase = getAdmin();

    // ── Candidate products: POS-visible, in stock, not already in the cart ──
    const [{ data: prodRows }, weightsCfg, roundCfg] = await Promise.all([
      supabase.from("products").select("id, name, category, price, image_url, visible_channels").eq("brand_id", BRAND_ID),
      loadSetting<Partial<Weights>>(supabase, "pair_weights"),
      loadSetting<Record<string, Record<string, number>>>(supabase, "pair_round_scores"),
    ]);
    const weights: Weights = { ...DEFAULT_WEIGHTS, ...(weightsCfg ?? {}) };

    // 86 overlay for this outlet.
    const unavailable = new Set<string>();
    if (outletId) {
      const { data: avail } = await supabase
        .from("outlet_product_availability")
        .select("product_id, is_available")
        .eq("outlet_id", outletId);
      for (const a of (avail ?? []) as { product_id: string; is_available: boolean }[]) {
        if (a.is_available === false) unavailable.add(a.product_id);
      }
    }

    const cartSet = new Set(cartIds);
    const products: Product[] = ((prodRows ?? []) as any[])
      .filter((p) => {
        const ch = (p.visible_channels ?? []) as string[];
        return ch.length === 0 || ch.includes("pos");
      })
      .map((p) => ({ id: p.id, name: p.name, category: p.category, price_sen: Math.round(Number(p.price ?? 0) * 100), image_url: p.image_url ?? null }));
    const byId = new Map(products.map((p) => [p.id, p]));

    // Cart "kind": drinks vs food majority → we bias suggestions to the other.
    const cartFood = cartIds.filter((id) => FOOD_CATEGORIES.has(byId.get(id)?.category ?? "")).length;
    const cartDrink = cartIds.length - cartFood;
    const preferFood = cartDrink >= cartFood; // cart leans drinks → suggest food

    // ── Co-purchase signal: aggregate co_count across every cart item ──
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

    // ── Combo signal: does adding the candidate COMPLETE an active combo with
    //    something already in the cart? Strong boost + a savings badge. ──
    const { data: promoRows } = await supabase
      .from("promotions")
      .select("id, name, discount_type, discount_value, combo_price, override_price, combo_product_ids, combo_category_ids, applicable_products, applicable_categories, outlet_ids, is_active")
      .eq("brand_id", BRAND_ID)
      .eq("is_active", true);
    type Combo = { id: string; name: string; discount_type: string | null; discount_value: number | null; combo_price: number | null; override_price: number | null; prodIds: string[]; catIds: string[]; outletIds: string[] };
    const combos: Combo[] = ((promoRows ?? []) as any[])
      .map((p) => ({
        id: p.id, name: p.name, discount_type: p.discount_type, discount_value: p.discount_value,
        combo_price: p.combo_price, override_price: p.override_price,
        prodIds: [...(p.combo_product_ids ?? []), ...(p.applicable_products ?? [])] as string[],
        catIds: [...(p.combo_category_ids ?? []), ...(p.applicable_categories ?? [])] as string[],
        outletIds: (p.outlet_ids ?? []) as string[],
      }))
      .filter((c) => (c.prodIds.length > 0 || c.catIds.length > 0) && (c.outletIds.length === 0 || !outletId || c.outletIds.includes(outletId)));

    function comboFor(candidate: Product): { savingsSen: number; label: string; id: string } | null {
      for (const c of combos) {
        const matches = (p?: Product) => !!p && (c.prodIds.includes(p.id) || (p.category != null && c.catIds.includes(p.category)));
        if (!matches(candidate)) continue;
        // Need at least one DIFFERENT cart item to also be part of this combo.
        const cartMatch = cartIds.some((id) => id !== candidate.id && matches(byId.get(id)));
        if (!cartMatch) continue;
        // Estimate the saving for the badge.
        let savings = 0;
        if (c.discount_type === "percentage_off" && c.discount_value) savings = Math.round((candidate.price_sen * c.discount_value) / 100);
        else if (c.discount_type === "fixed_amount_off" && c.discount_value) savings = Math.round(c.discount_value * 100);
        else if (c.combo_price) savings = Math.max(0, candidate.price_sen - Math.round(c.combo_price * 100) % candidate.price_sen);
        const label = c.discount_type === "percentage_off" && c.discount_value ? `${c.discount_value}% OFF`
          : c.discount_type === "fixed_amount_off" && c.discount_value ? `RM${c.discount_value} OFF`
          : "COMBO";
        return { savingsSen: savings, label, id: c.id };
      }
      return null;
    }

    const round = currentRoundKey();
    const roundScores = (round && roundCfg?.[round]) || {};
    const maxRound = Math.max(1, ...Object.values(roundScores));

    // ── Score every candidate ──
    type Scored = { p: Product; score: number; reason: string; discount_label?: string; combo_id?: string };
    const scored: Scored[] = [];
    for (const p of products) {
      if (cartSet.has(p.id) || unavailable.has(p.id)) continue;
      const co = (coScore.get(p.id) ?? 0) / maxCo;
      const combo = comboFor(p);
      const usual = usualIds.has(p.id) ? 1 : 0;
      const roundN = (roundScores[p.id] ?? 0) / maxRound;
      const isFood = FOOD_CATEGORIES.has(p.category ?? "");
      const complement = cartIds.length > 0 ? ((preferFood && isFood) || (!preferFood && !isFood) ? 1 : 0) : 0;

      const score =
        weights.combo * (combo ? 1 : 0) +
        weights.co * co +
        weights.usual * usual +
        weights.round * roundN +
        weights.complement * complement;
      if (score <= 0) continue;

      // Reason = the strongest contributing signal (for the on-card tag).
      const reason = combo ? "Combo deal" : usual ? "Your usual" : co > 0 ? "Often paired together" : roundN > 0 ? "Popular right now" : "You might like";
      scored.push({ p, score, reason, discount_label: combo?.label, combo_id: combo?.id });
    }

    scored.sort((a, b) => b.score - a.score);
    const pairs = scored.slice(0, 3).map((s) => ({
      product_id: s.p.id,
      name: s.p.name,
      price_sen: s.p.price_sen,
      image_url: s.p.image_url,
      reason: s.reason,
      discount_label: s.discount_label ?? null,
      combo_id: s.combo_id ?? null,
    }));

    return NextResponse.json({ pairs, round });
  } catch (err) {
    console.error("[pos/loyalty/suggest-pairs] error:", err);
    return NextResponse.json({ pairs: [], round: null });
  }
}
