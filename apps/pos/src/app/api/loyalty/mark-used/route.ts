import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { markVoucherUsed } from "@celsius/shared";

/**
 * POST /api/loyalty/mark-used
 * Body: { member_id, voucher_id, order_id? }
 *
 * Called from register/handleCheckoutComplete after the customer-display
 * deferred-burn flow attached a voucher to the cart. Flips the voucher
 * to status='used' and stamps redeemed_at via the shared
 * markVoucherUsed helper. Idempotent — a second call no-ops.
 */

const BRAND_ID = "brand-celsius";

// issued_rewards is RLS-locked; anon returns no rows.
function getClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
  );
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

    const result = await markVoucherUsed({
      supabase: getClient(),
      voucherId: voucher_id,
      memberId: member_id,
      brandId: BRAND_ID,
    });
    if (!result.ok) {
      console.error("[LOYALTY] mark-used error:", result.error);
      return NextResponse.json({ error: "Failed to mark used" }, { status: 500 });
    }
    return NextResponse.json({
      success: true,
      already_used: result.alreadyUsed,
    });
  } catch (err) {
    console.error("[LOYALTY] mark-used exception:", err);
    return NextResponse.json({ error: "Mark-used failed" }, { status: 500 });
  }
}
