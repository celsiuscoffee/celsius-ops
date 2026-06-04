import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase/server";
import { getTierMultiplier } from "@/lib/loyalty/points";
import { evaluatePromotions, type CartLine } from "@/lib/loyalty/promotions";
import { getOutletSst } from "@/lib/outlet-sst";
import { resolveOrderReward } from "@celsius/shared";

// POST /api/checkout/quote
//
// Read-only price preview for the cart + checkout screens. Mirrors the
// total computation in /api/checkout/initiate (same settings keys,
// same promotion engine, same SST formula, same discount-layering
// order) so the breakdown the customer sees BEFORE paying matches the
// amount the order is actually created + charged for. Creates no
// order and has no side effects.
//
// Body: { items: [{ product:{id}, quantity }], storeId, loyaltyPhone,
//   loyaltyId, rewardDiscountSen?, voucherDiscountSen? }
// Returns sen: { subtotalSen, promoDiscountSen, promoLines[],
//   rewardDiscountSen, firstOrderDiscountSen, sstSen, sstRate,
//   totalSen, pointsToEarn }

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const {
      items,
      storeId,
      loyaltyPhone,
      loyaltyId,
      rewardId = null,
      walletVoucherId = null,
      rewardDiscountSen = 0,
      voucherDiscountSen = 0,
    } = body as {
      items?: Array<{ product?: { id?: string }; product_id?: string; quantity?: number }>;
      storeId?: string | null;
      loyaltyPhone?: string | null;
      loyaltyId?: string | null;
      rewardId?: string | null;
      walletVoucherId?: string | null;
      rewardDiscountSen?: number;
      voucherDiscountSen?: number;
    };

    if (!items?.length) {
      return NextResponse.json({ error: "No items" }, { status: 400 });
    }

    const supabase = getSupabaseAdmin();

    // Product prices (RM) — authoritative, same as initiate.
    const productIds = items
      .map((i) => i.product?.id ?? i.product_id)
      .filter(Boolean) as string[];
    const { data: dbProducts } = await supabase
      .from("products")
      .select("id, price, category")
      .in("id", productIds);
    const priceMap = new Map<string, number>();
    const catMap = new Map<string, string | null>();
    for (const p of (dbProducts ?? []) as Array<{ id: string; price: number; category: string | null }>) {
      priceMap.set(p.id, p.price);
      catMap.set(p.id, p.category);
    }

    // Subtotal in sen — base price × qty. (Modifier deltas are already
    // baked into the client total but for the quote we mirror initiate's
    // base-price subtotal; the reward/promo engines operate on line
    // unit_price too.)
    let subtotalSen = 0;
    const cartLines: CartLine[] = [];
    for (const it of items) {
      const pid = (it.product?.id ?? it.product_id) as string;
      const price = priceMap.get(pid) ?? 0;
      const qty = Number(it.quantity) || 1;
      subtotalSen += Math.round(price * 100) * qty;
      cartLines.push({
        product_id: pid,
        quantity: qty,
        unit_price: price,
        category: catMap.get(pid) ?? undefined,
      });
    }

    // Authoritative reward discount — resolve + compute via the SAME shared
    // resolver /api/checkout/initiate uses, so the previewed deduction equals
    // what the order is actually created with. The client CANNOT compute
    // free_item / category-filtered rewards (e.g. Free Drink): its cart lines
    // carry no product category, so calcRewardDiscount returns 0, the deduction
    // never shows, and the previewed total stays at full price — yet initiate
    // applies the reward server-side (it resolves category from the products
    // table), dropping the real total to 0 and skipping the gateway. Resolve it
    // here the same way. Falls back to the client number when not resolvable.
    let resolvedRewardDiscountSen = Math.round(rewardDiscountSen);
    if (rewardId || walletVoucherId) {
      const enrichedItems = items.map((it) => {
        const pid = (it.product?.id ?? it.product_id) as string;
        const price = priceMap.get(pid) ?? 0;
        const qty = Number(it.quantity) || 1;
        return { product: { id: pid }, productId: pid, quantity: qty, basePrice: price, totalPrice: price * qty };
      });
      const resolved = await resolveOrderReward({
        supabase,
        memberId: loyaltyId ?? null,
        rewardId,
        walletVoucherId,
        items: enrichedItems,
        subtotalSen,
      });
      if (resolved.ok) resolvedRewardDiscountSen = resolved.discountSen;
    }

    // Settings — SST + points rate.
    const { data: settings } = await supabase
      .from("app_settings")
      .select("key, value")
      .in("key", ["points_per_rm", "min_order_value"]);
    const settingsMap = new Map<string, unknown>();
    for (const s of (settings ?? []) as Array<{ key: string; value: unknown }>) {
      settingsMap.set(s.key, s.value);
    }
    // SST is per-outlet — match what /checkout/initiate will charge so the
    // preview total equals the amount the order is actually created for.
    const { enabled: sstEnabled, rate: sstRate } = await getOutletSst(supabase, storeId);
    const pointsPerRm = Number((settingsMap.get("points_per_rm") as { rate?: number } | undefined)?.rate ?? 1);
    const minOrderRm = Number((settingsMap.get("min_order_value") as { rm?: number } | undefined)?.rm ?? 0);

    // First-order discount — lives on the promotions table (same lookup
    // as initiate / orders): most recent active trigger_type=first_order.
    const { data: fodRow } = await supabase
      .from("promotions")
      .select("discount_type, discount_value")
      .eq("brand_id", "brand-celsius")
      .eq("trigger_type", "first_order")
      .eq("is_active", true)
      .order("priority", { ascending: false })
      .limit(1)
      .maybeSingle();
    const fodConfig = fodRow
      ? {
          type: (fodRow.discount_type as string) === "percentage_off" ? "percent" : "fixed",
          amount: Number((fodRow as { discount_value?: number }).discount_value ?? 0),
        }
      : null;

    // First-order discount — first qualifying order on this phone.
    let fodDiscountSen = 0;
    if (fodConfig && loyaltyPhone) {
      const { count } = await supabase
        .from("orders")
        .select("id", { count: "exact", head: true })
        .eq("loyalty_phone", loyaltyPhone)
        .in("status", ["completed", "preparing", "ready", "paid"]);
      if ((count ?? 0) === 0) {
        fodDiscountSen =
          fodConfig.type === "percent"
            ? Math.round(subtotalSen * (fodConfig.amount / 100))
            : Math.round(fodConfig.amount * 100);
      }
    }

    // Member tier → promo eligibility + points multiplier.
    let memberTierId: string | null = null;
    if (loyaltyId) {
      const { data: mb } = await supabase
        .from("member_brands")
        .select("current_tier_id")
        .eq("member_id", loyaltyId)
        .eq("brand_id", "brand-celsius")
        .maybeSingle();
      memberTierId = (mb as { current_tier_id?: string | null } | null)?.current_tier_id ?? null;
    }

    const evaluated = await evaluatePromotions({
      lines: cartLines,
      member_id: loyaltyId ?? null,
      outlet_id: storeId ?? null,
      member_tier_id: memberTierId,
    });
    const promoDiscountSen = Math.round(evaluated.total_discount * 100);
    const promoLines = evaluated.discounts.map((d) => ({
      name: d.promotion_name,
      amountSen: Math.round(d.discount_amount * 100),
    }));

    const afterDiscount = Math.max(
      0,
      subtotalSen -
        Math.round(voucherDiscountSen) -
        resolvedRewardDiscountSen -
        fodDiscountSen -
        promoDiscountSen,
    );
    const sstSen = sstEnabled ? Math.round(afterDiscount * sstRate) : 0;
    const totalSen = afterDiscount + sstSen;
    const basePoints = loyaltyId ? Math.floor((afterDiscount / 100) * pointsPerRm) : 0;
    const tierMul = loyaltyId ? await getTierMultiplier(loyaltyId) : 1;
    const pointsToEarn = Math.round(basePoints * tierMul);

    return NextResponse.json({
      subtotalSen,
      promoDiscountSen,
      promoLines,
      rewardDiscountSen: resolvedRewardDiscountSen,
      firstOrderDiscountSen: fodDiscountSen,
      sstSen,
      sstRate,
      totalSen,
      pointsToEarn,
      minOrderRm,
    });
  } catch (err) {
    console.error("checkout quote error:", err);
    return NextResponse.json({ error: "Failed to quote" }, { status: 500 });
  }
}
