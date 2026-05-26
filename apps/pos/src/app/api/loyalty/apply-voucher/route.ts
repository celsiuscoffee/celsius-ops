import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

/**
 * POST /api/loyalty/apply-voucher
 * Body: { member_id, voucher_id }
 *
 * Resolves an active issued_rewards row for a member and returns a
 * discount payload the POS cart can apply. Does NOT mark the voucher
 * as used — that's deferred until the order actually completes
 * (handleCheckoutComplete on the register, which calls /mark-used).
 * This way a customer who taps a voucher before payment doesn't lose
 * it if the cashier voids the order.
 */

const BRAND_ID = "brand-celsius";

// issued_rewards is RLS-locked; anon returns no rows.
function getClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
  );
}

// Normalise the v2 voucher_templates discount vocabulary to the POS
// cart's vocabulary. Mirrors what /api/loyalty/redeem builds for
// catalog rewards so the register's onRedeem handler can stay one shape.
function buildDiscount(row: any) {
  const raw = row.discount_type as string | null;
  if (!raw) {
    // Pure free-item voucher with no discount_type set — fall back to free_item if name suggests it.
    if (row.free_product_name) {
      return {
        type: "free_item",
        value: 0,
        max_discount: null,
        min_order: row.min_order_value !== null ? Number(row.min_order_value) : null,
        applicable_products: row.applicable_products ?? null,
        applicable_categories: row.applicable_categories ?? null,
        free_product_ids: null,
        free_product_name: row.free_product_name,
      };
    }
    return {
      type: "manual",
      value: 0,
      max_discount: null,
      min_order: null,
      applicable_products: null,
      applicable_categories: null,
      free_product_ids: null,
      free_product_name: null,
      note: row.title,
    };
  }

  const type =
    raw === "flat"
      ? "fixed_amount"
      : raw === "percent"
        ? "percentage"
        : raw === "beans_multiplier"
          ? "manual"
          : raw; // free_item / fixed_amount / percentage pass-through

  return {
    type,
    value: row.discount_value !== null ? Number(row.discount_value) : 0,
    max_discount: null,
    min_order: row.min_order_value !== null ? Number(row.min_order_value) : null,
    applicable_products: row.applicable_products ?? null,
    applicable_categories: row.applicable_categories ?? null,
    free_product_ids: null,
    free_product_name: row.free_product_name ?? null,
  };
}

export async function POST(req: NextRequest) {
  try {
    const { member_id, voucher_id } = await req.json();
    if (!member_id || !voucher_id) {
      return NextResponse.json(
        { error: "member_id and voucher_id required" },
        { status: 400 },
      );
    }

    const supabase = getClient();
    const { data: voucher, error } = await supabase
      .from("issued_rewards")
      .select(
        "id, status, expires_at, title, description, icon, category, discount_type, discount_value, min_order_value, applicable_categories, applicable_products, free_product_name, stacks_with_beans",
      )
      .eq("id", voucher_id)
      .eq("member_id", member_id)
      .eq("brand_id", BRAND_ID)
      .single();

    if (error || !voucher) {
      return NextResponse.json({ error: "Voucher not found" }, { status: 404 });
    }
    if (voucher.status !== "active") {
      return NextResponse.json({ error: "Voucher is not active" }, { status: 410 });
    }
    if (voucher.expires_at && new Date(voucher.expires_at).getTime() < Date.now()) {
      return NextResponse.json({ error: "Voucher has expired" }, { status: 410 });
    }

    return NextResponse.json({
      voucher_id: voucher.id,
      voucher_name: voucher.title,
      discount: buildDiscount(voucher),
    });
  } catch (err) {
    console.error("[LOYALTY] apply-voucher error:", err);
    return NextResponse.json({ error: "Apply failed" }, { status: 500 });
  }
}
