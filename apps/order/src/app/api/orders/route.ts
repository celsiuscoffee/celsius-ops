import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase/server";
import type { OrderRow } from "@/lib/supabase/types";

// GET /api/orders?phone=+60123456789 — fetch orders by customer phone
export async function GET(request: NextRequest) {
  const phone = request.nextUrl.searchParams.get("phone");
  if (!phone) return NextResponse.json({ error: "Missing phone" }, { status: 400 });

  const supabase = getSupabaseAdmin();
  const { data, error } = await supabase
    .from("orders")
    .select("*, order_items(*)")
    .eq("customer_phone", phone)
    .neq("status", "failed")
    .order("created_at", { ascending: false })
    .limit(30);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json(data ?? []);
}

// .trim() guards against accidental trailing newlines in env var values
const LOYALTY_BASE = (process.env.LOYALTY_BASE_URL ?? "https://loyalty.celsiuscoffee.com").trim();
const LOYALTY_BRAND_ID = (process.env.LOYALTY_BRAND_ID ?? "brand-celsius").trim();

function generateOrderNumber(): string {
  return `C-${String(Math.floor(Math.random() * 9999)).padStart(4, "0")}`;
}

/** Deduct points for a redeemed reward. Fire-and-forget — order succeeds regardless. */
async function deductLoyaltyPoints(loyaltyId: string, rewardId: string, orderId: string, points: number) {
  try {
    await fetch(`${LOYALTY_BASE}/api/transactions`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        brand_id:     LOYALTY_BRAND_ID,
        member_id:    loyaltyId,
        type:         "redeem",
        points,
        reference_id: orderId,
        description:  `Reward redeemed: ${rewardId}`,
      }),
    });
  } catch (err) {
    console.error("Loyalty deduct points error:", err);
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const {
      items,
      selectedStore,
      paymentMethod,
      total,
      sst,
      discountSen,
      voucherCode,
      voucherId,
      rewardDiscountSen,
      rewardId,
      rewardName,
      loyaltyPhone,
      loyaltyId,
    } = body;

    if (!items?.length || !selectedStore || !paymentMethod) {
      return NextResponse.json({ error: "Invalid order data" }, { status: 400 });
    }

    const supabase = getSupabaseAdmin();

    // Server-side voucher validation: check active, not expired, not over max_uses
    if (voucherId) {
      const { data: voucher } = await supabase
        .from("vouchers")
        .select("id, is_active, expires_at, max_uses, used_count")
        .eq("id", voucherId)
        .single();

      if (!voucher || !voucher.is_active) {
        return NextResponse.json({ error: "Voucher is no longer valid" }, { status: 400 });
      }
      if (voucher.expires_at && new Date(voucher.expires_at) < new Date()) {
        return NextResponse.json({ error: "Voucher has expired" }, { status: 400 });
      }
      if (voucher.max_uses != null && voucher.used_count >= voucher.max_uses) {
        return NextResponse.json({ error: "Voucher usage limit reached" }, { status: 400 });
      }
    }

    const orderNumber        = generateOrderNumber();
    const subtotalSen        = Math.round(total * 100);
    const voucherDiscountSen = Math.round(discountSen ?? 0);
    const rewardDiscountSenAmt = Math.round(rewardDiscountSen ?? 0);
    const totalDiscountSen   = voucherDiscountSen + rewardDiscountSenAmt;
    const afterDiscount      = Math.max(0, subtotalSen - totalDiscountSen);
    const sstSen             = Math.round(sst != null ? sst * 100 : afterDiscount * 0.06);
    const totalSen           = afterDiscount + sstSen;

    // Points to earn = 1 pt per RM1 of after-discount subtotal
    const pointsToEarn = loyaltyId ? Math.floor(afterDiscount / 100) : 0;

    const { data, error: orderError } = await supabase
      .from("orders")
      .insert({
        order_number:           orderNumber,
        store_id:               selectedStore.id,
        status:                 "pending",
        payment_method:         paymentMethod,
        subtotal:               subtotalSen,
        discount_amount:        voucherDiscountSen,
        voucher_code:           voucherCode ?? null,
        reward_discount_amount: rewardDiscountSenAmt,
        reward_id:              rewardId ?? null,
        reward_name:            rewardName ?? null,
        sst_amount:             sstSen,
        total:                  totalSen,
        customer_phone:         loyaltyPhone ?? null,
        loyalty_phone:          loyaltyPhone ?? null,
        loyalty_id:             loyaltyId ?? null,
        loyalty_points_earned:  pointsToEarn,
      })
      .select()
      .single();

    if (orderError || !data) {
      console.error("Order insert error:", orderError);
      return NextResponse.json({ error: "Failed to create order" }, { status: 500 });
    }

    const order = data as OrderRow;

    const orderItems = (items as Array<{
      product: { id: string; name: string };
      modifiers: { selections: { groupId: string; groupName: string; optionId: string; label: string; priceDelta: number }[]; specialInstructions?: string };
      quantity: number;
      totalPrice: number;
    }>).map((item) => ({
      order_id:     order.id,
      product_id:   item.product.id,
      product_name: item.product.name,
      variant_name: null,
      unit_price:   Math.round((item.totalPrice / item.quantity) * 100),
      quantity:     item.quantity,
      item_total:   Math.round(item.totalPrice * 100),
      modifiers:    {
        selections:           item.modifiers.selections ?? [],
        specialInstructions:  item.modifiers.specialInstructions ?? undefined,
      },
    }));

    const { error: itemsError } = await supabase.from("order_items").insert(orderItems);
    if (itemsError) console.error("Order items error:", itemsError);

    // Increment voucher used_count atomically via RPC
    if (voucherId) {
      await supabase.rpc("increment_voucher_count", { voucher_id: voucherId });
    }

    // Deduct loyalty points for redeemed reward (fire-and-forget)
    if (rewardId && loyaltyId && rewardDiscountSenAmt > 0) {
      // Find the reward points cost from the request body (passed as rewardPointsCost)
      const rewardPointsCost: number = body.rewardPointsCost ?? 0;
      if (rewardPointsCost > 0) {
        deductLoyaltyPoints(loyaltyId, rewardId, order.id, rewardPointsCost);
      }
    }

    return NextResponse.json({
      orderId:     order.id,
      orderNumber: order.order_number,
      status:      order.status,
      totalSen,
    });
  } catch (err) {
    console.error("Create order error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
