import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase/server";
import { createPayment } from "@/lib/revenue-monster/client";
import { earnLoyaltyPoints, deductLoyaltyPoints } from "@/lib/loyalty/points";
import type { OrderRow } from "@/lib/supabase/types";

// All active payment methods route through Stripe (live keys, MYR).
const DEFAULT_STRIPE_METHODS = new Set(["card", "apple_pay", "google_pay", "fpx", "grabpay"]);
const DEFAULT_RM_METHODS     = new Set<string>();

function generateOrderNumber(): string {
  return `C-${Date.now().toString(36).slice(-4).toUpperCase()}${Math.floor(Math.random() * 100).toString().padStart(2, '0')}`;
}

/**
 * POST /api/checkout/initiate
 *
 * Creates the order in the DB then creates a Stripe PaymentIntent.
 * Returns { orderId, orderNumber, totalSen, clientSecret }
 * so the client can confirm payment directly with Stripe.js (no redirect
 * to Stripe's hosted page).
 */
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
      rewardPointsCost,
      loyaltyPhone,
      loyaltyId,
      notes,
      orderType,
      tableNumber,
    } = body;

    if (!items?.length || !selectedStore || !paymentMethod) {
      return NextResponse.json({ error: "Invalid order data" }, { status: 400 });
    }

    // Load payment gateway config from DB (with fallback to defaults)
    const supabase = getSupabaseAdmin();
    const { data: pgRows } = await supabase
      .from("payment_gateway_config")
      .select("method_id, enabled, provider");

    let STRIPE_METHODS: Set<string>;
    let RM_METHODS:     Set<string>;

    if (pgRows && pgRows.length > 0) {
      STRIPE_METHODS = new Set(
        pgRows.filter((r) => r.enabled && r.provider === "stripe").map((r) => r.method_id as string)
      );
      RM_METHODS = new Set(
        pgRows.filter((r) => r.enabled && r.provider === "revenue_monster").map((r) => r.method_id as string)
      );
    } else {
      STRIPE_METHODS = DEFAULT_STRIPE_METHODS;
      RM_METHODS     = DEFAULT_RM_METHODS;
    }

    // Always route active methods through Stripe
    for (const m of ["fpx", "grabpay", "card", "apple_pay", "google_pay"]) {
      STRIPE_METHODS.add(m);
      RM_METHODS.delete(m);
    }

    if (!STRIPE_METHODS.has(paymentMethod) && !RM_METHODS.has(paymentMethod)) {
      return NextResponse.json({ error: "Payment method not available" }, { status: 400 });
    }

    // ── Server-side price recalculation ──────────────────────────────────
    const typedItems = items as Array<{
      product: { id: string; name: string };
      product_id?: string;
      modifiers: { selections: { groupId: string; groupName: string; optionId: string; label: string; priceDelta: number }[]; specialInstructions?: string };
      quantity: number;
      price?: number;
      totalPrice: number;
    }>;

    const productIds = typedItems.map((item) => item.product?.id ?? item.product_id).filter(Boolean) as string[];
    const { data: dbProducts, error: productsError } = await supabase
      .from("products")
      .select("id, price")
      .in("id", productIds);

    if (productsError || !dbProducts || dbProducts.length === 0) {
      return NextResponse.json({ error: "Failed to verify product prices" }, { status: 400 });
    }

    const priceMap = new Map(dbProducts.map((p: { id: string; price: number }) => [p.id, p.price]));
    let serverSubtotalSen = 0;
    for (const item of typedItems) {
      const pid = item.product?.id ?? item.product_id;
      const dbPrice = priceMap.get(pid!);
      if (dbPrice == null) {
        return NextResponse.json({ error: `Product ${pid} not found` }, { status: 400 });
      }
      // dbPrice is in RM (e.g. 12.90), convert to sen and multiply by quantity
      const modifierDeltaSen = (item.modifiers?.selections ?? []).reduce(
        (sum, s) => sum + Math.round((s.priceDelta ?? 0) * 100), 0
      );
      const unitPriceSen = Math.round(dbPrice * 100) + modifierDeltaSen;
      serverSubtotalSen += unitPriceSen * item.quantity;
    }

    // ── Server-side monetary validation ────────────────────────────────────
    const rawDiscountSen = discountSen ?? 0;
    if (
      rawDiscountSen < 0 ||
      rawDiscountSen > serverSubtotalSen ||
      serverSubtotalSen <= 0
    ) {
      return NextResponse.json({ error: "Invalid order amounts" }, { status: 400 });
    }

    // ── Server-side voucher validation ─────────────────────────────────────
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

    // ── Server-side reward discount validation ────────────────────────────
    let rewardDiscountSenAmt = 0;
    if (rewardId) {
      const { data: rewardConfig } = await supabase
        .from("reward_configs")
        .select("discount_type, discount_value")
        .eq("reward_id", rewardId)
        .single();

      // Reject unknown rewards up front — silently dropping the discount
      // would cause the customer to be charged the pre-reward amount while
      // the UI showed "free".
      if (!rewardConfig) {
        return NextResponse.json(
          { error: "Reward is no longer valid" },
          { status: 400 }
        );
      }

      const { discount_type, discount_value } = rewardConfig;
      if (discount_type === "flat" && discount_value != null) {
        rewardDiscountSenAmt = Math.round(discount_value); // already in sen
      } else if (discount_type === "percent" && discount_value != null) {
        rewardDiscountSenAmt = Math.round(serverSubtotalSen * (discount_value / 100));
      } else if (discount_type === "free_item" || discount_type === "bogo") {
        // For free_item/bogo, the discount is the value of the free item(s)
        // Trust the client value as it depends on which items were selected
        rewardDiscountSenAmt = Math.round(rewardDiscountSen ?? 0);
      }
    }

    // ── Server-side SST calculation ───────────────────────────────────────
    const { data: sstSetting } = await supabase
      .from("app_settings")
      .select("value")
      .eq("key", "sst")
      .single();

    let sstRate = 0.06; // default 6%
    let sstEnabled = true;
    if (sstSetting?.value != null) {
      const val = sstSetting.value as { enabled?: boolean; rate?: number };
      sstEnabled = val.enabled !== false;
      if (val.rate != null) sstRate = val.rate;
    }

    // ── Compute totals server-side ─────────────────────────────────────────
    const orderNumber          = generateOrderNumber();
    const subtotalSen          = serverSubtotalSen;
    const voucherDiscountSen   = Math.round(discountSen ?? 0);
    const afterDiscount        = Math.max(0, subtotalSen - voucherDiscountSen - rewardDiscountSenAmt);
    const sstSen               = sstEnabled ? Math.round(afterDiscount * sstRate) : 0;
    const totalSen             = afterDiscount + sstSen;
    const pointsToEarn         = loyaltyId ? Math.floor(afterDiscount / 100) : 0;

    // ── Create order ───────────────────────────────────────────────────────
    const storedPaymentMethod = (paymentMethod === "apple_pay" || paymentMethod === "google_pay")
      ? "wallet"
      : paymentMethod;

    const { data, error: orderError } = await supabase
      .from("orders")
      .insert({
        order_number:           orderNumber,
        store_id:               selectedStore.id,
        status:                 "pending",
        payment_method:         storedPaymentMethod,
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
        notes:                  notes ?? null,
        order_type:             orderType ?? "pickup",
        table_number:           tableNumber ?? null,
      })
      .select()
      .single();

    if (orderError || !data) {
      console.error("Order insert error:", orderError);
      return NextResponse.json({ error: "Failed to create order" }, { status: 500 });
    }

    const order = data as OrderRow;

    // ── Insert order items ─────────────────────────────────────────────────
    const orderItems = (items as Array<{
      product:    { id: string; name: string };
      modifiers:  { selections: { groupId: string; groupName: string; optionId: string; label: string; priceDelta: number }[]; specialInstructions?: string };
      quantity:   number;
      totalPrice: number;
    }>).map((item) => ({
      order_id:     order.id,
      product_id:   item.product.id,
      product_name: item.product.name,
      variant_name: null,
      unit_price:   Math.round((item.totalPrice / item.quantity) * 100),
      quantity:     item.quantity,
      item_total:   Math.round(item.totalPrice * 100),
      modifiers: {
        selections:          item.modifiers.selections ?? [],
        specialInstructions: item.modifiers.specialInstructions ?? undefined,
      },
    }));

    const { error: itemsError } = await supabase.from("order_items").insert(orderItems);
    if (itemsError) console.error("Order items error:", itemsError);

    if (voucherId) {
      await supabase.rpc("increment_voucher_count", { voucher_id: voucherId });
    }

    // Points deduction (reward) happens post-payment in webhook/confirm-stripe
    // to avoid deducting on abandoned payments.

    // ── Zero-total bypass (fully-covered reward redemption) ────────────────
    // Stripe rejects zero-amount PaymentIntents. If discounts fully cover the
    // bill, skip the gateway and advance the order to "preparing" so it lands
    // on KDS immediately. Loyalty earn/deduct runs here since there is no
    // webhook / confirm-stripe callback to trigger it later.
    if (totalSen === 0) {
      await supabase
        .from("orders")
        .update({ status: "preparing" } as Record<string, unknown>)
        .eq("id", order.id);

      if (loyaltyId) {
        if (pointsToEarn > 0) {
          earnLoyaltyPoints(loyaltyId, order.id, pointsToEarn, order.store_id);
        }
        if (rewardId) {
          deductLoyaltyPoints(loyaltyId, rewardId, order.store_id);
        }
      }

      return NextResponse.json({
        orderId:     order.id,
        orderNumber: order.order_number,
        totalSen:    0,
        freeOrder:   true,
      });
    }

    // ── Stripe PaymentIntent ───────────────────────────────────────────────
    if (STRIPE_METHODS.has(paymentMethod)) {
      const key = process.env.STRIPE_SECRET_KEY?.trim();
      if (!key) {
        await supabase.from("orders").update({ status: "failed" } as Record<string, unknown>).eq("id", order.id);
        return NextResponse.json({ error: "Stripe not configured" }, { status: 500 });
      }

      // Map app method → Stripe payment_method_types for the PaymentIntent.
      // apple_pay / google_pay use "card" — Stripe.js detects wallets on the client.
      const STRIPE_TYPE_MAP: Record<string, string> = {
        fpx:        "fpx",
        grabpay:    "grabpay",
        card:       "card",
        apple_pay:  "card",
        google_pay: "card",
      };
      const stripeMethodTypes = [STRIPE_TYPE_MAP[paymentMethod] ?? "card"];

      const params = new URLSearchParams({
        amount:                  String(totalSen),
        currency:                "myr",
        "metadata[orderId]":     order.id,
        "metadata[orderNumber]": order.order_number,
        "metadata[storeId]":     selectedStore.id ?? "",
      });
      stripeMethodTypes.forEach((m) => params.append("payment_method_types[]", m));

      const intentRes = await fetch("https://api.stripe.com/v1/payment_intents", {
        method:  "POST",
        headers: {
          "Authorization": `Bearer ${key}`,
          "Content-Type":  "application/x-www-form-urlencoded",
        },
        body: params,
      });

      const intentData = await intentRes.json() as { client_secret?: string; error?: { message: string } };

      if (!intentRes.ok || !intentData.client_secret) {
        await supabase.from("orders").update({ status: "failed" } as Record<string, unknown>).eq("id", order.id);
        return NextResponse.json({ error: intentData.error?.message ?? "Stripe error" }, { status: 500 });
      }

      return NextResponse.json({
        orderId:      order.id,
        orderNumber:  order.order_number,
        totalSen,
        clientSecret: intentData.client_secret,
      });
    }

    // ── Revenue Monster fallback (not currently used) ──────────────────────
    const baseUrl = (process.env.NEXT_PUBLIC_BASE_URL ?? "https://order.celsiuscoffee.com").trim();
    try {
      const paymentUrl = await createPayment({
        orderId:       order.id,
        orderNumber:   order.order_number,
        storeId:       order.store_id,
        amountSen:     totalSen,
        paymentMethod,
        redirectUrl:   `${baseUrl}/order/${order.id}?payment=done`,
        notifyUrl:     `${baseUrl}/api/payments/webhook`,
      });

      return NextResponse.json({
        orderId:     order.id,
        orderNumber: order.order_number,
        totalSen,
        paymentType: "redirect",
        paymentUrl,
      });
    } catch (rmErr) {
      await supabase.from("orders").update({ status: "failed" } as Record<string, unknown>).eq("id", order.id);
      const msg = rmErr instanceof Error ? rmErr.message : "Payment gateway error";
      console.error("RM payment error:", msg);
      return NextResponse.json({ error: msg }, { status: 502 });
    }
  } catch (err) {
    console.error("Checkout initiate error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
