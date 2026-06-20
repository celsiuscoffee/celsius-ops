import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import {
  evaluateCart as evaluateCartShared,
  type CartContext as PromoCartContext,
} from "@celsius/shared/src/loyalty/promo-engine";

/**
 * POST /api/loyalty/evaluate-promotions
 *
 * Runs the shared promotion engine (@celsius/shared) in-process against
 * Supabase and then layers the member's tier % discount on top. Returns the
 * evaluated cart in a shape the register can fold into its existing
 * AppliedPromotion[] pipeline. (The old proxy to loyalty.celsiuscoffee.com
 * has been removed — the engine now runs locally.)
 *
 * Tier discounts are NOT computed by the engine — we layer them here so the
 * engine stays stateless re: tier perks.
 *
 * Request body (sen-free, matches the engine):
 *   {
 *     lines:        [{ product_id, category?, tags?, quantity, unit_price (RM) }],
 *     member_id?:   string,
 *     outlet_id?:   string,
 *     member_tier_id?: string,
 *     reward_promotion_ids?: string[],
 *     reward_discount_rm?: number,  // POS-side voucher (issued_rewards)
 *                                   // applied to cart; needed so the
 *                                   // stackable tier % computes against
 *                                   // the post-voucher remainder.
 *   }
 *
 * Response:
 *   {
 *     subtotal:        number (RM),
 *     total_discount:  number (RM),
 *     total:           number (RM),
 *     discounts: [{
 *       promotion_id, promotion_name, discount_type,
 *       discount_amount (RM), affected_lines, reason
 *     }],
 *   }
 */

const BRAND_ID = "brand-celsius";

interface AppliedDiscount {
  promotion_id: string;
  promotion_name: string;
  discount_type: string;
  discount_amount: number;
  affected_lines: number[];
  reason: string;
}

interface EvaluatedCart {
  subtotal: number;
  discounts: AppliedDiscount[];
  total_discount: number;
  total: number;
}

function getAdmin() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
  );
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

/** Phone variants for matching across columns that may store the
 *  number with or without `+60` / `0` prefixes. Mirrors the helper in
 *  loyalty-snapshot.ts. */
function phoneVariants(raw: string): string[] {
  const digits = raw.replace(/[^0-9]/g, "");
  const local = digits.startsWith("60") ? digits.slice(2) : digits.replace(/^0+/, "");
  return Array.from(
    new Set(
      [raw.trim(), digits, `+${digits}`, local, `0${local}`, `60${local}`, `+60${local}`].filter(
        Boolean,
      ),
    ),
  );
}

/**
 * Filter out the First Order Discount when the identified member has
 * any prior completed order (pos_orders OR pickup orders).
 *
 * The central promo engine's trigger_type switch (apps/loyalty/src/
 * lib/promotions.ts) has no case for 'first_order' — it falls through
 * and returns ok=true. It then relies on the `promotion_applications`
 * ledger via max_uses_per_member to enforce one-per-customer. Pickup
 * keeps the ledger fresh by POSTing to /api/promotions/apply at order
 * commit, but POS used to skip that call, so every member kept seeing
 * a 10% welcome discount on every visit. This filter is the
 * belt-and-braces fix: even if the ledger is wrong, actual order
 * history is the source of truth for whether this is their first time.
 */
async function dropFirstOrderIfReturning(
  evaluated: EvaluatedCart,
  memberId: string | null | undefined,
): Promise<EvaluatedCart> {
  const fodIdx = evaluated.discounts.findIndex((d) => d.reason === "first_order");
  if (fodIdx < 0) return evaluated;

  // Anonymous cart (no member identified yet) → drop the discount.
  // First Order Discount is a member-acquisition tool; giving it to
  // walk-ins who never enter their phone is just leakage. The
  // customer has to identify themselves (phone numpad on second
  // screen OR cashier-side lookup) to qualify. Mirrors the pickup
  // app's requirement that loyalty_phone is set on the order.
  if (!memberId) {
    const fod = evaluated.discounts[fodIdx];
    return {
      ...evaluated,
      discounts: evaluated.discounts.filter((_, i) => i !== fodIdx),
      total_discount: round2(evaluated.total_discount - fod.discount_amount),
      total: round2(evaluated.total + fod.discount_amount),
    };
  }

  try {
    const supabase = getAdmin();

    // Get the member's canonical phone for the pickup-orders lookup —
    // pos_orders is keyed by member_id directly, but pickup `orders`
    // links by loyalty_phone.
    const { data: member } = await supabase
      .from("members")
      .select("phone")
      .eq("id", memberId)
      .maybeSingle();
    const phone = member?.phone as string | undefined;

    // Both tables key by phone (pos_orders.loyalty_phone, orders.loyalty_phone).
    // Build phone variants so a +60 / 0 / 60 stored format matches.
    const variants = phone ? phoneVariants(phone) : [];
    const [posOrdersRes, pickupOrdersRes] = variants.length === 0
      ? [{ count: 0 }, { count: 0 }] as [{ count: number | null }, { count: number | null }]
      : await Promise.all([
          supabase
            .from("pos_orders")
            .select("id", { count: "exact", head: true })
            .in("loyalty_phone", variants)
            .eq("status", "completed"),
          supabase
            .from("orders")
            .select("id", { count: "exact", head: true })
            .in("loyalty_phone", variants)
            .in("status", ["completed", "preparing", "ready", "paid"]),
        ]);

    const priorOrderCount =
      (posOrdersRes.count ?? 0) + (pickupOrdersRes.count ?? 0);

    if (priorOrderCount === 0) {
      // Genuine first order — keep the discount.
      return evaluated;
    }

    // Returning member — drop First Order Discount from the list AND
    // refund the subtracted amount back to the running total.
    const fod = evaluated.discounts[fodIdx];
    const next = {
      ...evaluated,
      discounts: evaluated.discounts.filter((_, i) => i !== fodIdx),
      total_discount: round2(evaluated.total_discount - fod.discount_amount),
      total: round2(evaluated.total + fod.discount_amount),
    };
    return next;
  } catch {
    return evaluated;
  }
}

