// src/lib/loyalty/points.ts
// Direct Supabase operations for loyalty points — no HTTP calls to loyalty app

import { getSupabaseAdmin } from "@/lib/supabase/server";

const BRAND_ID = "brand-celsius";

/** Resolve the loyalty outlet_id from outlet_settings, falling back to the raw store_id. */
async function resolveOutletId(storeId: string): Promise<string> {
  try {
    const supabase = getSupabaseAdmin();
    const { data } = await supabase
      .from("outlet_settings")
      .select("loyalty_outlet_id")
      .eq("store_id", storeId)
      .single();
    return (data?.loyalty_outlet_id as string | null) ?? storeId;
  } catch {
    return storeId;
  }
}

/**
 * Look up the points multiplier for a member based on their current tier.
 * Returns 1.0 if no tier or no member. Cheap call used at order-create time
 * so the displayed "points to earn" matches what the member actually receives.
 */
export async function getTierMultiplier(loyaltyId: string): Promise<number> {
  try {
    const supabase = getSupabaseAdmin();
    const { data } = await supabase
      .from("member_brands")
      .select("tiers(multiplier)")
      .eq("member_id", loyaltyId)
      .eq("brand_id", BRAND_ID)
      .single();
    const tier = (data as { tiers?: { multiplier?: number } | null } | null)?.tiers;
    return tier?.multiplier ?? 1.0;
  } catch {
    return 1.0;
  }
}

/**
 * Credit a one-off bonus Points grant outside the order earn flow.
 * Used by Mystery Bean reveals (multiplier delta, flat bonus) and
 * elsewhere bonuses need to land in the ledger without bumping
 * total_visits or last_visit_at.
 *
 * Fire-and-forget — never throws. Returns the new balance if
 * available, or null if anything failed (member missing, OCC retry
 * exhausted, etc).
 */
export async function awardBonusBeans(args: {
  memberId:    string;
  amount:      number;
  outletId?:   string;
  description: string;
  referenceId?: string;
  txnType?:    "mystery_bonus" | "manual_bonus" | "mission_bonus";
}): Promise<number | null> {
  if (args.amount <= 0) return null;
  try {
    const supabase = getSupabaseAdmin();
    const outletId = args.outletId ? await resolveOutletId(args.outletId) : null;

    const { data: member } = await supabase
      .from("member_brands")
      .select("points_balance, total_points_earned")
      .eq("member_id", args.memberId)
      .eq("brand_id", BRAND_ID)
      .single();
    if (!member) return null;

    const currentBalance = member.points_balance as number;
    const newBalance = currentBalance + args.amount;

    const { data: updated } = await supabase
      .from("member_brands")
      .update({
        points_balance: newBalance,
        total_points_earned: (member.total_points_earned as number) + args.amount,
      })
      .eq("member_id", args.memberId)
      .eq("brand_id", BRAND_ID)
      .eq("points_balance", currentBalance)
      .select("points_balance")
      .maybeSingle();

    if (!updated) {
      // OCC miss — retry once with fresh read.
      const { data: fresh } = await supabase
        .from("member_brands")
        .select("points_balance, total_points_earned")
        .eq("member_id", args.memberId)
        .eq("brand_id", BRAND_ID)
        .single();
      if (!fresh) return null;
      const retryBalance = (fresh.points_balance as number) + args.amount;
      await supabase
        .from("member_brands")
        .update({
          points_balance: retryBalance,
          total_points_earned: (fresh.total_points_earned as number) + args.amount,
        })
        .eq("member_id", args.memberId)
        .eq("brand_id", BRAND_ID);
    }

    await supabase.from("point_transactions").insert({
      id: `txn-${args.txnType ?? "bonus"}-${Date.now()}-${Math.floor(Math.random() * 9000) + 1000}`,
      member_id: args.memberId,
      brand_id: BRAND_ID,
      outlet_id: outletId,
      type: "earn",
      points: args.amount,
      balance_after: newBalance,
      description: args.description,
      reference_id: args.referenceId ?? null,
      multiplier: null,
    });

    return newBalance;
  } catch (e) {
    console.warn("[loyalty] awardBonusBeans failed", e);
    return null;
  }
}

/**
 * Earn loyalty points for a completed pickup order.
 * Fire-and-forget — never throws.
 *
 * `points` is expected to ALREADY include the tier multiplier (computed at
 * order-create time so the receipt matches). This function applies any
 * active post-purchase coupon multiplier on top, then burns the coupon.
 */
