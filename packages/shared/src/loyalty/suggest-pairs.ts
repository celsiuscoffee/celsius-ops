import type { SupabaseClient } from "@supabase/supabase-js";
import { isPromoLiveNow } from "./promo-eligibility";

/**
 * The shared pairing "agent" — ONE engine behind both the in-store POS
 * "Pair with a Bite" (channel:"pos", customer display + register) and the
 * customer app's in-cart upsell (channel:"pickup"). Given what's in the cart,
 * it scores every other available product and returns the best `limit` to
 * suggest. One source of truth → the two surfaces never drift, and the nightly
 * weight tuner (app_settings.pair_weights) moves both at once.
 *
 * Scoring blends every signal, weighted:
 *   - combo/promo  → does adding it COMPLETE an active combo (real saving + AOV)
 *   - roundPromo   → is it featured in a promo the owner runs THIS day-part
 *   - co-purchase  → how often it's bought together with the cart (12mo baskets)
 *   - usual        → one of this member's regulars (personalisation)
 *   - round        → top seller for the current day-part round
 *   - complement   → drinks cart → prefer a bite (and vice-versa)
 */

const FOOD_CATEGORIES = new Set([
  "cakes", "cookies", "croissant", "fries", "nasi-lemak", "noodle", "pasta", "roti-bakar", "sandwiches",
]);

export type PairChannel = "pos" | "pickup";

type Weights = { combo: number; co: number; usual: number; round: number; complement: number; roundPromo: number };
const DEFAULT_WEIGHTS: Weights = { combo: 3.0, co: 2.0, usual: 1.5, round: 1.0, complement: 1.0, roundPromo: 2.0 };

// Canonical day-part bands — must match storehub-helpers ROUNDS (and the
// refresh_pos_pairing_signals() bucketing that writes pair_round_scores).
const ROUNDS: { key: string; startH: number; endH: number }[] = [
  { key: "breakfast", startH: 8, endH: 10 }, { key: "brunch", startH: 10, endH: 12 },
  { key: "lunch", startH: 12, endH: 15 }, { key: "midday", startH: 15, endH: 17 },
  { key: "evening", startH: 17, endH: 19 }, { key: "dinner", startH: 19, endH: 21 },
  { key: "supper", startH: 21, endH: 23 },
];
function currentRoundKey(): string | null {
  const h = (new Date().getUTCHours() + 8) % 24; // KL time (UTC+8)
  return ROUNDS.find((r) => h >= r.startH && h < r.endH)?.key ?? null;
}

type Product = { id: string; name: string; category: string | null; price_sen: number; image_url: string | null };

export type SuggestedPair = {
  product_id: string;
  name: string;
  price_sen: number;
  image_url: string | null;
  reason: string;
  discount_label: string | null;
  combo_id: string | null;
};

// Loosely-typed client so callers can pass either app's admin client.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Db = SupabaseClient<any, any, any>;

async function loadSetting<T>(supabase: Db, key: string): Promise<T | null> {
  const { data } = await supabase.from("app_settings").select("value").eq("key", key).maybeSingle();
  return ((data?.value as T) ?? null);
}