/**
 * Tier discount post-step — mirrors apps/order/src/lib/loyalty/promotions.ts
 * applyTierDiscount() so POS and pickup honor identical rules.
 *
 *   • Stackable tiers (Bronze 0%, Silver 3%, Gold 5%, Platinum 10%):
 *     percent applies to whatever's left after voucher + auto-promo
 *     discounts. Both lines appear in the discount list so the
 *     customer sees what saved them what.
 *   • Non-stackable tiers (Staff 30%, Black Card 50%): percent applies
 *     to the raw subtotal and REPLACES any earlier voucher / engine
 *     discount. Mirrors the pickup-app rule — invitation tiers trade
 *     voucher flexibility for a much higher flat discount. The
 *     register is responsible for actually dropping the voucher from
 *     the cart state when this happens; the engine signals this by
 *     returning ONLY the tier line in `discounts`.
 *
 * `rewardDiscountRm` is the POS-side voucher discount (applied via
 * issued_rewards). Native routes vouchers through the engine via
 * `reward_promotion_ids`, but POS uses a separate apply-voucher path
 * — we explicitly add it to the remainder here so the tier %
 * doesn't over-count.
 */
async function applyTierDiscount(
  evaluated: EvaluatedCart,
  memberTierId: string | null | undefined,
  rewardDiscountRm: number,
): Promise<EvaluatedCart> {
  if (!memberTierId) return evaluated;
  try {
    const supabase = getAdmin();
    const { data: tier } = await supabase
      .from("tiers")
      .select("id, name, discount_percent, stackable, invitation_only")
      .eq("id", memberTierId)
      .maybeSingle();
    if (!tier) return evaluated;

    const pct = Number((tier.discount_percent as number | null) ?? 0);
    if (pct <= 0) return evaluated;

    const stackable = (tier.stackable as boolean | null) ?? true;
    const tierName = (tier.name as string | null) ?? "Tier";

    if (!stackable) {
      // Invitation-tier rule: tier % on raw subtotal, vouchers wiped.
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

    // Stackable tier — apply on remainder after engine discounts AND
    // the POS-side voucher. Without subtracting rewardDiscountRm here,
    // a Platinum member with a Free Drink voucher gets over-charged the
    // tier % on the voucher's RM value (e.g. 10% × RM 8.90 voucher =
    // RM 0.89 too much off). Floor at 0.
    const remaining = Math.max(
      0,
      evaluated.subtotal - evaluated.total_discount - rewardDiscountRm,
    );
    const amount = round2(remaining * (pct / 100));
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

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    if (!Array.isArray(body.lines)) {
      return NextResponse.json({ error: "lines required" }, { status: 400 });
    }

    const subtotal = (body.lines as { unit_price: number; quantity: number }[]).reduce(
      (s, l) => s + l.unit_price * l.quantity,
      0,
    );

    const empty: EvaluatedCart = {
      subtotal,
      discounts: [],
      total_discount: 0,
      total: subtotal,
    };

    // Run the shared promo engine in-process against Supabase. On any error,
    // degrade gracefully to no engine discount (empty); the tier % + first-order
    // post-steps below still apply.
    let data: EvaluatedCart = empty;
    try {
      const supabase = getAdmin();
      // Cohort tags resolved server-side — never trust client-supplied tags,
      // since promos like "staff price" key off them.
      let memberTags: string[] = [];
      if (body.member_id) {
        const { data: m } = await supabase
          .from("members")
          .select("tags")
          .eq("id", body.member_id)
          .single();
        memberTags = (m?.tags as string[] | null) ?? [];
      }
      const ctx: PromoCartContext = {
        brand_id: BRAND_ID,
        member_id: body.member_id ?? null,
        outlet_id: body.outlet_id ?? null,
        member_tier_id: body.member_tier_id ?? null,
        member_tags: memberTags,
        reward_promotion_ids: body.reward_promotion_ids ?? [],
        // channel:"pos" is authoritative here — this endpoint only ever
        // serves the POS register, so channel-scoped promos gate correctly.
        channel: "pos",
      };
      data = (await evaluateCartShared(supabase, body.lines, ctx)) as EvaluatedCart;
    } catch (err) {
      console.warn("[POS] promo eval failed; no engine discount applied:", err);
    }

    // Drop First Order Discount when the member isn't actually on
    // their first order. The central engine returns this promo for
    // ANY cart whose member hasn't bumped promotion_applications.
    // Pickup keeps the ledger up to date through /api/promotions/apply;
    // POS used to not call it, so every member kept seeing the welcome
    // discount on every visit. Belt-and-braces: also check actual
    // order history (pos_orders + pickup orders) so the discount only
    // fires on a true first-time customer.
    data = await dropFirstOrderIfReturning(data, body.member_id);

    const final = await applyTierDiscount(
      data,
      body.member_tier_id,
      Number(body.reward_discount_rm ?? 0) || 0,
    );
    return NextResponse.json(final);
  } catch (err) {
    console.error("[POS] evaluate-promotions:", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "evaluate failed" },
      { status: 500 },
    );
  }
}
