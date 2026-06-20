/**
 * Promotion engine — the single source of truth for evaluating the
 * discount stack against a cart and recording promotion applications.
 *
 * Previously this lived in apps/loyalty/src/lib/promotions.ts and every
 * surface (POS register, pickup/order checkout) reached it over HTTP
 * (loyalty.celsiuscoffee.com/api/promotions/{evaluate,apply}). As part of
 * retiring the loyalty app it moved here so each app can run the exact
 * same maths in-process against the shared Supabase — no proxy hop.
 *
 * The only structural change vs the original is dependency injection: the
 * caller passes its own service-role SupabaseClient instead of the module
 * importing a hard-wired admin client. The discount maths is byte-for-byte
 * the same, including the per-instance 60s promo/tier caches.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { isPromoLiveNow } from "./promo-eligibility";

// Node's crypto.randomInt for ledger row ids — same as the original engine.
import { randomInt } from "crypto";

// ─── Types ─────────────────────────────────────────

export interface CartLine {
  product_id: string;
  category?: string;
  tags?: string[];
  quantity: number;
  unit_price: number; // RM, gross
}

export interface CartContext {
  brand_id: string;
  member_id?: string | null;
  outlet_id?: string | null;
  member_tier_id?: string | null;
  // Cohort tags pulled from members.tags (e.g. "staff", "boss"). Used by
  // promos with eligible_member_tags set — empty here means anonymous /
  // walk-in cart, so any tag-restricted promo is skipped.
  member_tags?: string[];
  promo_code?: string | null;
  // Reward redemptions resolved by the caller (issued_reward → promotion_id link).
  reward_promotion_ids?: string[];
  // Ordering channel: 'qr_table' (dine-in via table QR), 'pickup',
  // 'takeaway', or 'pos'. Null/unset → channel scope not applied (mirrors
  // the outlet_id behaviour). A promo with `channels` set only applies when
  // this channel is in its list.
  channel?: string | null;
  now?: Date;
}

export interface Promotion {
  id: string;
  brand_id: string;
  name: string;
  description: string | null;
  trigger_type: "auto" | "code" | "tier_perk" | "reward_link" | "first_order";
  promo_code: string | null;
  tier_id: string | null;
  discount_type:
    | "percentage_off"
    | "fixed_amount_off"
    | "free_item"
    | "bogo"
    | "combo_price"
    | "override_price";
  discount_value: number | null;
  max_discount_value: number | null;
  applicable_products: string[];
  applicable_categories: string[];
  applicable_tags: string[];
  // Cohort filter via members.tags (e.g. ["staff"], ["boss","vip"]).
  // Empty = open to all. ANDed with tier_id when both are set.
  eligible_member_tags: string[];
  outlet_ids: string[];
  // Channel scope (qr_table / pickup / takeaway / pos). Empty/null = all
  // channels — every existing promo keeps applying everywhere.
  channels: string[] | null;
  bogo_buy_qty: number | null;
  bogo_free_qty: number | null;
  free_product_ids: string[];
  free_product_name: string | null;
  combo_product_ids: string[];
  /** Category-level combo gate. When set, at least one cart line per
   *  category in this list must be present for the promo to trigger.
   *  Pairs with combo_product_ids — both can be set, both must be
   *  satisfied. Empty array (default) = no category gate. */
  combo_category_ids: string[];
  combo_price: number | null;
  override_price: number | null;
  min_order_value: number | null;
  valid_from: string | null;
  valid_until: string | null;
  day_of_week: number[];
  time_start: string | null;
  time_end: string | null;
  max_uses_total: number | null;
  max_uses_per_member: number | null;
  uses_count: number;
  stackable: boolean;
  is_active: boolean;
  priority: number;
}

export interface AppliedDiscount {
  promotion_id: string;
  promotion_name: string;
  discount_type: Promotion["discount_type"];
  discount_amount: number; // RM saved
  affected_lines: number[]; // indices into cart.lines
  reason: string;
}