export async function suggestPairs(opts: {
  supabase: Db;
  cartProductIds: string[];
  usualProductIds?: string[];
  outletId?: string | null;
  channel?: PairChannel;
  brandId?: string;
  limit?: number;
}): Promise<{ pairs: SuggestedPair[]; round: string | null }> {
  const supabase = opts.supabase;
  const cartIds = (opts.cartProductIds ?? []).filter((x): x is string => typeof x === "string");
  const usualIds = new Set((opts.usualProductIds ?? []).filter((x): x is string => typeof x === "string"));
  const outletId = opts.outletId ?? null;
  const channel: PairChannel = opts.channel ?? "pos";
  const brandId = opts.brandId ?? "brand-celsius";
  const limit = Math.max(1, opts.limit ?? 3);

  // ── Candidate products: channel-visible, in stock, not already in the cart ──
  const [{ data: prodRows }, weightsCfg, roundCfg] = await Promise.all([
    supabase.from("products").select("id, name, category, price, image_url, visible_channels").eq("brand_id", brandId),
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
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- legacy untyped DB row (ratchet: reduce, never add)
  const products: Product[] = ((prodRows ?? []) as any[])
    .filter((p) => {
      const ch = (p.visible_channels ?? []) as string[];
      return ch.length === 0 || ch.includes(channel);
    })
    .map((p) => ({ id: p.id, name: p.name, category: p.category, price_sen: Math.round(Number(p.price ?? 0) * 100), image_url: p.image_url ?? null }));
  const byId = new Map(products.map((p) => [p.id, p]));

  // Cart "kind": drinks vs food → bias suggestions to the other.
  const cartFood = cartIds.filter((id) => FOOD_CATEGORIES.has(byId.get(id)?.category ?? "")).length;
  const cartDrink = cartIds.length - cartFood;
  const preferFood = cartDrink >= cartFood;
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

  // ── Combo signal: does adding the candidate COMPLETE an active combo? ──
  const { data: promoRows } = await supabase
    .from("promotions")
    .select("id, name, discount_type, discount_value, combo_price, override_price, combo_product_ids, combo_category_ids, applicable_products, applicable_categories, outlet_ids, is_active, valid_from, valid_until, day_of_week, time_start, time_end")
    .eq("brand_id", brandId)
    .eq("is_active", true);
  type Combo = { id: string; name: string; discount_type: string | null; discount_value: number | null; combo_price: number | null; override_price: number | null; prodIds: string[]; catIds: string[]; outletIds: string[] };
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- legacy untyped DB row (ratchet: reduce, never add)
  const combos: Combo[] = ((promoRows ?? []) as any[])
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
    let offer: PromoHit | null = null;
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
      const addsCat = candCatHit && !cartCats.has(candCat) && c.catIds.some((cat) => cat !== candCat && cartCats.has(cat));
      const addsProd = candProdHit && other.some((id) => c.prodIds.includes(id));
      if (addsCat || addsProd) return { savingsSen: savings, label, id: c.id, kind: "combo" };
      const singleTarget = c.catIds.length + c.prodIds.length <= 1 && c.combo_price == null;
      if (singleTarget && !offer) offer = { savingsSen: savings, label, id: c.id, kind: "offer" };
    }
    return offer;
  }

  const round = currentRoundKey();
  const roundScores = (round && roundCfg?.[round]) || {};
  const maxRound = Math.max(1, ...Object.values(roundScores));

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
    if (cartAllDrinks && !isFood && !promo) continue;
    if (cartAllFood && isFood && !promo) continue;
    const co = (coScore.get(p.id) ?? 0) / maxCo;
    const usual = usualIds.has(p.id) ? 1 : 0;
    const roundN = (roundScores[p.id] ?? 0) / maxRound;
    const complement = cartIds.length > 0 ? ((preferFood && isFood) || (!preferFood && !isFood) ? 1 : 0) : 0;
    const roundPromo = roundPromoCats.has(p.category ?? "") || roundPromoProds.has(p.id) ? 1 : 0;

    const score =
      weights.combo * (promo ? 1 : 0) +
      weights.roundPromo * roundPromo +
      weights.co * co +
      weights.usual * usual +
      weights.round * roundN +
      weights.complement * complement;
    if (score <= 0) continue;

    const reason = promo ? (promo.kind === "combo" ? "Combo deal" : "On offer")
      : roundPromo ? "Today's combo"
      : usual ? "Your usual" : co > 0 ? "Often paired together" : roundN > 0 ? "Popular right now" : "You might like";
    scored.push({ p, score, reason, discount_label: promo?.label, combo_id: promo?.id });
  }

  scored.sort((a, b) => b.score - a.score);
  // Spread the slots across distinct HOOKS (reason) AND categories so each is a
  // different reason to bite — never near-duplicates.
  const picked: Scored[] = [];
  const pickedCats = new Set<string>();
  const pickedReasons = new Set<string>();
  for (const s of scored) {
    if (picked.length >= limit) break;
    const cat = s.p.category ?? "";
    if (pickedCats.has(cat) || pickedReasons.has(s.reason)) continue;
    picked.push(s); pickedCats.add(cat); pickedReasons.add(s.reason);
  }
  for (const s of scored) {
    if (picked.length >= limit) break;
    const cat = s.p.category ?? "";
    if (picked.includes(s) || pickedCats.has(cat)) continue;
    picked.push(s); pickedCats.add(cat);
  }
  for (const s of scored) {
    if (picked.length >= limit) break;
    if (!picked.includes(s)) picked.push(s);
  }

  const pairs: SuggestedPair[] = picked.map((s) => ({
    product_id: s.p.id,
    name: s.p.name,
    price_sen: s.p.price_sen,
    image_url: s.p.image_url,
    reason: s.reason,
    discount_label: s.discount_label ?? null,
    combo_id: s.combo_id ?? null,
  }));

  return { pairs, round };
}
