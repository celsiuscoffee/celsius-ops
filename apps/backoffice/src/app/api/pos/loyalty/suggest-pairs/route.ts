import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { isPromoLiveNow } from "@celsius/shared";

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

type Weights = { combo: number; co: number; usual: number; round: number; complement: number; roundPromo: number };
const DEFAULT_WEIGHTS: Weights = { combo: 3.0, co: 2.0, usual: 1.5, round: 1.0, complement: 1.0, roundPromo: 2.0 };

// Canonical day-part bands — must match storehub-helpers ROUNDS (and the
// refresh_pos_pairing_signals() bucketing that writes pair_round_scores), so
// the "current round" we look up is the same band the scores were keyed under.
const ROUNDS: { key: string; startH: number; endH: number }[] = [
  { key: "breakfast", startH: 8, endH: 10 }, { key: "brunch", startH: 10, endH: 12 },
  { key: "lunch", startH: 12, endH: 15 }, { key: "midday", startH: 15, endH: 17 },
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
    // When the cart is PURELY one kind, the suggestion must be the OTHER kind —
    // a drinks cart wants a BITE, not another coffee. This matters because the
    // co-purchase signal is dominated by drink+drink group orders (customers buy
    // 2–4 coffees together), so co_count for drink↔drink dwarfs drink↔food; left
    // unchecked the strongest signal keeps suggesting more drinks and the food
    // upsell never surfaces. Restricting the candidate pool lets co-purchase +
    // round popularity rank WHICH bite (e.g. Latte → Roti Bakar) instead.
    const cartAllDrinks = cartIds.length > 0 && cartFood === 0;
    const cartAllFood = cartIds.length > 0 && cartDrink === 0;

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
      .select("id, name, discount_type, discount_value, combo_price, override_price, combo_product_ids, combo_category_ids, applicable_products, applicable_categories, outlet_ids, is_active, valid_from, valid_until, day_of_week, time_start, time_end")
      .eq("brand_id", BRAND_ID)
      .eq("is_active", true);
    type Combo = { id: string; name: string; discount_type: string | null; discount_value: number | null; combo_price: number | null; override_price: number | null; prodIds: string[]; catIds: string[]; outletIds: string[] };
    const combos: Combo[] = ((promoRows ?? []) as any[])
      // Only combos that are LIVE right now — using the SAME canonical schedule
      // gate the rewards engine enforces (@celsius/shared isPromoLiveNow) so we
      // never badge "RM2 OFF" for a deal the engine won't apply (e.g. an 8–10am
      // combo shown at noon), which would leave the discount off the bill.
      .filter((p) => isPromoLiveNow(p))
      .map((p) => ({
        id: p.id, name: p.name, discount_type: p.discount_type, discount_value: p.discount_value,
        combo_price: p.combo_price, override_price: p.override_price,
        prodIds: [...(p.combo_product_ids ?? []), ...(p.applicable_products ?? [])] as string[],
        catIds: [...(p.combo_category_ids ?? []), ...(p.applicable_categories ?? [])] as string[],
        outletIds: (p.outlet_ids ?? []) as string[],
      }))
      .filter((c) => (c.prodIds.length > 0 || c.catIds.length > 0) && (c.outletIds.length === 0 || !outletId || c.outletIds.includes(outletId)));

    type PromoHit = { savingsSen: number; label: string; id: string; kind: "combo" | "offer" };
    function promoFor(candidate: Product): PromoHit | null {
      const candCat = candidate.category ?? "";
      const other = cartIds.filter((id) => id !== candidate.id);
      const cartCats = new Set(other.map((id) => byId.get(id)?.category).filter(Boolean) as string[]);
      let offer: PromoHit | null = null; // best standalone offer (combo wins if found)
      for (const c of combos) {
        const candCatHit = !!candCat && c.catIds.includes(candCat);
        const candProdHit = c.prodIds.includes(candidate.id);
        if (!candCatHit && !candProdHit) continue;
        const label = c.discount_type === "percentage_off" && c.discount_value ? `${c.discount_value}% OFF`
          : c.discount_type === "fixed_amount_off" && c.discount_value ? `RM${c.discount_value} OFF`
          : c.combo_price ? "COMBO PRICE" : "COMBO";
        const savings = c.discount_type === "fixed_amount_off" && c.discount_value ? Math.round(c.discount_value * 100)
          : c.discount_type === "percentage_off" && c.discount_value ? Math.round((candidate.price_sen * c.discount_value) / 100)
          : 0;
        // 1) Combo COMPLETION — the candidate fills a component the cart lacks
        //    while the cart covers a DIFFERENT one (a real basket + saving). So a
        //    "drink + roti bakar" combo suggests the roti bakar when the cart
        //    holds the drink — never another drink. Strongest; returns now.
        const addsCat = candCatHit && !cartCats.has(candCat) && c.catIds.some((cat) => cat !== candCat && cartCats.has(cat));
        const addsProd = candProdHit && other.some((id) => c.prodIds.includes(id));
        if (addsCat || addsProd) return { savingsSen: savings, label, id: c.id, kind: "combo" };
        // 2) Standalone OFFER — a single-target promo (one category/product) that
        //    discounts the candidate on its own, no second item required (e.g.
        //    "Mocktails 20% off"). Surface it as a deal even without a combo.
        const singleTarget = c.catIds.length + c.prodIds.length <= 1 && c.combo_price == null;
        if (singleTarget && !offer) offer = { savingsSen: savings, label, id: c.id, kind: "offer" };
      }
      return offer;
    }

    const round = currentRoundKey();
    const roundScores = (round && roundCfg?.[round]) || {};
    const maxRound = Math.max(1, ...Object.values(roundScores));

    // The owner's CURATED daypart pairings: every category/product featured in a
    // promotion that's live RIGHT NOW (combos[] is already time-filtered, so at
    // breakfast this is roti bakar / nasi lemak / sandwiches…). We boost these so
    // the round's promoted items LEAD the suggestions even before the combo is
    // completed — capitalising on the round-based promos.
    const roundPromoCats = new Set<string>();
    const roundPromoProds = new Set<string>();
    for (const c of combos) {
      for (const cat of c.catIds) roundPromoCats.add(cat);
      for (const pid of c.prodIds) roundPromoProds.add(pid);
    }

    // ── Score every candidate ──
    type Scored = { p: Product; score: number; reason: string; discount_label?: string; combo_id?: string };
    const scored: Scored[] = [];
    for (const p of products) {
      if (cartSet.has(p.id) || unavailable.has(p.id)) continue;
      const promo = promoFor(p);
      const isFood = FOOD_CATEGORIES.has(p.category ?? "");
      // Pure-kind cart → only suggest the complementary kind (a bite for a
      // drinks cart, a drink for a food cart). A live PROMO (combo-completer OR a
      // standalone offer) always stays eligible — a deal is a strong upsell
      // regardless of kind; the complement term below still nudges toward food.
      if (cartAllDrinks && !isFood && !promo) continue;
      if (cartAllFood && isFood && !promo) continue;
      const co = (coScore.get(p.id) ?? 0) / maxCo;
      const usual = usualIds.has(p.id) ? 1 : 0;
      const roundN = (roundScores[p.id] ?? 0) / maxRound;
      const complement = cartIds.length > 0 ? ((preferFood && isFood) || (!preferFood && !isFood) ? 1 : 0) : 0;
      // Featured in a promo the owner is running THIS round (even if the cart
      // hasn't completed the combo yet) → lead with it.
      const roundPromo = roundPromoCats.has(p.category ?? "") || roundPromoProds.has(p.id) ? 1 : 0;

      const score =
        weights.combo * (promo ? 1 : 0) +
        weights.roundPromo * roundPromo +
        weights.co * co +
        weights.usual * usual +
        weights.round * roundN +
        weights.complement * complement;
      if (score <= 0) continue;

      // Reason = the strongest contributing signal (for the on-card tag).
      const reason = promo ? (promo.kind === "combo" ? "Combo deal" : "On offer")
        : roundPromo ? "Today's combo"
        : usual ? "Your usual" : co > 0 ? "Often paired together" : roundN > 0 ? "Popular right now" : "You might like";
      scored.push({ p, score, reason, discount_label: promo?.label, combo_id: promo?.id });
    }

    scored.sort((a, b) => b.score - a.score);
    // Mix the combination for CONVERSION — the goal is that an add actually
    // happens, and three suggestions of the same type give the customer one hook,
    // not three. So spread the 3 slots across distinct HOOKS (reason) AND
    // categories: ideally a deal + a proven pairing + a popular pick, so each
    // slot is a different reason to bite — never three near-duplicates.
    const picked: Scored[] = [];
    const pickedCats = new Set<string>();
    const pickedReasons = new Set<string>();
    // Pass 1 — distinct reason AND category (the most varied, multi-angle pitch).
    for (const s of scored) {
      if (picked.length >= 3) break;
      const cat = s.p.category ?? "";
      if (pickedCats.has(cat) || pickedReasons.has(s.reason)) continue;
      picked.push(s); pickedCats.add(cat); pickedReasons.add(s.reason);
    }
    // Pass 2 — fill remaining slots with a fresh category.
    for (const s of scored) {
      if (picked.length >= 3) break;
      const cat = s.p.category ?? "";
      if (picked.includes(s) || pickedCats.has(cat)) continue;
      picked.push(s); pickedCats.add(cat);
    }
    // Pass 3 — top up by raw score if still short of 3.
    for (const s of scored) {
      if (picked.length >= 3) break;
      if (!picked.includes(s)) picked.push(s);
    }
    const pairs = picked.map((s) => ({
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