export interface EvaluatedCart {
  subtotal: number;
  discounts: AppliedDiscount[];
  total_discount: number;
  total: number;
}

// ─── Active-promotion cache ─────────────────────────
//
// Per-brand 60s in-memory cache. Cuts ~100-200ms off every eval
// (DB query + supabase RTT). The cache lives in the function-instance
// memory; on Vercel each warm instance keeps its own copy. Cold
// starts go straight to the DB (no negative caching), so a deploy
// or scale-up just gets the freshest data.
//
// Invalidation: 60s TTL only. Admins toggling a promotion in
// backoffice see customer-side effect within a minute, which is
// well within the bounds of any reasonable rollout cadence.
type CacheEntry = { at: number; data: Promotion[] };
const promoCache = new Map<string, CacheEntry>();
const PROMO_CACHE_TTL_MS = 60_000;

async function getActivePromosForBrand(
  supabase: SupabaseClient,
  brandId: string,
): Promise<Promotion[] | null> {
  const cached = promoCache.get(brandId);
  if (cached && Date.now() - cached.at < PROMO_CACHE_TTL_MS) {
    return cached.data;
  }
  const { data, error } = await supabase
    .from("promotions")
    .select("*")
    .eq("brand_id", brandId)
    .eq("is_active", true)
    .order("priority", { ascending: false });
  if (error || !data) return null;
  const list = data as Promotion[];
  promoCache.set(brandId, { at: Date.now(), data: list });
  return list;
}

// Tier metadata cache — same 60s window as the promo cache. We only
// need the `stackable` flag for now (to implement "Black Card replaces
// all promos"), but the row is tiny so we cache the whole record for
// future tier-driven gates. Keyed by tier_id; misses fall through to
// the DB once per warm instance per minute.
type TierMeta = { id: string; stackable: boolean };
type TierCacheEntry = { at: number; data: TierMeta | null };
const tierCache = new Map<string, TierCacheEntry>();
const TIER_CACHE_TTL_MS = 60_000;

async function getTierMeta(
  supabase: SupabaseClient,
  tierId: string,
): Promise<TierMeta | null> {
  const cached = tierCache.get(tierId);
  if (cached && Date.now() - cached.at < TIER_CACHE_TTL_MS) {
    return cached.data;
  }
  const { data, error } = await supabase
    .from("tiers")
    .select("id, stackable")
    .eq("id", tierId)
    .maybeSingle();
  // Negative-cache misses too — keeps a customer with a stale tier_id
  // from hammering the DB on every eval. Fresh DB read every 60s.
  const meta: TierMeta | null =
    error || !data ? null : { id: data.id, stackable: data.stackable !== false };
  tierCache.set(tierId, { at: Date.now(), data: meta });
  return meta;
}

// ─── Eligibility ───────────────────────────────────

