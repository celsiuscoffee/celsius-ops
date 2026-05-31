import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

/**
 * POST /api/loyalty/mint-voucher
 * Body: { member_id, reward_id, outlet_id? }
 *
 * Customer-display points-shop: spend Beans → mint an issued_rewards
 * row into the member's wallet. Does NOT apply to any cart. The new
 * voucher then shows in the wallet and the customer can tap it (which
 * goes through /apply-voucher) when ready to redeem against an order.
 *
 * Distinct from /api/loyalty/redeem which is the cashier flow that
 * deducts points AND immediately attaches a discount to the order.
 *
 * 200 → { voucher, new_balance, points_spent }
 * 402 → { error: "insufficient_beans" }
 * 404 → reward not found / inactive
 */

const BRAND_ID = "brand-celsius";

function getAdmin() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
  );
}

/** When the catalog row's `discount_type` is null (legacy / admin
 *  oversight), infer it from the reward's name so the minted voucher
 *  actually works at checkout. Without this, customers spent beans and
 *  got vouchers that quietly applied a 0 discount — Free Drink would
 *  let them tap "Use" but the cart still charged for the drink. This
 *  mirrors the inference the original /api/loyalty/redeem path used
 *  to do; we dropped it during the Phase 2 shared-engine refactor and
 *  this is the regression replacement.
 *
 *  Returns the same shape the catalog row has so the caller can splat
 *  into the issued_rewards insert. Returns nulls only when the name
 *  doesn't match any known pattern — the engine then reports
 *  `no_discount_type`, which surfaces in the receipt as "voucher
 *  needs admin attention" instead of silently charging full price. */
function inferDiscount(reward: {
  name: string;
  discount_type: string | null;
  discount_value: number | string | null;
}): { discount_type: string | null; discount_value: number | null } {
  // Cast: rewards.discount_value can come back as a numeric-typed
  // string from PostgREST. Normalise to number | null here.
  const existingValue =
    reward.discount_value == null
      ? null
      : typeof reward.discount_value === "string"
      ? parseFloat(reward.discount_value)
      : reward.discount_value;

  if (reward.discount_type) {
    return { discount_type: reward.discount_type, discount_value: existingValue };
  }

  const name = reward.name || "";
  // "Free Drink" / "Free Coffee" / "Free Upgrade" / "Free <anything>"
  //   → free_item (cheapest eligible line, value is null — engine
  //     uses the line's unit_price_sen as the discount).
  if (/^\s*free\s+/i.test(name) || /\bfree\s+(drink|coffee|upgrade|item)/i.test(name)) {
    return { discount_type: "free_item", discount_value: null };
  }
  // "RM 5" / "RM10" / "RM 12.50 off" → flat (sen). RM value × 100.
  const rmMatch = name.match(/^\s*rm\s*(\d+(?:\.\d+)?)/i);
  if (rmMatch) {
    const rm = parseFloat(rmMatch[1]);
    if (Number.isFinite(rm)) {
      return { discount_type: "flat", discount_value: Math.round(rm * 100) };
    }
  }
  // "15% off" / "20%" → percent (raw percentage, no ×100).
  const pctMatch = name.match(/(\d+(?:\.\d+)?)\s*%/);
  if (pctMatch) {
    const pct = parseFloat(pctMatch[1]);
    if (Number.isFinite(pct)) {
      return { discount_type: "percent", discount_value: pct };
    }
  }
  // Unknown pattern — leave null so the engine fails open with a
  // recognisable reason ("no_discount_type") rather than silently
  // charging full price.
  return { discount_type: null, discount_value: existingValue };
}

