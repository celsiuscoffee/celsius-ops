import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase/server";

// POST /api/vouchers/validate
// Body: { code: string, subtotalSen: number }
// Returns: { valid, discountSen, discountLabel, voucherId, message }
export async function POST(request: NextRequest) {
  try {
    const { code, subtotalSen } = await request.json();

    if (!code || typeof subtotalSen !== "number") {
      return NextResponse.json({ valid: false, message: "Invalid request" }, { status: 400 });
    }

    const supabase = getSupabaseAdmin();

    const { data: voucher, error } = await supabase
      .from("vouchers")
      .select("*")
      .eq("code", (code as string).toUpperCase().trim())
      .single();

    if (error || !voucher) {
      return NextResponse.json({ valid: false, message: "Promo code not found" });
    }

    if (!voucher.is_active) {
      return NextResponse.json({ valid: false, message: "This promo code is no longer active" });
    }

    if (voucher.expires_at && new Date(voucher.expires_at) < new Date()) {
      return NextResponse.json({ valid: false, message: "This promo code has expired" });
    }

    if (subtotalSen < voucher.min_order_sen) {
      const minRM = (voucher.min_order_sen / 100).toFixed(2);
      return NextResponse.json({
        valid: false,
        message: `Minimum order of RM ${minRM} required`,
      });
    }

    if (voucher.max_uses !== null && voucher.used_count >= voucher.max_uses) {
      return NextResponse.json({ valid: false, message: "This promo code has reached its usage limit" });
    }

    // Calculate discount
    let discountSen: number;
    let discountLabel: string;

    if (voucher.discount_type === "percent") {
      discountSen = Math.round(subtotalSen * (voucher.discount_value / 100));
      discountLabel = `${voucher.discount_value}% off`;
    } else {
      // flat discount in sen
      discountSen = Math.min(voucher.discount_value, subtotalSen);
      discountLabel = `RM ${(voucher.discount_value / 100).toFixed(2)} off`;
    }

    return NextResponse.json({
      valid: true,
      discountSen,
      discountLabel,
      voucherId: voucher.id,
      description: voucher.description,
      message: voucher.description ?? `${discountLabel} applied!`,
    });
  } catch (err) {
    console.error("Voucher validate error:", err);
    return NextResponse.json({ valid: false, message: "Something went wrong" }, { status: 500 });
  }
}