function isPromoEligible(
  promo: Promotion,
  ctx: CartContext,
  subtotal: number,
): { ok: true } | { ok: false; reason: string } {
  if (!promo.is_active) return { ok: false, reason: "inactive" };

  const now = ctx.now ?? new Date();

  // Date window / day-of-week / time-of-day schedule gate. This is the
  // canonical "is this promo live right now?" check, shared with the POS
  // pairing-suggestions endpoint via @celsius/shared `isPromoLiveNow`, so a
  // combo is never *suggested with a savings badge* at a time this engine
  // wouldn't actually honour it. (MYT/UTC+8 handling lives in that helper.)
  if (!isPromoLiveNow(promo, now)) return { ok: false, reason: "outside_schedule" };

  if (promo.outlet_ids.length > 0 && ctx.outlet_id && !promo.outlet_ids.includes(ctx.outlet_id)) {
    return { ok: false, reason: "outlet_not_eligible" };
  }

  // Channel scope — empty/null channels = all channels. When set, the order's
  // channel (qr_table / pickup / takeaway / pos) must be in the list.
  if (promo.channels && promo.channels.length > 0 && ctx.channel && !promo.channels.includes(ctx.channel)) {
    return { ok: false, reason: "channel_not_eligible" };
  }

  if (promo.min_order_value != null && subtotal < promo.min_order_value) {
    return { ok: false, reason: "below_min_order_value" };
  }

  if (promo.max_uses_total != null && promo.uses_count >= promo.max_uses_total) {
    return { ok: false, reason: "max_uses_total_reached" };
  }

  // Member-tag cohort gate (staff price, boss price, etc.). Empty list =
  // open to all. ANDed with tier_id when both are set.
  if (promo.eligible_member_tags.length > 0) {
    const memberTags = ctx.member_tags ?? [];
    if (!memberTags.some((t) => promo.eligible_member_tags.includes(t))) {
      return { ok: false, reason: "member_tag_not_eligible" };
    }
  }

  // Trigger-specific gates
  switch (promo.trigger_type) {
    case "tier_perk":
      if (!promo.tier_id) return { ok: false, reason: "tier_perk_missing_tier_id" };
      if (ctx.member_tier_id !== promo.tier_id) return { ok: false, reason: "wrong_tier" };
      break;
    case "code":
      if (!promo.promo_code) return { ok: false, reason: "code_promo_missing_code" };
      if (!ctx.promo_code || ctx.promo_code.toUpperCase() !== promo.promo_code.toUpperCase()) {
        return { ok: false, reason: "wrong_code" };
      }
      break;
    case "reward_link":
      if (!ctx.reward_promotion_ids?.includes(promo.id)) {
        return { ok: false, reason: "reward_not_redeemed" };
      }
      break;
    case "auto":
      // No extra gate
      break;
  }

  return { ok: true };
}

// ─── Discount maths ────────────────────────────────

function lineMatches(line: CartLine, promo: Promotion): boolean {
  // Untargeted promos apply to whole cart
  if (
    promo.applicable_products.length === 0 &&
    promo.applicable_categories.length === 0 &&
    promo.applicable_tags.length === 0
  ) {
    return true;
  }
  if (promo.applicable_products.includes(line.product_id)) return true;
  if (line.category && promo.applicable_categories.includes(line.category)) return true;
  if (line.tags && line.tags.some((t) => promo.applicable_tags.includes(t))) return true;
  return false;
}

