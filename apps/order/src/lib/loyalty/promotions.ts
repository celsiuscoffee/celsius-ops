// Checkout promotion engine. Evaluates the discount stack and records
// promotion applications post-fulfillment, running the shared promo engine
// (@celsius/shared) in-process against Supabase. The old proxy to the
// (retired) loyalty app has been removed.

import { getSupabaseAdmin } from "@/lib/supabase/server";
import {
  evaluateCart as evaluateCartShared,
  recordApplications as recordApplicationsShared,
  type CartContext as PromoCartContext,
} from "@celsius/shared/src/loyalty/promo-engine";

const BRAND_ID = (process.env.LOYALTY_BRAND_ID ?? "brand-celsius").trim();

/** Cohort tags (members.tags) for tag-gated promos like "staff price".
 *  Resolved server-side — never trusted from the client — mirroring the
 *  loyalty /api/promotions/evaluate route's own lookup. Empty on any miss. */
async function lookupMemberTags(memberId: string | null | undefined): Promise<string[]> {
  if (!memberId) return [];
  const supabase = getSupabaseAdmin();
  const { data } = await supabase
    .from("members")
    .select("tags")
    .eq("id", memberId)
    .single();
  return (data?.tags as string[] | null) ?? [];
}

export interface CartLine {
  product_id: string;
  category?: string;
  tags?: string[];
  quantity: number;
  unit_price: number; // RM, gross
}

export interface AppliedDiscount {
  promotion_id: string;
  promotion_name: string;
  discount_type: string;
  discount_amount: number; // RM saved
  affected_lines: number[];
  reason: string;
}

export interface EvaluatedCart {
  subtotal: number;
  discounts: AppliedDiscount[];
  total_discount: number;
  total: number;
}

interface EvaluateInput {
  lines: CartLine[];
  member_id?: string | null;
  outlet_id?: string | null;
  member_tier_id?: string | null;
  reward_promotion_ids?: string[];
  // Ordering channel ('qr_table' | 'pickup' | 'takeaway' | 'pos'). Passed
  // through to the loyalty evaluator so channel-scoped promos only apply on
  // their channel. Omitted = no channel filtering (back-compat).
  channel?: string | null;
  // `promo_code` was a customer-entered string. We removed that entry
  // point everywhere (checkout UI + pickup lib). The discount engine
  // still picks up auto-promos, tier perks, and reward-linked
  // promotions on its own.
}

/** Map an order's type to the promotion CHANNEL the loyalty evaluator
 *  filters on: dine_in = ordered via a table QR ("qr_table"); pickup and
 *  takeaway map to themselves; anything else falls back to pickup. */
export function channelForOrderType(
  orderType: string | null | undefined,
): "qr_table" | "pickup" | "takeaway" {
  if (orderType === "dine_in") return "qr_table";
  if (orderType === "takeaway") return "takeaway";
  return "pickup";
}

/**
 * Tier discount post-step. After the loyalty promo engine runs, layer
 * the member's tier % discount on top:
 *   - Stackable tier (Member / Silver / Gold / Platinum): tier % applies
 *     to the subtotal AFTER reward voucher discounts. Both discounts
 *     show in the line list so the customer sees what saved them what.
 *   - Non-stackable tier (Arba & Staff / Black Card): tier % REPLACES
 *     the reward voucher discount entirely. Whatever wallet voucher the
 *     customer reserved is dropped from the stack — invitation tiers
 *     trade voucher flexibility for a much higher flat discount.
 */