export async function earnLoyaltyPoints(
  loyaltyId: string,
  orderId: string,
  points: number,
  storeId: string
): Promise<void> {
  if (points <= 0) return;
  try {
    const supabase  = getSupabaseAdmin();
    const outletId  = await resolveOutletId(storeId);

    // Post-purchase coupon multiplier — set when a member has an active
    // post_purchase issued_reward (e.g. "2× points on next visit").
    const now = new Date().toISOString();
    const { data: activeCoupons } = await supabase
      .from("issued_rewards")
      .select("id, reward:rewards(discount_value, reward_type)")
      .eq("member_id", loyaltyId)
      .eq("brand_id", BRAND_ID)
      .eq("status", "active")
      .gt("expires_at", now)
      .eq("rewards.reward_type", "post_purchase")
      .limit(1);

    const activeCoupon = activeCoupons?.[0] ?? null;
    const couponReward =
      (activeCoupon?.reward as unknown as { discount_value: number | null } | null) ?? null;
    const couponMultiplier = couponReward?.discount_value ?? 1.0;

    // Apply coupon to the already-tier-multiplied input. Cap at 20× of input
    // to be defensive against bad coupon data.
    const cappedCouponMul = Math.min(couponMultiplier, 20);
    const effectivePoints = Math.max(0, Math.round(points * cappedCouponMul));

    // Atomic increment + ledger write via add_loyalty_points RPC.
    // Replaces an OCC retry pattern where a missed retry was silently
    // dropped — caller never knew points didn't land. The RPC raises
    // 'member_brand_not_found' if the member row doesn't exist for
    // this brand; everything else either succeeds atomically or
    // rolls back.
    const { error: rpcErr } = await supabase.rpc("add_loyalty_points", {
      p_member_id:  loyaltyId,
      p_brand_id:   BRAND_ID,
      p_points:     effectivePoints,
      p_outlet_id:  outletId,
      p_order_id:   orderId,
      p_multiplier: cappedCouponMul,
      p_description: "Points earned for pickup order",
    });
    if (rpcErr) {
      console.error("[loyalty] earnLoyaltyPoints: add_loyalty_points rpc error", rpcErr.message);
      return;
    }

    // Burn the post-purchase coupon if it was applied. Uses the
    // shared mark-used helper so the row also gets a redeemed_at
    // stamp (the previous inline update lost the timestamp, which
    // broke audit trails for coupons burned via the points path).
    if (activeCoupon && couponMultiplier > 1) {
      const { markVoucherUsed } = await import("@celsius/shared");
      await markVoucherUsed({
        supabase,
        voucherId: activeCoupon.id,
      });
    }

    // Fire-and-forget tier re-evaluation so a member who just crossed
    // a threshold gets bumped immediately.
    void Promise.resolve(
      supabase.rpc("evaluate_member_tier", {
        p_member_id: loyaltyId,
        p_brand_id:  BRAND_ID,
      })
    ).catch(() => {/* non-critical */});
  } catch (err) {
    console.error("[loyalty] earnLoyaltyPoints unexpected error:", err);
  }
}

/**
 * Deduct loyalty points when a reward is redeemed at checkout.
 * Returns true on success so the caller can log + flag the order
 * for manual reconciliation if it failed (silent ledger drift used
 * to mean "customer redeems reward, points never deducted, reward
 * re-redeemable").
 */
