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
 * Earn loyalty points for a completed pickup order.
 * Fire-and-forget — never throws.
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
    const newBalance     = currentBalance + points;

    // Optimistic-concurrency update
    const { data: updated, error: updateErr } = await supabase
      .from("member_brands")
      .update({
        points_balance:      newBalance,
        total_points_earned: (member.total_points_earned as number) + points,
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

      const retryBalance    = (fresh.points_balance as number) + points;
      const { error: retryErr } = await supabase
        .from("member_brands")
        .update({
          points_balance:      retryBalance,
          total_points_earned: (fresh.total_points_earned as number) + points,
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
      points,
      balance_after: newBalance,
      description: "Points earned for pickup order",
      reference_id: orderId,
      multiplier:  1,
    });

    if (txnErr) {
      console.error("[loyalty] earnLoyaltyPoints: transaction insert error", txnErr.message);
    }
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