async function applyTierDiscount(
  evaluated: EvaluatedCart,
  memberTierId: string | null | undefined,
): Promise<EvaluatedCart> {
  if (!memberTierId) return evaluated;
  try {
    const supabase = getSupabaseAdmin();
    const { data: tier } = await supabase
      .from("tiers")
      .select("id, name, discount_percent, stackable, invitation_only")
      .eq("id", memberTierId)
      .maybeSingle();
    if (!tier) return evaluated;

    const pct = Number((tier.discount_percent as number | null) ?? 0);
    if (pct <= 0) return evaluated;

    const stackable = (tier.stackable as boolean | null) ?? true;
    const tierName  = (tier.name as string | null) ?? "Tier";

    if (!stackable) {
      // Invitation-tier rule: tier % applies on the raw subtotal, voucher
      // discounts are wiped out. The customer's reserved voucher is
      // effectively locked out at checkout — the order pipeline still
      // marks it unused in this scenario (we don't burn it).
      const amount = round2(evaluated.subtotal * (pct / 100));
      const tierDiscount: AppliedDiscount = {
        promotion_id:    `tier:${tier.id as string}`,
        promotion_name:  `${tierName} — ${pct}% off`,
        discount_type:   "percentage_off",
        discount_amount: amount,
        affected_lines:  [],
        reason:          "tier_perk",
      };
      return {
        subtotal:       evaluated.subtotal,
        discounts:      [tierDiscount],
        total_discount: amount,
        total:          round2(evaluated.subtotal - amount),
      };
    }

    // Stackable tier — apply % on whatever's left after reward discounts.
    const remaining  = Math.max(0, evaluated.subtotal - evaluated.total_discount);
    const amount     = round2(remaining * (pct / 100));
    if (amount <= 0) return evaluated;

    const tierDiscount: AppliedDiscount = {
      promotion_id:    `tier:${tier.id as string}`,
      promotion_name:  `${tierName} — ${pct}% off`,
      discount_type:   "percentage_off",
      discount_amount: amount,
      affected_lines:  [],
      reason:          "tier_perk",
    };
    return {
      subtotal:       evaluated.subtotal,
      discounts:      [...evaluated.discounts, tierDiscount],
      total_discount: round2(evaluated.total_discount + amount),
      total:          round2(evaluated.total - amount),
    };
  } catch {
    return evaluated;
  }
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

/**
 * Evaluate the promotion stack against a cart.
 * Returns subtotal/discounts/total in RM. Failure → no discount.
 */
export async function evaluatePromotions(
  input: EvaluateInput
): Promise<EvaluatedCart> {
  const subtotal = input.lines.reduce(
    (s, l) => s + l.unit_price * l.quantity,
    0
  );
  const empty: EvaluatedCart = {
    subtotal,
    discounts: [],
    total_discount: 0,
    total: subtotal,
  };

  // Run the shared promo engine in-process against Supabase. On any error,
  // degrade gracefully to no engine discount (empty) — the tier % post-step
  // still applies below.
  let data: EvaluatedCart = empty;
  try {
    const ctx: PromoCartContext = {
      brand_id: BRAND_ID,
      member_id: input.member_id ?? null,
      outlet_id: input.outlet_id ?? null,
      member_tier_id: input.member_tier_id ?? null,
      member_tags: await lookupMemberTags(input.member_id),
      reward_promotion_ids: input.reward_promotion_ids ?? [],
      channel: input.channel ?? null,
    };
    data = await evaluateCartShared(getSupabaseAdmin(), input.lines, ctx);
  } catch (err) {
    console.warn("[loyalty] promo eval failed; no engine discount applied:", err);
  }

  // Layer the tier % discount on top. Lookups against tiers.id are tiny
  // and only run once per cart evaluation.
  return applyTierDiscount(data, input.member_tier_id);
}

/**
 * Record promotion applications to the ledger and bump uses_count.
 * Fire-and-forget: order success isn't gated on this.
 */
export async function recordPromotionApplications(args: {
  evaluated: EvaluatedCart;
  member_id?: string | null;
  outlet_id?: string | null;
  reference_id: string;
  lines: CartLine[];
  member_tier_id?: string | null;
  reward_promotion_ids?: string[];
}): Promise<void> {
  if (args.evaluated.discounts.length === 0) return;

  // Re-evaluate the cart with the shared engine (engine-only, WITHOUT the
  // synthetic tier line, so only real promotions land in the ledger) and
  // record straight to Supabase. Fire-and-forget — order success isn't gated
  // on this, so a failure is logged and swallowed.
  try {
    const supabase = getSupabaseAdmin();
    const ctx: PromoCartContext = {
      brand_id: BRAND_ID,
      member_id: args.member_id ?? null,
      outlet_id: args.outlet_id ?? null,
      member_tier_id: args.member_tier_id ?? null,
      member_tags: await lookupMemberTags(args.member_id),
      reward_promotion_ids: args.reward_promotion_ids ?? [],
    };
    const reEvaluated = await evaluateCartShared(supabase, args.lines, ctx);
    await recordApplicationsShared(supabase, {
      evaluated: reEvaluated,
      brand_id: BRAND_ID,
      member_id: args.member_id ?? null,
      outlet_id: args.outlet_id ?? null,
      reference_id: args.reference_id,
    });
  } catch (err) {
    console.error("[loyalty] recordPromotionApplications:", err);
  }
}