export async function POST(req: NextRequest) {
  try {
    const { member_id, reward_id, outlet_id } = await req.json();
    if (!member_id || !reward_id) {
      return NextResponse.json(
        { error: "member_id and reward_id required" },
        { status: 400 },
      );
    }

    const supabase = getAdmin();

    const { data: reward, error: rwErr } = await supabase
      .from("rewards")
      .select(
        "id, name, description, points_required, validity_days, category, discount_type, discount_value, max_discount_value, min_order_value, applicable_categories, applicable_products, free_product_name, free_product_ids, stock, is_active",
      )
      .eq("id", reward_id)
      .eq("brand_id", BRAND_ID)
      .eq("is_active", true)
      .single();

    if (rwErr || !reward) {
      return NextResponse.json({ error: "Reward not found" }, { status: 404 });
    }
    if (reward.stock !== null && reward.stock <= 0) {
      return NextResponse.json({ error: "Out of stock" }, { status: 400 });
    }

    const { data: mb } = await supabase
      .from("member_brands")
      .select("id, points_balance, total_points_redeemed")
      .eq("member_id", member_id)
      .eq("brand_id", BRAND_ID)
      .single();
    if (!mb) {
      return NextResponse.json({ error: "Member not found for brand" }, { status: 404 });
    }
    if (mb.points_balance < reward.points_required) {
      return NextResponse.json({ error: "insufficient_beans" }, { status: 402 });
    }

    // Try the atomic RPC first; fall back to optimistic update if it doesn't exist.
    let newBalance = mb.points_balance - reward.points_required;
    const { data: deductResult, error: deductErr } = await supabase.rpc("deduct_points", {
      p_member_id: member_id,
      p_brand_id: BRAND_ID,
      p_points: reward.points_required,
    });

    if (deductErr) {
      if (deductErr.code !== "42883" && !deductErr.message?.includes("function")) {
        console.error("[LOYALTY] mint-voucher deduct error:", deductErr);
        return NextResponse.json({ error: "Failed to deduct points" }, { status: 500 });
      }
      // Fallback: optimistic update
      const { error: updateErr } = await supabase
        .from("member_brands")
        .update({
          points_balance: newBalance,
          total_points_redeemed: mb.total_points_redeemed + reward.points_required,
        })
        .eq("id", mb.id)
        .eq("points_balance", mb.points_balance);
      if (updateErr) {
        return NextResponse.json({ error: "Concurrency error" }, { status: 409 });
      }
    } else {
      newBalance = deductResult as number;
      if (newBalance < 0) {
        return NextResponse.json({ error: "insufficient_beans" }, { status: 402 });
      }
    }

    // Mint the voucher into issued_rewards.
    const expiresAt = reward.validity_days
      ? new Date(Date.now() + reward.validity_days * 24 * 60 * 60 * 1000).toISOString()
      : null;
    const id = `ir-points_redemption-${Date.now().toString(36)}-${Math.random()
      .toString(36)
      .slice(2, 8)}`;

    // Defensive inference — see inferDiscount() for why.
    const inferred = inferDiscount({
      name: reward.name,
      discount_type: reward.discount_type as string | null,
      discount_value: reward.discount_value as number | string | null,
    });
    if (!reward.discount_type && inferred.discount_type) {
      console.warn(
        `[LOYALTY] mint-voucher: catalog row ${reward.id} (${reward.name}) had null discount_type — inferred '${inferred.discount_type}'. Backfill the rewards row to silence this warning.`,
      );
    }

    const { data: voucher, error: voucherErr } = await supabase
      .from("issued_rewards")
      .insert({
        id,
        brand_id: BRAND_ID,
        member_id,
        reward_id: reward.id,
        source_type: "points_redemption",
        source_ref_id: null,
        title: reward.name,
        description: reward.description,
        icon: null,
        category: reward.category,
        discount_type: inferred.discount_type,
        discount_value: inferred.discount_value,
        min_order_value: reward.min_order_value,
        applicable_categories: reward.applicable_categories,
        applicable_products: reward.applicable_products,
        free_product_name: reward.free_product_name,
        stacks_with_beans: true,
        status: "active",
        issued_at: new Date().toISOString(),
        expires_at: expiresAt,
      })
      .select()
      .single();

    if (voucherErr || !voucher) {
      console.error("[LOYALTY] mint-voucher insert error:", voucherErr);
      // Best-effort: refund points so the customer isn't stuck.
      await supabase
        .from("member_brands")
        .update({ points_balance: mb.points_balance })
        .eq("id", mb.id);
      return NextResponse.json({ error: "Failed to mint voucher" }, { status: 500 });
    }

    // Audit transaction.
    await supabase.from("point_transactions").insert({
      id: `txn-mint-${Date.now()}-${Math.floor(Math.random() * 9000 + 1000)}`,
      member_id,
      brand_id: BRAND_ID,
      outlet_id: outlet_id || null,
      type: "redeem",
      points: -reward.points_required,
      balance_after: newBalance,
      description: `Customer-display mint: ${reward.name}`,
      reference_id: voucher.id,
      multiplier: 1,
    });

    if (reward.stock !== null) {
      await supabase
        .from("rewards")
        .update({ stock: Math.max(0, reward.stock - 1) })
        .eq("id", reward.id)
        .gt("stock", 0);
    }

    return NextResponse.json({
      voucher,
      new_balance: newBalance,
      points_spent: reward.points_required,
    });
  } catch (err) {
    console.error("[LOYALTY] mint-voucher error:", err);
    return NextResponse.json({ error: "Mint failed" }, { status: 500 });
  }
}
