import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { catalogMirrorTemplateId } from "@/lib/catalog-mirror";

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

    // Commit 2: link the minted voucher to its canonical template (the
    // Bean-Shop mirror of this catalog row — same deterministic UUID
    // the Commit-1 migration generated). Readers can resolve canonical
    // fields through voucher_template_id; the inline discount fields
    // below stay as a grace-window snapshot until Commit 3 drops them.
    // inferDiscount is gone — the catalog row carries a real
    // discount_type now (backfilled), so we copy it straight through.
    const voucherTemplateId = catalogMirrorTemplateId(reward.id);

    const { data: voucher, error: voucherErr } = await supabase
      .from("issued_rewards")
      .insert({
        id,
        brand_id: BRAND_ID,
        member_id,
        reward_id: reward.id,
        voucher_template_id: voucherTemplateId,
        source_type: "points_redemption",
        source_ref_id: null,
        title: reward.name,
        description: reward.description,
        icon: null,
        category: reward.category,
        discount_type: reward.discount_type,
        discount_value: reward.discount_value,
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
