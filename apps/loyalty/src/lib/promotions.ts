import { supabaseAdmin } from '@/lib/supabase';
import { randomInt } from 'crypto';

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
  promo_code?: string | null;
  // Reward redemptions resolved by the caller (issued_reward → promotion_id link).
  reward_promotion_ids?: string[];
  now?: Date;
}

export interface Promotion {
  id: string;
  brand_id: string;
  name: string;
  description: string | null;
  trigger_type: 'auto' | 'code' | 'tier_perk' | 'reward_link';
  promo_code: string | null;
  tier_id: string | null;
  discount_type:
    | 'percentage_off'
    | 'fixed_amount_off'
    | 'free_item'
    | 'bogo'
    | 'combo_price'
    | 'override_price';
  discount_value: number | null;
  max_discount_value: number | null;
  applicable_products: string[];
  applicable_categories: string[];
  applicable_tags: string[];
  outlet_ids: string[];
  bogo_buy_qty: number | null;
  bogo_free_qty: number | null;
  free_product_ids: string[];
  free_product_name: string | null;
  combo_product_ids: string[];
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
  discount_type: Promotion['discount_type'];
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

// ─── Eligibility ───────────────────────────────────

function isPromoEligible(promo: Promotion, ctx: CartContext, subtotal: number): { ok: true } | { ok: false; reason: string } {
  if (!promo.is_active) return { ok: false, reason: 'inactive' };

  const now = ctx.now ?? new Date();

  if (promo.valid_from && new Date(promo.valid_from) > now) return { ok: false, reason: 'before_valid_from' };
  if (promo.valid_until && new Date(promo.valid_until) < now) return { ok: false, reason: 'after_valid_until' };

  if (promo.day_of_week.length > 0 && !promo.day_of_week.includes(now.getDay())) {
    return { ok: false, reason: 'wrong_day_of_week' };
  }

  if (promo.time_start && promo.time_end) {
    const hhmm = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}:00`;
    if (hhmm < promo.time_start || hhmm > promo.time_end) {
      return { ok: false, reason: 'outside_time_window' };
    }
  }

  if (promo.outlet_ids.length > 0 && ctx.outlet_id && !promo.outlet_ids.includes(ctx.outlet_id)) {
    return { ok: false, reason: 'outlet_not_eligible' };
  }

  if (promo.min_order_value != null && subtotal < promo.min_order_value) {
    return { ok: false, reason: 'below_min_order_value' };
  }

  if (promo.max_uses_total != null && promo.uses_count >= promo.max_uses_total) {
    return { ok: false, reason: 'max_uses_total_reached' };
  }

  // Trigger-specific gates
  switch (promo.trigger_type) {
    case 'tier_perk':
      if (!promo.tier_id) return { ok: false, reason: 'tier_perk_missing_tier_id' };
      if (ctx.member_tier_id !== promo.tier_id) return { ok: false, reason: 'wrong_tier' };
      break;
    case 'code':
      if (!promo.promo_code) return { ok: false, reason: 'code_promo_missing_code' };
      if (!ctx.promo_code || ctx.promo_code.toUpperCase() !== promo.promo_code.toUpperCase()) {
        return { ok: false, reason: 'wrong_code' };
      }
      break;
    case 'reward_link':
      if (!ctx.reward_promotion_ids?.includes(promo.id)) {
        return { ok: false, reason: 'reward_not_redeemed' };
      }
      break;
    case 'auto':
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
  const affected: number[] = [];
  let eligibleSubtotal = 0;

  lines.forEach((line, idx) => {
    if (lineMatches(line, promo)) {
      affected.push(idx);
      eligibleSubtotal += line.unit_price * line.quantity;
    }
  });

  if (affected.length === 0) return { amount: 0, affected: [] };

  let amount = 0;

  switch (promo.discount_type) {
    case 'percentage_off': {
      const pct = (promo.discount_value ?? 0) / 100;
      amount = eligibleSubtotal * pct;
      if (promo.max_discount_value != null) amount = Math.min(amount, promo.max_discount_value);
      break;
    }
    case 'fixed_amount_off': {
      amount = Math.min(eligibleSubtotal, promo.discount_value ?? 0);
      break;
    }
    case 'free_item': {
      // Cheapest applicable line free
      const cheapest = affected.reduce(
        (min, i) => (lines[i].unit_price < lines[min].unit_price ? i : min),
        affected[0]
      );
      amount = lines[cheapest].unit_price; // one unit
      break;
    }
    case 'bogo': {
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
    case 'combo_price': {
      // Whole affected subset is sold at combo_price (assumes one combo per call)
      if (promo.combo_price != null) {
        amount = Math.max(0, eligibleSubtotal - promo.combo_price);
      }
      break;
    }
    case 'override_price': {
      // Each affected line sold at override_price per unit
      if (promo.override_price != null) {
        const overrideTotal = affected.reduce(
          (sum, i) => sum + (promo.override_price ?? 0) * lines[i].quantity,
          0
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
  lines: CartLine[],
  ctx: CartContext
): Promise<EvaluatedCart> {
  const subtotal = lines.reduce((sum, l) => sum + l.unit_price * l.quantity, 0);

  // Pull every active promo for the brand
  const { data: promos, error } = await supabaseAdmin
    .from('promotions')
    .select('*')
    .eq('brand_id', ctx.brand_id)
    .eq('is_active', true)
    .order('priority', { ascending: false });

  if (error || !promos) {
    return { subtotal, discounts: [], total_discount: 0, total: subtotal };
  }

  // Per-member usage counters (only if member is signed in and any promo has per-member limit)
  const memberUsageById = new Map<string, number>();
  if (ctx.member_id) {
    const limited = promos.filter((p: Promotion) => p.max_uses_per_member != null);
    if (limited.length > 0) {
      const { data: usage } = await supabaseAdmin
        .from('promotion_applications')
        .select('promotion_id')
        .eq('member_id', ctx.member_id)
        .in('promotion_id', limited.map((p: Promotion) => p.id));
      for (const u of usage ?? []) {
        memberUsageById.set(u.promotion_id, (memberUsageById.get(u.promotion_id) ?? 0) + 1);
      }
    }
  }

  const applied: AppliedDiscount[] = [];
  let nonStackableTaken = false;

  for (const p of promos as Promotion[]) {
    const elig = isPromoEligible(p, ctx, subtotal);
    if (!elig.ok) continue;

    if (p.max_uses_per_member != null && ctx.member_id) {
      const used = memberUsageById.get(p.id) ?? 0;
      if (used >= p.max_uses_per_member) continue;
    }

    if (!p.stackable && nonStackableTaken) continue;

    const { amount, affected } = computeDiscount(p, lines);
    if (amount <= 0) continue;

    applied.push({
      promotion_id: p.id,
      promotion_name: p.name,
      discount_type: p.discount_type,
      discount_amount: amount,
      affected_lines: affected,
      reason: p.trigger_type,
    });

    if (!p.stackable) nonStackableTaken = true;
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

export async function recordApplications(args: {
  evaluated: EvaluatedCart;
  brand_id: string;
  member_id?: string | null;
  outlet_id?: string | null;
  reference_id: string;
}): Promise<void> {
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

  await supabaseAdmin.from('promotion_applications').insert(rows);

  // Bump uses_count atomically
  await Promise.all(
    evaluated.discounts.map((d) =>
      supabaseAdmin.rpc('increment_promotion_uses', { p_id: d.promotion_id })
    )
  );
}