function computeDiscount(promo: Promotion, lines: CartLine[]): { amount: number; affected: number[] } {
  // ── Combo gate ─────────────────────────────────────
  // A promo carries a combo gate when EITHER combo_product_ids or
  // combo_category_ids is non-empty. The gate is independent of the
  // discount_type — admins can attach "RM2 off" or "RM18 bundle" or
  // anything to the same gate.
  //
  // Product gate: every id in combo_product_ids must appear in the cart.
  // Category gate: every category in combo_category_ids must be matched
  //   by at least one cart line. ("any classic drink + any roti bakar".)
  // Both gates: BOTH must pass.
  const hasProductGate = promo.combo_product_ids.length > 0;
  const hasCategoryGate = promo.combo_category_ids.length > 0;
  const hasComboGate = hasProductGate || hasCategoryGate;

  if (hasComboGate) {
    if (hasProductGate) {
      const cartProductIds = new Set(lines.map((l) => l.product_id));
      const allPresent = promo.combo_product_ids.every((id) => cartProductIds.has(id));
      if (!allPresent) return { amount: 0, affected: [] };
    }
    if (hasCategoryGate) {
      const cartCategories = new Set(lines.map((l) => l.category).filter((c): c is string => !!c));
      const allPresent = promo.combo_category_ids.every((cat) => cartCategories.has(cat));
      if (!allPresent) return { amount: 0, affected: [] };
    }
  }

  // ── Affected subset + combo set count ──────────────
  // For combos, we expand each cart line into UNITS (quantity-aware),
  // then greedy-pair them into as many full combo sets as possible.
  // Each combo set picks the cheapest unconsumed unit per gate slot.
  //
  // Cart [Black, Cappuccino, HalfEggs, Roti+Curry] with gate
  // [classic, roti-bakar] forms TWO combo sets:
  //   Set 1: Black + HalfEggs        (cheapest classic + cheapest roti)
  //   Set 2: Cappuccino + Roti+Curry (next cheapest in each slot)
  // → discount fires twice → 2 × RM2 = RM4 off, not just RM2.
  //
  // Previously we picked one cheapest unit per slot total — the
  // bundle was conceptually "1 of each", regardless of how many of
  // each the customer ordered. Customers reasonably expect a combo
  // to fire once per pair they assembled.
  //
  // For non-combo promos, fall back to the existing lineMatches logic.
  const affected: number[] = [];
  let eligibleSubtotal = 0;
  let comboSetsFormed = 0;

  if (hasComboGate) {
    // Expand lines to units so quantity > 1 contributes correctly.
    type Unit = { lineIdx: number; price: number; productId: string; category?: string };
    const units: Unit[] = [];
    lines.forEach((l, idx) => {
      for (let q = 0; q < l.quantity; q++) {
        units.push({ lineIdx: idx, price: l.unit_price, productId: l.product_id, category: l.category });
      }
    });

    type Slot = { kind: "product" | "category"; key: string };
    const slots: Slot[] = [
      ...promo.combo_product_ids.map((id): Slot => ({ kind: "product", key: id })),
      ...promo.combo_category_ids.map((c): Slot => ({ kind: "category", key: c })),
    ];

    const consumed = new Set<number>();
    const affectedLineSet = new Set<number>();

    // Greedy: form combos until we can't satisfy every slot anymore.
    while (true) {
      const picks: number[] = [];
      let canForm = true;
      for (const slot of slots) {
        const candidates = units
          .map((u, i) => ({ u, i }))
          .filter(({ i, u }) =>
            !consumed.has(i) && !picks.includes(i) &&
            (slot.kind === "product" ? u.productId === slot.key : u.category === slot.key))
          .sort((a, b) => a.u.price - b.u.price);
        if (candidates.length === 0) { canForm = false; break; }
        picks.push(candidates[0].i);
      }
      if (!canForm) break;
      for (const i of picks) {
        consumed.add(i);
        eligibleSubtotal += units[i].price;
        affectedLineSet.add(units[i].lineIdx);
      }
      comboSetsFormed++;
    }

    for (const idx of affectedLineSet) affected.push(idx);
  } else {
    lines.forEach((line, idx) => {
      if (lineMatches(line, promo)) {
        affected.push(idx);
        eligibleSubtotal += line.unit_price * line.quantity;
      }
    });
  }

  if (affected.length === 0) return { amount: 0, affected: [] };

  let amount = 0;

  switch (promo.discount_type) {
    case "percentage_off": {
      const pct = (promo.discount_value ?? 0) / 100;
      amount = eligibleSubtotal * pct;
      // For combo gates the cap applies PER combo set, not once for
      // the whole eligibleSubtotal. e.g. "5% off, cap RM3" with 2
      // formed combos → RM3 cap × 2 = RM6 max. The non-combo path
      // keeps the original "one cap for the whole match".
      if (promo.max_discount_value != null) {
        const cap = hasComboGate
          ? promo.max_discount_value * Math.max(1, comboSetsFormed)
          : promo.max_discount_value;
        amount = Math.min(amount, cap);
      }
      break;
    }
    case "fixed_amount_off": {
      // Combo gate present → discount fires once per formed combo set.
      // Non-combo path → single discount applied to the eligible subset.
      if (hasComboGate) {
        amount = (promo.discount_value ?? 0) * comboSetsFormed;
        amount = Math.min(eligibleSubtotal, amount);
      } else {
        amount = Math.min(eligibleSubtotal, promo.discount_value ?? 0);
      }
      break;
    }
    case "free_item": {
      // Cheapest applicable line free
      const cheapest = affected.reduce(
        (min, i) => (lines[i].unit_price < lines[min].unit_price ? i : min),
        affected[0],
      );
      amount = lines[cheapest].unit_price; // one unit
      break;
    }
    case "bogo": {
      const buy = promo.bogo_buy_qty ?? 1;
      const free = promo.bogo_free_qty ?? 1;
      // Total qty across affected lines
      const totalQty = affected.reduce((sum, i) => sum + lines[i].quantity, 0);
      const sets = Math.floor(totalQty / (buy + free));
      // Free quantity comes from the cheapest unit price in affected set
      const minPrice = Math.min(...affected.map((i) => lines[i].unit_price));
      amount = sets * free * minPrice;
      break;
    }
    case "combo_price": {
      // Bundle sold at combo_price PER set. Two formed combos at
      // RM18 each → 2 × RM18 = RM36 charged for the bundle subset;
      // discount is the diff vs eligibleSubtotal.
      if (promo.combo_price != null) {
        const totalAtComboPrice = promo.combo_price * Math.max(1, comboSetsFormed);
        amount = Math.max(0, eligibleSubtotal - totalAtComboPrice);
      }
      break;
    }
    case "override_price": {
      // Each affected line sold at override_price per unit
      if (promo.override_price != null) {
        const overrideTotal = affected.reduce(
          (sum, i) => sum + (promo.override_price ?? 0) * lines[i].quantity,
          0,
        );
        amount = Math.max(0, eligibleSubtotal - overrideTotal);
      }
      break;
    }
  }

  // Round to 2 decimals
  amount = Math.round(amount * 100) / 100;
  return { amount, affected };
}

