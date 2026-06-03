import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase/server";
import { requireMinAppVersion } from "@/lib/min-app-version";
import { createPayment } from "@/lib/revenue-monster/client";
import { earnLoyaltyPoints, deductLoyaltyPoints, getTierMultiplier } from "@/lib/loyalty/points";
import {
  evaluatePromotions,
  recordPromotionApplications,
  type CartLine,
} from "@/lib/loyalty/promotions";
import type { OrderRow } from "@/lib/supabase/types";
import { defaultMethodSets } from "@/lib/payments/gateway-methods";
import { getOutletSst } from "@/lib/outlet-sst";
import { computeVoucherDiscount } from "@celsius/shared";
import {
  DISCOUNT_SPEC_COLUMNS,
  type DiscountSpecRow,
  rowToDiscountSpec,
  buildEngineCart,
} from "@/lib/loyalty/discount-spec";

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
      // rewardDiscountSen (client-claimed) intentionally ignored — the
      // reward discount is recomputed server-side via the shared engine.
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

    // Quantity bounds + cart-line cap (mirrors /api/orders).
    const MAX_QTY_PER_LINE = 50;
    const MAX_LINES        = 30;
    if (items.length > MAX_LINES) {
      return NextResponse.json({ error: "Too many cart lines" }, { status: 400 });
    }
    for (const it of items as Array<{ quantity?: unknown }>) {
      const q = Number(it?.quantity);
      if (!Number.isFinite(q) || !Number.isInteger(q) || q < 1 || q > MAX_QTY_PER_LINE) {
        return NextResponse.json({ error: "Invalid quantity" }, { status: 400 });
      }
    }

    // Reject sub-min builds when forceUpdate is on (PWA + headerless
    // clients still pass through — see lib/min-app-version.ts).
    {
      const blocked = await requireMinAppVersion(request);
      if (blocked) return blocked;
    }

    const supabase = getSupabaseAdmin();

    // Maintenance mode — server-authoritative. Mirrors /api/orders so
    // a stale or bypassed PWA client can't create orders while the
    // backoffice has online ordering paused.
    {
      const { data: maint } = await supabase
        .from("app_settings")
        .select("value")
        .eq("key", "maintenance")
        .maybeSingle();
      const m = (maint?.value ?? null) as { enabled?: boolean; message?: string } | null;
      if (m?.enabled === true) {
        return NextResponse.json(
          { error: m.message?.trim() || "Online ordering is paused for maintenance. Please try again shortly." },
          { status: 503 },
        );
      }
    }

    // Outlet must exist and be active.
    const storeId = String(selectedStore?.id ?? "");
    if (!storeId) {
      return NextResponse.json({ error: "Missing outlet" }, { status: 400 });
    }
    {
      const { data: outletRow } = await supabase
        .from("outlet_settings")
        .select("store_id, is_active, is_open")
        .eq("store_id", storeId)
        .maybeSingle();
      if (!outletRow || outletRow.is_active === false) {
        return NextResponse.json({ error: "Outlet is not accepting orders" }, { status: 400 });
      }
      // is_open is the manual "we're closed right now" toggle. Distinct
      // from is_active (administrative) — the backoffice flips this from
      // /pickup/settings when the outlet wants to stop taking orders
      // without removing themselves from the system entirely.
      if (outletRow.is_open === false) {
        return NextResponse.json(
          { error: "Outlet is currently closed for orders" },
          { status: 400 },
        );
      }
    }

    // Load payment gateway config from DB (with fallback to defaults)
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
      const defaults = defaultMethodSets();
      STRIPE_METHODS = defaults.stripe;
      RM_METHODS     = defaults.rm;
    }

    // Per-method routing is now authoritative: whatever provider the
    // backoffice picked for each method_id is what we use. The earlier
    // hardcoded "force everything to Stripe" loop here meant the admin
    // toggle in /pickup/settings was effectively a no-op for card,
    // wallets, FPX, and GrabPay — they always went to Stripe regardless.
    // Keep no provider override; trust the DB.

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

    // ── Backoffice settings — single batch read so we don't fire one
    //    Supabase round-trip per setting. Same shape /api/orders uses
    //    so both order paths read from the same source of truth.
    const { data: settingsRows } = await supabase
      .from("app_settings")
      .select("key, value")
      .in("key", ["points_per_rm", "min_order_value"]);
    const settingsMap = new Map((settingsRows ?? []).map((r) => [r.key, r.value]));
    const pointsPerRm  = Number((settingsMap.get("points_per_rm") as any)?.rate ?? 1);
    const minOrderRm   = Number((settingsMap.get("min_order_value") as any)?.rm ?? 0);

    // SST is PER-OUTLET now — a pickup/web/QR order charges the SAME tax as the
    // in-store register for that outlet (resolved from pos_branch_settings).
    const outletSst = await getOutletSst(supabase, storeId);

    // First-order discount lives on the promotions table now (see
    // orders/route.ts for the same lookup). Reads the most recent
    // active row with trigger_type='first_order'.
    const { data: fodRow } = await supabase
      .from("promotions")
      .select("discount_type, discount_value, is_active")
      .eq("brand_id", "brand-celsius")
      .eq("trigger_type", "first_order")
      .eq("is_active", true)
      .order("priority", { ascending: false })
      .limit(1)
      .maybeSingle();
    const fodConfig = fodRow
      ? {
          enabled: true,
          type: (fodRow.discount_type as string) === "percentage_off" ? "percent" : "fixed",
          amount: Number(fodRow.discount_value ?? 0),
        }
      : undefined;

    // ── Server-side monetary validation ────────────────────────────────────
    const rawDiscountSen = discountSen ?? 0;
    if (
      rawDiscountSen < 0 ||
      rawDiscountSen > serverSubtotalSen ||
      serverSubtotalSen <= 0
    ) {
      return NextResponse.json({ error: "Invalid order amounts" }, { status: 400 });
    }
    if (minOrderRm > 0 && total < minOrderRm) {
      return NextResponse.json(
        { error: `Minimum order is RM${minOrderRm.toFixed(2)}` },
        { status: 400 },
      );
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

    // ── Server-side reward discount (AUTHORITATIVE via shared engine) ─────
    // Resolve the canonical voucher_templates spec by legacy_reward_id and
    // recompute through @celsius/shared computeVoucherDiscount — the SAME
    // path as /api/orders, covering all 9 discount types. Replaces the old
    // reward_configs flat/percent-inline + trust-client logic, so this
    // web / QR-table PWA checkout matches every other channel and a stale
    // or malicious client can't claim a discount the reward doesn't grant.
    let rewardDiscountSenAmt = 0;
    if (rewardId) {
      const { data: tmpl } = await supabase
        .from("voucher_templates")
        .select(DISCOUNT_SPEC_COLUMNS)
        .eq("legacy_reward_id", rewardId)
        .eq("is_active", true)
        .maybeSingle<DiscountSpecRow>();
      // Reject unknown/inactive rewards — silently dropping the discount
      // would charge the pre-reward amount while the UI showed it applied.
      if (!tmpl) {
        return NextResponse.json({ error: "Reward is no longer valid" }, { status: 400 });
      }
      const spec = rowToDiscountSpec(tmpl);
      const cart = await buildEngineCart(
        supabase,
        items,
        !!(spec.applicable_categories && spec.applicable_categories.length),
      );
      const result = computeVoucherDiscount({ spec, cart });
      rewardDiscountSenAmt = Math.max(0, Math.min(serverSubtotalSen, result.discount_sen));
    }

    // ── Server-side SST calculation ───────────────────────────────────────
    // Pulled from the batched settings read above. The client-supplied
    // SST is server-authoritative + per-outlet (resolved above from the
    // ordering outlet's pos_branch_settings), so a stale or malicious client
    // can't change the tax. The payload `sst` is ignored.
    const sstEnabled = outletSst.enabled;
    const sstRate    = outletSst.rate;
    void sst; // accepted in payload for backward-compat; intentionally unused

    // ── First-order discount ──────────────────────────────────────────────
    // Mirrors /api/orders: customer's first completed/preparing/ready/paid
    // order on this loyalty_phone gets a single welcome bump. Phone is the
    // identity here — loyaltyId may be null for guest checkouts but a phone
    // is always set.
    let fodDiscountSen = 0;
    if (fodConfig?.enabled && loyaltyPhone) {
      const { count } = await supabase
        .from("orders")
        .select("id", { count: "exact", head: true })
        .eq("loyalty_phone", loyaltyPhone)
        .in("status", ["completed", "preparing", "ready", "paid"]);
      if ((count ?? 0) === 0) {
        fodDiscountSen = fodConfig.type === "percent"
          ? Math.round(serverSubtotalSen * (fodConfig.amount / 100))
          : Math.round(fodConfig.amount * 100);
      }
    }

    // ── Resolve member tier (used for promo eligibility and points) ───────
    let memberTierId: string | null = null;
    if (loyaltyId) {
      const { data: mb } = await supabase
        .from("member_brands")
        .select("current_tier_id, tiers(multiplier)")
        .eq("member_id", loyaltyId)
        .eq("brand_id", "brand-celsius")
        .single();
      memberTierId = (mb as { current_tier_id?: string | null } | null)?.current_tier_id ?? null;
    }

    // ── Evaluate promotion engine ─────────────────────────────────────────
    // Auto-apply, tier-perk, and reward-link promotions flow through
    // here. Customer-typed promo codes were removed end-to-end. Voucher
    // (legacy) and reward discounts stay separate since they predate
    // the engine.
    const cartLinesBare = typedItems.map((item) => ({
      product_id: (item.product?.id ?? item.product_id) as string,
      quantity: item.quantity,
      unit_price: priceMap.get((item.product?.id ?? item.product_id) as string) ?? 0,
    }));
    // Categories needed for category-gated combos. Same pattern as
    // /api/orders — server-side lookup so the client can't spoof.
    const productIdsForCategory = Array.from(
      new Set(cartLinesBare.map((l) => l.product_id).filter(Boolean)),
    );
    const categoryByProductId = new Map<string, string | null>();
    if (productIdsForCategory.length > 0) {
      const { data: catRows } = await supabase
        .from("products")
        .select("id, category")
        .in("id", productIdsForCategory);
      for (const p of ((catRows ?? []) as Array<{ id: string; category: string | null }>)) {
        categoryByProductId.set(p.id, p.category);
      }
    }
    const cartLines: CartLine[] = cartLinesBare.map((l) => ({
      ...l,
      category: categoryByProductId.get(l.product_id) ?? undefined,
    }));
    const evaluated = await evaluatePromotions({
      lines: cartLines,
      member_id: loyaltyId,
      outlet_id: selectedStore.id,
      member_tier_id: memberTierId,
    });
    const promoDiscountSen = Math.round(evaluated.total_discount * 100);

    // ── Compute totals server-side ─────────────────────────────────────────
    const orderNumber          = generateOrderNumber();
    const subtotalSen          = serverSubtotalSen;
    const voucherDiscountSen   = Math.round(discountSen ?? 0);
    const afterDiscount        = Math.max(
      0,
      subtotalSen - voucherDiscountSen - rewardDiscountSenAmt - fodDiscountSen - promoDiscountSen
    );
    const sstSen               = sstEnabled ? Math.round(afterDiscount * sstRate) : 0;
    const totalSen             = afterDiscount + sstSen;
    // Base points = pointsPerRm × RM of after-discount subtotal. Then
    // multiply by tier. Mirrors /api/orders so the two flows credit the
    // same number of points for the same cart.
    const basePoints           = loyaltyId ? Math.floor((afterDiscount / 100) * pointsPerRm) : 0;
    const tierMul              = loyaltyId ? await getTierMultiplier(loyaltyId) : 1;
    const pointsToEarn         = Math.round(basePoints * tierMul);

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
        first_order_discount_amount: fodDiscountSen,
        // Promotion-engine discounts persisted so the order detail
        // screen can render the same breakdown the /api/orders flow
        // already does. Without this, the PWA's order page showed a
        // bare total with no line explaining the gap.
        promo_discount:         promoDiscountSen,
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

    // Record applied promotions to the loyalty ledger so usage caps and
    // reporting work. Fire-and-forget — order success isn't gated on this.
    void recordPromotionApplications({
      evaluated,
      member_id: loyaltyId ?? null,
      outlet_id: selectedStore.id,
      reference_id: order.id,
      lines: cartLines,
      member_tier_id: memberTierId,
    });

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

    // ── Revenue Monster (card / FPX / TNG / Boost / ShopeePay) ─────────────
    // Sends the customer to RM's hosted page (card / FPX) or a wallet deep
    // link (TNG / Boost / ShopeePay). createPayment returns BOTH the URL and
    // the RM checkoutId, so we MUST destructure — the previous code assigned
    // the whole { paymentUrl, checkoutId } object to `paymentUrl`, so the
    // client redirected to "[object Object]" and RM checkout never opened.
    // We also stash the checkoutId so the order page can poll RM for the
    // result (webhook delivery is best-effort in Direct mode), matching the
    // native pickup app's /api/payments/create path.
    const baseUrl = (process.env.NEXT_PUBLIC_BASE_URL ?? "https://order.celsiuscoffee.com").trim();
    try {
      const { paymentUrl, checkoutId } = await createPayment({
        orderId:       order.id,
        orderNumber:   order.order_number,
        storeId:       order.store_id,
        amountSen:     totalSen,
        paymentMethod,
        redirectUrl:   `${baseUrl}/order/${order.id}?payment=done`,
        notifyUrl:     `${baseUrl}/api/payments/webhook`,
      });

      await supabase
        .from("orders")
        .update({ payment_checkout_id: checkoutId } as Record<string, unknown>)
        .eq("id", order.id);

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
