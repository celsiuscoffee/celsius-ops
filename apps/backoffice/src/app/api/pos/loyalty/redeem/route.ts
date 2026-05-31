import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

// Service-role required: member_brands writes + issued_rewards updates
// are blocked under anon. Without this, the modal hand-off succeeds
// but the actual deduction silently fails.
const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
);

const BRAND_ID = "brand-celsius";

function generateCode(): string {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let code = "";
  for (let i = 0; i < 8; i++) code += chars.charAt(Math.floor(Math.random() * chars.length));
  return code;
}

/**
 * POST /api/loyalty/redeem
 * Body: { member_id, reward_id, outlet_id, issued_reward_id? }
 *
 * For catalog rewards: deducts points, creates redemption record
 * For issued rewards: marks issued_reward as "used", creates redemption record (0 points)
 */
export async function POST(req: NextRequest) {
  try {
    const { member_id, reward_id, outlet_id, issued_reward_id } = await req.json();

    if (!member_id || !reward_id) {
      return NextResponse.json({ error: "member_id and reward_id required" }, { status: 400 });
    }

    // Fetch reward details
    const { data: reward, error: rwErr } = await supabase
      .from("rewards")
      .select("*")
      .eq("id", reward_id)
      .eq("brand_id", BRAND_ID)
      .eq("is_active", true)
      .single();

    if (rwErr || !reward) {
      return NextResponse.json({ error: "Reward not found or inactive" }, { status: 404 });
    }

    // Check stock
    if (reward.stock !== null && reward.stock <= 0) {
      return NextResponse.json({ error: "Reward out of stock" }, { status: 400 });
    }

    let newBalance: number;
    const code = generateCode();

    if (issued_reward_id) {
      // ── Issued reward (birthday/welcome): no point deduction ──
      const { error: irErr } = await supabase
        .from("issued_rewards")
        .update({ status: "used" })
        .eq("id", issued_reward_id)
        .eq("member_id", member_id)
        .eq("status", "active");

      if (irErr) {
        return NextResponse.json({ error: "Failed to use issued reward" }, { status: 500 });
      }

      // Get current balance for response
      const { data: mb } = await supabase
        .from("member_brands")
        .select("points_balance")
        .eq("member_id", member_id)
        .eq("brand_id", BRAND_ID)
        .single();
      newBalance = mb?.points_balance ?? 0;

    } else {
      // ── Catalog reward: atomic point deduction ──
      const { data: deductResult, error: deductErr } = await supabase
        .rpc("deduct_points", {
          p_member_id: member_id,
          p_brand_id: BRAND_ID,
          p_points: reward.points_required,
        });

      if (deductErr) {
        // Fallback: manual deduction if RPC doesn't exist
        if (deductErr.message.includes("function") || deductErr.code === "42883") {
          const { data: mb } = await supabase
            .from("member_brands")
            .select("*")
            .eq("member_id", member_id)
            .eq("brand_id", BRAND_ID)
            .single();

          if (!mb || mb.points_balance < reward.points_required) {
            return NextResponse.json({ error: "Insufficient points" }, { status: 400 });
          }

          newBalance = mb.points_balance - reward.points_required;
          await supabase
            .from("member_brands")
            .update({
              points_balance: newBalance,
              total_points_redeemed: mb.total_points_redeemed + reward.points_required,
            })
            .eq("id", mb.id);
        } else {
          return NextResponse.json({ error: "Failed to deduct points" }, { status: 500 });
        }
      } else {
        newBalance = deductResult as number;
        if (newBalance < 0) {
          return NextResponse.json({ error: "Insufficient points" }, { status: 400 });
        }
      }

      // Create point_transaction for audit
      await supabase.from("point_transactions").insert({
        id: `txn-pos-${Date.now()}-${Math.floor(Math.random() * 9000 + 1000)}`,
        member_id,
        brand_id: BRAND_ID,
        outlet_id: outlet_id || null,
        type: "redeem",
        points: -reward.points_required,
        balance_after: newBalance,
        description: `POS Redeemed: ${reward.name}`,
        reference_id: null, // will be updated with redemption id
        multiplier: 1,
      });
    }

    // Create redemption record
    const rdmId = `rdm-pos-${Date.now()}-${Math.floor(Math.random() * 9000 + 1000)}`;
    const { data: redemption, error: rdmErr } = await supabase
      .from("redemptions")
      .insert({
        id: rdmId,
        member_id,
        reward_id,
        brand_id: BRAND_ID,
        outlet_id: outlet_id || null,
        points_spent: issued_reward_id ? 0 : reward.points_required,
        status: "confirmed", // POS redemptions are instantly confirmed
        code,
        redemption_type: "in_store",
        source: "pos",
        confirmed_at: new Date().toISOString(),
      })
      .select()
      .single();

    if (rdmErr) {
      // Rollback points if redemption record fails (only for catalog rewards)
      if (!issued_reward_id) {
        await supabase.rpc("deduct_points", {
          p_member_id: member_id,
          p_brand_id: BRAND_ID,
          p_points: -reward.points_required, // negative = add back
        });
      }
      return NextResponse.json({ error: "Failed to create redemption" }, { status: 500 });
    }

    // Decrement stock
    if (reward.stock !== null) {
      await supabase
        .from("rewards")
        .update({ stock: Math.max(0, reward.stock - 1) })
        .eq("id", reward_id)
        .gt("stock", 0);
    }

    // Build discount info for POS to apply
    const discount = buildDiscountInfo(reward);

    return NextResponse.json({
      success: true,
      redemption_id: rdmId,
      code,
      new_balance: newBalance,
      reward_name: reward.name,
      discount,
    });
  } catch (err) {
    console.error("[LOYALTY] Redeem error:", err);
    return NextResponse.json({ error: "Redemption failed" }, { status: 500 });
  }
}