// ─── Public: evaluate ──────────────────────────────

export async function evaluateCart(
  supabase: SupabaseClient,
  lines: CartLine[],
  ctx: CartContext,
): Promise<EvaluatedCart> {
  const subtotal = lines.reduce((sum, l) => sum + l.unit_price * l.quantity, 0);

  // 60s in-memory cache of active promos per brand. The promo list
  // is small (<50 rows) and changes infrequently, but the DB query
  // adds 100-200ms to every eval. With cold-start latency that's
  // a real bite of the checkout response time. 60s window means a
  // newly-activated promo in backoffice appears in customer flows
  // within a minute, which is the right trade-off for an F&B app.
  const promos = await getActivePromosForBrand(supabase, ctx.brand_id);
  if (!promos) {
    return { subtotal, discounts: [], total_discount: 0, total: subtotal };
  }

  // "Tier replaces all" — when the member is on a tier marked
  // stackable=false (Black Card / Staff today), the tier's own perks
  // are the *only* discounts that apply to the cart. No combos, no
  // sales, no first-order, no codes, no reward redemptions. Mirrors a
  // private-pricing concept: the tier is itself the customer's deal,
  // and the rest of the storefront promos shouldn't compound on it.
  //
  // Implementation is a filter on the candidate pool, kept outside the
  // per-promo eligibility loop so the rule is easy to reason about and
  // cheap to short-circuit: one tier lookup, then a `.filter`.
  // first_order promos are owned by apps/order's dedicated first-order path
  // (initiate/orders/quote), which does the proper "first order on this phone"
  // + channel checks. Exclude them here so the discount isn't applied twice
  // (engine + that path) and never applies without a first-order gate.
  let candidatePromos: Promotion[] = promos.filter((p) => p.trigger_type !== "first_order");
  if (ctx.member_tier_id) {
    const tier = await getTierMeta(supabase, ctx.member_tier_id);
    if (tier && tier.stackable === false) {
      candidatePromos = promos.filter(
        (p) => p.trigger_type === "tier_perk" && p.tier_id === ctx.member_tier_id,
      );
    }
  }

  // Per-member usage counters (only if member is signed in and any promo has per-member limit)
  const memberUsageById = new Map<string, number>();
  if (ctx.member_id) {
    const limited = candidatePromos.filter((p: Promotion) => p.max_uses_per_member != null);
    if (limited.length > 0) {
      const { data: usage } = await supabase
        .from("promotion_applications")
        .select("promotion_id")
        .eq("member_id", ctx.member_id)
        .in("promotion_id", limited.map((p: Promotion) => p.id));
      for (const u of usage ?? []) {
        memberUsageById.set(u.promotion_id, (memberUsageById.get(u.promotion_id) ?? 0) + 1);
      }
    }
  }

  const applied: AppliedDiscount[] = [];

  // Two-pass evaluation:
  //   1. Compute discount for every eligible promo (stackable + non-stackable).
  //   2. Apply ALL stackable ones, plus the SINGLE best non-stackable.
  //
  // Previously this loop ran in priority order and the first non-stackable
  // it saw won — meaning a customer who's both Elite (10% off, priority 20)
  // and Boss-tagged (50% off, priority 0) only ever got the 10%, because
  // Elite came first and blocked Boss. With this rewrite, the customer
  // gets the bigger of the two automatically. priority now only matters as
  // a tiebreaker when two non-stackables yield identical discounts.
  type Candidate = {
    promo: Promotion;
    amount: number;
    affected: number[];
  };
  const stackable: Candidate[] = [];
  const nonStackable: Candidate[] = [];

  for (const p of candidatePromos as Promotion[]) {
    const elig = isPromoEligible(p, ctx, subtotal);
    if (!elig.ok) continue;

    if (p.max_uses_per_member != null && ctx.member_id) {
      const used = memberUsageById.get(p.id) ?? 0;
      if (used >= p.max_uses_per_member) continue;
    }

    const { amount, affected } = computeDiscount(p, lines);
    if (amount <= 0) continue;

    (p.stackable ? stackable : nonStackable).push({ promo: p, amount, affected });
  }

  // Pick the single best non-stackable. Tiebreaker: higher priority wins;
  // if priority is also tied, the first one encountered (DB order) wins.
  const bestNonStackable = nonStackable.reduce<Candidate | null>((best, cur) => {
    if (!best) return cur;
    if (cur.amount > best.amount) return cur;
    if (cur.amount === best.amount && cur.promo.priority > best.promo.priority) return cur;
    return best;
  }, null);

  const winners = bestNonStackable ? [...stackable, bestNonStackable] : stackable;

  for (const c of winners) {
    applied.push({
      promotion_id: c.promo.id,
      promotion_name: c.promo.name,
      discount_type: c.promo.discount_type,
      discount_amount: c.amount,
      affected_lines: c.affected,
      reason: c.promo.trigger_type,
    });
  }

  const totalDiscount = applied.reduce((s, d) => s + d.discount_amount, 0);
  return {
    subtotal,
    discounts: applied,
    total_discount: Math.round(totalDiscount * 100) / 100,
    total: Math.max(0, Math.round((subtotal - totalDiscount) * 100) / 100),
  };
}

// ─── Public: apply (record usage in ledger) ────────

export async function recordApplications(
  supabase: SupabaseClient,
  args: {
    evaluated: EvaluatedCart;
    brand_id: string;
    member_id?: string | null;
    outlet_id?: string | null;
    reference_id: string;
  },
): Promise<void> {
  const { evaluated, brand_id, member_id, outlet_id, reference_id } = args;
  if (evaluated.discounts.length === 0) return;

  const rows = evaluated.discounts.map((d) => ({
    id: `pa-${Date.now()}-${randomInt(1000, 9999)}`,
    promotion_id: d.promotion_id,
    member_id: member_id ?? null,
    brand_id,
    outlet_id: outlet_id ?? null,
    reference_id,
    discount_amount: d.discount_amount,
  }));

  await supabase.from("promotion_applications").insert(rows);

  // Bump uses_count atomically
  await Promise.all(
    evaluated.discounts.map((d) =>
      supabase.rpc("increment_promotion_uses", { p_id: d.promotion_id }),
    ),
  );
}
