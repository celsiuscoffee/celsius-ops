// HTTP client for the loyalty app's promotion engine.
// Server-to-server only — used at checkout to evaluate the discount
// stack and to record promotion applications post-fulfillment.

import { getSupabaseAdmin } from "@/lib/supabase/server";

const LOYALTY_BASE = (process.env.LOYALTY_BASE_URL ?? "https://loyalty.celsiuscoffee.com").trim();
const BRAND_ID     = (process.env.LOYALTY_BRAND_ID  ?? "brand-celsius").trim();
const CRON_SECRET  = (process.env.CRON_SECRET ?? "").trim();

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
  // `promo_code` was a customer-entered string. We removed that entry
  // point everywhere (checkout UI + pickup lib). The discount engine
  // still picks up auto-promos, tier perks, and reward-linked
  // promotions on its own.
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

  let data: EvaluatedCart = empty;
  try {
    const res = await fetch(`${LOYALTY_BASE}/api/promotions/evaluate`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        // Server-to-server calls don't set Origin by default, but the
        // loyalty app's CSRF middleware enforces an Origin allowlist on
        // every POST and silently 403s without one — which is exactly
        // why tag-based discounts (Boss promo, etc.) silently dropped
        // out at checkout while the client preview kept showing them
        // (preview goes through /api/loyalty/promotions/evaluate which
        // already injects this header). celsiuscoffee.com is on the
        // loyalty CSRF allowlist.
        Origin: "https://celsiuscoffee.com",
      },
      body: JSON.stringify({ brand_id: BRAND_ID, ...input }),
    });
    if (res.ok) {
      data = (await res.json()) as EvaluatedCart;
    }
  } catch {
    data = empty;
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
  if (!CRON_SECRET) {
    console.warn(
      "[loyalty] recordPromotionApplications: CRON_SECRET unset, skipping"
    );
    return;
  }

  try {
    await fetch(`${LOYALTY_BASE}/api/promotions/apply`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        // Same CSRF allowlist applies — without an Origin header the
        // loyalty middleware 403s and the ledger never records the
        // promo application (so uses_count never bumps).
        Origin: "https://celsiuscoffee.com",
        Authorization: `Bearer ${CRON_SECRET}`,
      },
      body: JSON.stringify({
        brand_id: BRAND_ID,
        reference_id: args.reference_id,
        lines: args.lines,
        member_id: args.member_id,
        outlet_id: args.outlet_id,
        member_tier_id: args.member_tier_id,
        reward_promotion_ids: args.reward_promotion_ids,
      }),
    });
  } catch (err) {
    console.error("[loyalty] recordPromotionApplications:", err);
  }
}