/**
 * Convert reward fields into a structured discount object for the POS cart.
 * Handles both structured (discount_type populated) and legacy (name-based) rewards.
 */
function buildDiscountInfo(reward: Record<string, any>) {
  // If discount_type is populated, use structured discount
  if (reward.discount_type) {
    return {
      type: reward.discount_type as string,
      value: Number(reward.discount_value ?? 0),
      max_discount: reward.max_discount_value ? Number(reward.max_discount_value) : null,
      min_order: reward.min_order_value ? Number(reward.min_order_value) : null,
      applicable_products: reward.applicable_products ?? null,
      applicable_categories: reward.applicable_categories ?? null,
      free_product_ids: reward.free_product_ids ?? null,
      free_product_name: reward.free_product_name ?? null,
    };
  }

  // Legacy rewards: infer discount from name
  const name = (reward.name ?? "").toLowerCase();

  // "RM5" / "RM 5" / "RM10" pattern → fixed_amount
  const rmMatch = name.match(/rm\s?(\d+(?:\.\d+)?)/);
  if (rmMatch) {
    return {
      type: "fixed_amount",
      value: parseFloat(rmMatch[1]),
      max_discount: null,
      min_order: null,
      applicable_products: null,
      applicable_categories: null,
      free_product_ids: null,
      free_product_name: null,
    };
  }

  // "Free Drink" / "Free Coffee" → free_item
  if (name.includes("free")) {
    return {
      type: "free_item",
      value: 0,
      max_discount: null,
      min_order: null,
      applicable_products: reward.applicable_products ?? null,
      applicable_categories: reward.applicable_categories ?? null,
      free_product_ids: reward.free_product_ids ?? null,
      free_product_name: reward.free_product_name ?? reward.name,
    };
  }

  // "X% off" pattern → percentage
  const pctMatch = name.match(/(\d+)\s?%/);
  if (pctMatch) {
    return {
      type: "percentage",
      value: parseInt(pctMatch[1]),
      max_discount: null,
      min_order: null,
      applicable_products: null,
      applicable_categories: null,
      free_product_ids: null,
      free_product_name: null,
    };
  }

  // Unknown — return as name-only (staff applies manually)
  return {
    type: "manual",
    value: 0,
    max_discount: null,
    min_order: null,
    applicable_products: null,
    applicable_categories: null,
    free_product_ids: null,
    free_product_name: null,
    note: reward.name,
  };
}
