// HTTP client for the loyalty app's promotion engine.
// Server-to-server only — used at checkout to evaluate the discount
// stack and to record promotion applications post-fulfillment.

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
  promo_code?: string | null;
  reward_promotion_ids?: string[];
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

  try {
    const res = await fetch(`${LOYALTY_BASE}/api/promotions/evaluate`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ brand_id: BRAND_ID, ...input }),
    });
    if (!res.ok) return empty;
    const data = (await res.json()) as EvaluatedCart;
    return data;
  } catch {
    return empty;
  }
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
  promo_code?: string | null;
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
        Authorization: `Bearer ${CRON_SECRET}`,
      },
      body: JSON.stringify({
        brand_id: BRAND_ID,
        reference_id: args.reference_id,
        lines: args.lines,
        member_id: args.member_id,
        outlet_id: args.outlet_id,
        member_tier_id: args.member_tier_id,
        promo_code: args.promo_code,
        reward_promotion_ids: args.reward_promotion_ids,
      }),
    });
  } catch (err) {
    console.error("[loyalty] recordPromotionApplications:", err);
  }
}