export async function deductLoyaltyPoints(
  loyaltyId: string,
  rewardId: string,
  storeId: string
): Promise<boolean> {
  try {
    const supabase = getSupabaseAdmin();
    const outletId = await resolveOutletId(storeId);

    // Fetch member_brands row
    const { data: member, error: memberErr } = await supabase
      .from("member_brands")
      .select("points_balance")
      .eq("member_id", loyaltyId)
      .eq("brand_id", BRAND_ID)
      .single();

    if (memberErr || !member) {
      console.warn("[loyalty] deductLoyaltyPoints: member not found for store");
      return false;
    }

    // Fetch reward
    const { data: reward, error: rewardErr } = await supabase
      .from("rewards")
      .select("id, name, points_required, auto_issue, reward_type")
      .eq("id", rewardId)
      .eq("brand_id", BRAND_ID)
      .eq("is_active", true)
      .single();

    if (rewardErr || !reward) {
      console.warn("[loyalty] deductLoyaltyPoints: reward not found", rewardId, rewardErr?.message);
      return false;
    }

    // Voucher path: if the member has an active issued_reward for this
    // reward (auto-issued at signup, post-purchase coupon, manual grant),
    // consume that instead of going through the points-shop flow. This
    // is what gates "0-pt" rewards like Welcome BOGO to entitled members
    // only — without this check anyone could redeem the BOGO repeatedly.
    const nowIso = new Date().toISOString();
    const { data: voucher } = await supabase
      .from("issued_rewards")
      .select("id, expires_at")
      .eq("member_id", loyaltyId)
      .eq("brand_id", BRAND_ID)
      .eq("reward_id", rewardId)
      .eq("status", "active")
      .or(`expires_at.is.null,expires_at.gt.${nowIso}`)
      .order("issued_at", { ascending: true })
      .limit(1)
      .maybeSingle();

    // Auto-issue rewards (BOGO, post-purchase, birthday) MUST be
    // consumed via a voucher. If the member is trying to redeem one
    // without an active issued_reward row, refuse — they aren't
    // entitled. Standard points-shop rewards fall through.
    if (reward.auto_issue && !voucher) {
      console.warn(
        `[loyalty] deductLoyaltyPoints: ${reward.reward_type} reward ${rewardId} requires an active voucher for member ${loyaltyId} — refusing`,
      );
      return false;
    }

    const isVoucherRedemption = !!voucher;
    // For voucher redemptions the points cost is whatever the underlying
    // reward says (usually 0 for BOGO/free-item). Standard rewards
    // deduct points_required from the balance.
    const pointsToSpend = (reward.points_required as number) ?? 0;

    let newBalance: number;
    if (pointsToSpend > 0) {
      const { data: rpcData, error: rpcErr } = await supabase.rpc("deduct_points", {
        p_member_id: loyaltyId,
        p_brand_id:  BRAND_ID,
        p_points:    pointsToSpend,
      });
      if (rpcErr) {
        console.error("[loyalty] deductLoyaltyPoints: RPC error", rpcErr.message);
        return false;
      }
      newBalance = rpcData as number;
      if (newBalance < 0) {
        console.warn("[loyalty] deductLoyaltyPoints: insufficient points for member");
        return false;
      }
    } else {
      newBalance = member.points_balance as number;
    }

    // Generate redemption code — 8 chars from unambiguous charset
    const charset = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
    let redemptionCode = "";
    for (let i = 0; i < 8; i++) {
      redemptionCode += charset[Math.floor(Math.random() * charset.length)];
    }

    const redemptionId = `rdm-pickup-${Date.now()}-${Math.floor(Math.random() * 9000) + 1000}`;

    if (isVoucherRedemption && voucher) {
      // Atomic CAS voucher-consume + redemption insert. Earlier the
      // sequence was insert-redemption then update-voucher; a
      // concurrent call could read the still-active voucher between
      // those two steps and double-redeem. The RPC does a CAS update
      // (must be status='active') then inserts the redemption inside
      // one transaction — Postgres rolls back the voucher consume if
      // anything else fails.
      const { data: consumeResult, error: consumeErr } = await supabase.rpc("consume_voucher_for_redemption", {
        p_voucher_id:    voucher.id,
        p_member_id:     loyaltyId,
        p_redemption_id: redemptionId,
        p_reward_id:     rewardId,
        p_brand_id:      BRAND_ID,
        p_outlet_id:     outletId,
        p_points_spent:  pointsToSpend,
        p_code:          redemptionCode,
      });
      if (consumeErr) {
        console.error("[loyalty] deductLoyaltyPoints: consume rpc error", consumeErr.message);
        return false;
      }
      const consumed = Array.isArray(consumeResult) && consumeResult.length > 0
        ? Boolean((consumeResult[0] as { consumed: boolean }).consumed)
        : false;
      if (!consumed) {
        // Voucher was claimed by a concurrent redemption between the
        // earlier lookup and the CAS. Refuse cleanly — the member's
        // points were never debited (voucher path) and the redemption
        // row was never inserted.
        console.warn(`[loyalty] deductLoyaltyPoints: voucher ${voucher.id} no longer active — concurrent redeem?`);
        return false;
      }
    } else {
      // Non-voucher (standard points-shop) path: just insert the
      // redemption row. Points were already deducted via deduct_points
      // RPC above.
      const now = new Date().toISOString();
      const { error: rdmErr } = await supabase.from("redemptions").insert({
        id:              redemptionId,
        member_id:       loyaltyId,
        reward_id:       rewardId,
        brand_id:        BRAND_ID,
        outlet_id:       outletId,
        points_spent:    pointsToSpend,
        status:          "confirmed",
        code:            redemptionCode,
        redemption_type: "pickup",
        source:          "pickup_app",
        confirmed_at:    now,
      });
      if (rdmErr) {
        console.error("[loyalty] deductLoyaltyPoints: redemption insert error", rdmErr.message);
        return false;
      }
    }

    // Insert point_transaction only if points actually moved. A voucher
    // redemption with 0 cost shouldn't add a noise row to the ledger.
    if (pointsToSpend > 0) {
      const txnId = `txn-rdm-pickup-${Date.now()}-${Math.floor(Math.random() * 9000) + 1000}`;
      const { error: txnErr } = await supabase.from("point_transactions").insert({
        id:           txnId,
        member_id:    loyaltyId,
        brand_id:     BRAND_ID,
        outlet_id:    outletId,
        type:         "redeem",
        points:       -pointsToSpend,
        balance_after: newBalance,
        description:  `Redeemed: ${reward.name as string}`,
        reference_id: redemptionId,
        multiplier:   1,
      });

      if (txnErr) {
        console.error("[loyalty] deductLoyaltyPoints: transaction insert error", txnErr.message);
        // Points already deducted — return true so the caller doesn't
        // double-flag. The transaction-log gap is a separate recoverable
        // issue (we have the redemption row + new balance).
      }
    }
    return true;
  } catch (err) {
    console.error("[loyalty] deductLoyaltyPoints unexpected error:", err);
    return false;
  }
}
