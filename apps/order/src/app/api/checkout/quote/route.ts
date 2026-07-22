import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase/server";
import { getTierMultiplier } from "@/lib/loyalty/points";
import { evaluatePromotions, channelForOrderType, type CartLine } from "@/lib/loyalty/promotions";
import { reconcileNonStackTier } from "@/lib/loyalty/non-stack-tier";
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
      loyaltyId,
      rewardId = null,
      walletVoucherId = null,
      rewardDiscountSen = 0,
      voucherDiscountSen = 0,
      orderType = null,
    } = body as {
      items?: Array<{ product?: { id?: string }; product_id?: string; quantity?: number }>;
      storeId?: string | null;
      loyaltyPhone?: string | null;
      loyaltyId?: string | null;
      rewardId?: string | null;
      walletVoucherId?: string | null;
      rewardDiscountSen?: number;
      voucherDiscountSen?: number;
      orderType?: string | null;
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

    // First-order discount is a native-app-only perk (applied in /api/orders,
    // gated on app_ios / app_android source). This quote powers the web/PWA
    // checkout preview, which never gets the discount, so it always previews
    // zero — keeping the preview equal to what /api/checkout/initiate charges.
    const fodDiscountSen = 0;

    // Member tier → promo eligibility + points multiplier.
    let memberTierId: string | null = null;
    let memberTierStackable = true;
    if (loyaltyId) {
      const { data: mb } = await supabase
        .from("member_brands")
        .select("current_tier_id, tiers(stackable)")
        .eq("member_id", loyaltyId)
        .eq("brand_id", "brand-celsius")
        .maybeSingle();
      memberTierId = (mb as { current_tier_id?: string | null } | null)?.current_tier_id ?? null;
      const tierRow = (mb as { tiers?: { stackable?: boolean | null } | null } | null)?.tiers;
      memberTierStackable = (tierRow?.stackable as boolean | null) ?? true;
    }

    const evaluated = await evaluatePromotions({
      lines: cartLines,
      member_id: loyaltyId ?? null,
      outlet_id: storeId ?? null,
      member_tier_id: memberTierId,
      channel: channelForOrderType(orderType),
    });
    // Non-stackable tier exclusivity — best single offer wins (mirrors
    // /api/orders + the POS register), so the quoted total matches what's
    // charged for a Black Card / Staff member.
    const recv = reconcileNonStackTier({
      stackable: memberTierStackable,
      evaluatedTotalSen: Math.round(evaluated.total_discount * 100),
      tierPerkSen: Math.round((evaluated.discounts.find((d) => d.reason === "tier_perk")?.discount_amount ?? 0) * 100),
      voucherSen: Math.round(voucherDiscountSen),
      rewardSen: resolvedRewardDiscountSen,
      fodSen: fodDiscountSen,
    });
    const promoDiscountSen = recv.promoDiscountSen;
    const shownDiscounts = recv.droppedTierPerk
      ? evaluated.discounts.filter((d) => d.reason !== "tier_perk")
      : recv.droppedWallet
        ? evaluated.discounts.filter((d) => d.reason === "tier_perk")
        : evaluated.discounts;
    const promoLines = shownDiscounts.map((d) => ({
      name: d.promotion_name,
      amountSen: Math.round(d.discount_amount * 100),
    }));

    const afterDiscount = Math.max(
      0,
      subtotalSen - recv.voucherSen - recv.rewardSen - recv.fodSen - promoDiscountSen,
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
      rewardDiscountSen: recv.rewardSen,
      firstOrderDiscountSen: recv.fodSen,
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
