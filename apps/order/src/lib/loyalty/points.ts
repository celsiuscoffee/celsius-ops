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

    // Fetch member_brands row
    const { data: member, error: memberErr } = await supabase
      .from("member_brands")
      .select("points_balance, total_points_earned, total_visits")
      .eq("member_id", loyaltyId)
      .eq("brand_id", BRAND_ID)
      .single();

    if (memberErr || !member) {
      console.warn("[loyalty] earnLoyaltyPoints: member not found for store");
      return;
    }

    const currentBalance = member.points_balance as number;
    const newBalance     = currentBalance + effectivePoints;

    // Optimistic-concurrency update
    const { data: updated, error: updateErr } = await supabase
      .from("member_brands")
      .update({
        points_balance:      newBalance,
        total_points_earned: (member.total_points_earned as number) + effectivePoints,
        total_visits:        (member.total_visits as number) + 1,
        last_visit_at:       new Date().toISOString(),
      })
      .eq("member_id", loyaltyId)
      .eq("brand_id", BRAND_ID)
      .eq("points_balance", currentBalance)
      .select("points_balance")
      .maybeSingle();

    if (updateErr) {
      console.error("[loyalty] earnLoyaltyPoints: update error", updateErr.message);
      return;
    }

    if (!updated) {
      // Concurrent update — retry once with latest balance
      const { data: fresh } = await supabase
        .from("member_brands")
        .select("points_balance, total_points_earned, total_visits")
        .eq("member_id", loyaltyId)
        .eq("brand_id", BRAND_ID)
        .single();

      if (!fresh) {
        console.warn("[loyalty] earnLoyaltyPoints: retry fetch failed");
        return;
      }

      const retryBalance    = (fresh.points_balance as number) + effectivePoints;
      const { error: retryErr } = await supabase
        .from("member_brands")
        .update({
          points_balance:      retryBalance,
          total_points_earned: (fresh.total_points_earned as number) + effectivePoints,
          total_visits:        (fresh.total_visits as number) + 1,
          last_visit_at:       new Date().toISOString(),
        })
        .eq("member_id", loyaltyId)
        .eq("brand_id", BRAND_ID);

      if (retryErr) {
        console.error("[loyalty] earnLoyaltyPoints: retry update error", retryErr.message);
        return;
      }
    }

    // Insert point_transaction
    const txnId = `txn-pickup-${Date.now()}-${Math.floor(Math.random() * 9000) + 1000}`;
    const { error: txnErr } = await supabase.from("point_transactions").insert({
      id:          txnId,
      member_id:   loyaltyId,
      brand_id:    BRAND_ID,
      outlet_id:   outletId,
      type:        "earn",
      points:      effectivePoints,
      balance_after: newBalance,
      description: "Points earned for pickup order",
      reference_id: orderId,
      multiplier:  cappedCouponMul,
    });

    if (txnErr) {
      console.error("[loyalty] earnLoyaltyPoints: transaction insert error", txnErr.message);
    }

    // Burn the post-purchase coupon if it was applied.
    if (activeCoupon && couponMultiplier > 1) {
      await supabase
        .from("issued_rewards")
        .update({ status: "used" })
        .eq("id", activeCoupon.id);
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
 * Fire-and-forget — never throws.
 */
export async function deductLoyaltyPoints(
  loyaltyId: string,
  rewardId: string,
  storeId: string
): Promise<void> {
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
      return;
    }

    // Fetch reward
    const { data: reward, error: rewardErr } = await supabase
      .from("rewards")
      .select("id, name, points_required")
      .eq("id", rewardId)
      .eq("brand_id", BRAND_ID)
      .eq("is_active", true)
      .single();

    if (rewardErr || !reward) {
      console.warn("[loyalty] deductLoyaltyPoints: reward not found", rewardId, rewardErr?.message);
      return;
    }

    // Deduct via RPC
    const { data: rpcData, error: rpcErr } = await supabase.rpc("deduct_points", {
      p_member_id: loyaltyId,
      p_brand_id:  BRAND_ID,
      p_points:    reward.points_required as number,
    });

    if (rpcErr) {
      console.error("[loyalty] deductLoyaltyPoints: RPC error", rpcErr.message);
      return;
    }

    const newBalance = rpcData as number;
    if (newBalance < 0) {
      console.warn("[loyalty] deductLoyaltyPoints: insufficient points for member");
      return;
    }

    // Generate redemption code — 8 chars from unambiguous charset
    const charset = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
    let redemptionCode = "";
    for (let i = 0; i < 8; i++) {
      redemptionCode += charset[Math.floor(Math.random() * charset.length)];
    }

    const now          = new Date().toISOString();
    const redemptionId = `rdm-pickup-${Date.now()}-${Math.floor(Math.random() * 9000) + 1000}`;

    // Insert redemption
    const { error: rdmErr } = await supabase.from("redemptions").insert({
      id:              redemptionId,
      member_id:       loyaltyId,
      reward_id:       rewardId,
      brand_id:        BRAND_ID,
      outlet_id:       outletId,
      points_spent:    reward.points_required as number,
      status:          "confirmed",
      code:            redemptionCode,
      redemption_type: "pickup",
      source:          "pickup_app",
      confirmed_at:    now,
    });

    if (rdmErr) {
      console.error("[loyalty] deductLoyaltyPoints: redemption insert error", rdmErr.message);
      return;
    }

    // Insert point_transaction
    const txnId = `txn-rdm-pickup-${Date.now()}-${Math.floor(Math.random() * 9000) + 1000}`;
    const { error: txnErr } = await supabase.from("point_transactions").insert({
      id:           txnId,
      member_id:    loyaltyId,
      brand_id:     BRAND_ID,
      outlet_id:    outletId,
      type:         "redeem",
      points:       -(reward.points_required as number),
      balance_after: newBalance,
      description:  `Redeemed: ${reward.name as string}`,
      reference_id: redemptionId,
      multiplier:   1,
    });

    if (txnErr) {
      console.error("[loyalty] deductLoyaltyPoints: transaction insert error", txnErr.message);
    }
  } catch (err) {
    console.error("[loyalty] deductLoyaltyPoints unexpected error:", err);
  }
}
