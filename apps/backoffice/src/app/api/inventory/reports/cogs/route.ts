import { NextResponse, NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAuth } from "@/lib/auth";

// StoreHub sales carry no per-item fulfillment channel, so channel-scoped
// packaging (a takeaway-only cup, a dine-in-only tissue) is blended by an
// assumed takeaway share. ALL lines are always billed. Tier 2 replaces this
// blend with the exact per-line split from pos_order_items.fulfillment.
const DEFAULT_TAKEAWAY_RATIO = 0.5;

export async function GET(req: NextRequest) {
  const auth = await requireAuth(req);
  if (auth.error) return auth.error;
  try {
    const { searchParams } = new URL(req.url);
    const outletId = searchParams.get("outletId");
    const now = new Date();
    const defaultFrom = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
    const from = searchParams.get("from")
      ? new Date(searchParams.get("from")!)
      : defaultFrom;
    const to = searchParams.get("to")
      ? new Date(searchParams.get("to")!)
      : now;

    // 1. Fetch sales transactions within date range
    const salesWhere: Record<string, unknown> = {
      transactedAt: { gte: from, lte: to },
    };
    if (outletId) salesWhere.outletId = outletId;

    // Project only the columns we actually use (menuId, outletId,
    // quantity, grossAmount). Without this, Prisma returns every
    // column on every SalesTransaction in the date range — for
    // 30-day windows that's been ~2M rows of unused payload, which
    // was the single biggest disk-IO consumer per pg_stat_statements.
    const sales = await prisma.salesTransaction.findMany({
      where: salesWhere,
      select: {
        menuId: true,
        outletId: true,
        quantity: true,
        grossAmount: true,
      },
    });

    // 2. Fetch all menu BOM lines (ingredients + packaging)
    const menuIngredients = await prisma.menuIngredient.findMany({
      include: {
        menu: { select: { id: true, name: true, category: true } },
        product: { select: { id: true, name: true, baseUom: true, itemType: true } },
      },
    });

    // 3. Fetch cheapest active SupplierProduct price per product (with package conversion)
    // Exclude ADHOC supplier and zero-price entries to get real costs
    const adhocSupplier = await prisma.supplier.findFirst({ where: { supplierCode: "ADHOC" } });
    const supplierProducts = await prisma.supplierProduct.findMany({
      where: {
        isActive: true,
        price: { gt: 0 },
        ...(adhocSupplier ? { supplierId: { not: adhocSupplier.id } } : {}),
      },
      include: { productPackage: { select: { conversionFactor: true } } },
    });

    // Build price map: productId -> cheapest cost per base unit
    // Price is per package, so divide by conversionFactor to get per-gram/ml/pcs cost
    const priceMap = new Map<string, number>();
    for (const sp of supplierProducts) {
      const conversionFactor = sp.productPackage
        ? Number(sp.productPackage.conversionFactor)
        : 1;
      const costPerBase = Number(sp.price) / conversionFactor;
      const existing = priceMap.get(sp.productId);
      if (!existing || costPerBase < existing) {
        priceMap.set(sp.productId, costPerBase);
      }
    }

    // Build recipe map: menuItemId -> array of BOM lines (with kind + channel)
    const recipeMap = new Map<
      string,
      Array<{
        productId: string;
        quantityUsed: number;
        isPackaging: boolean;
        serviceMode: "ALL" | "DINE_IN" | "TAKEAWAY";
      }>
    >();
    for (const mi of menuIngredients) {
      const existing = recipeMap.get(mi.menuId) || [];
      existing.push({
        productId: mi.productId,
        quantityUsed: Number(mi.quantityUsed),
        isPackaging: mi.product.itemType === "PACKAGING",
        serviceMode: mi.serviceMode,
      });
      recipeMap.set(mi.menuId, existing);
    }

    // Build menu info map
    const menuInfoMap = new Map<
      string,
      { name: string; category: string | null }
    >();
    for (const mi of menuIngredients) {
      if (!menuInfoMap.has(mi.menuId)) {
        menuInfoMap.set(mi.menuId, {
          name: mi.menu.name,
          category: mi.menu.category,
        });
      }
    }

    // 4. Get outlets for filter + name lookup
    const outlets = await prisma.outlet.findMany({
      select: { id: true, name: true },
      orderBy: { name: "asc" },
    });
    const outletNameMap = new Map(outlets.map((o) => [o.id, o.name]));

    // 5. Aggregate sales by menuId + outletId
    const salesAgg = new Map<
      string,
      {
        menuId: string;
        outletId: string;
        outletName: string;
        qtySold: number;
        revenue: number;
      }
    >();

    for (const sale of sales) {
      if (!sale.menuId) continue; // skip sales without a linked menu
      const key = `${sale.menuId}_${sale.outletId}`;
      const existing = salesAgg.get(key);
      if (existing) {
        existing.qtySold += Number(sale.quantity);
        existing.revenue += Number(sale.grossAmount);
      } else {
        salesAgg.set(key, {
          menuId: sale.menuId,
          outletId: sale.outletId,
          outletName: outletNameMap.get(sale.outletId) || "Unknown",
          qtySold: Number(sale.quantity),
          revenue: Number(sale.grossAmount),
        });
      }
    }

    // 6. Calculate COGS for each aggregated item
    const items: Array<{
      menuName: string;
      category: string | null;
      qtySold: number;
      revenue: number;
      expectedCogs: number;
      ingredientCogs: number;
      packagingCogs: number;
      margin: number;
      marginPercent: number;
      outletId: string;
      outletName: string;
    }> = [];

    let totalRevenue = 0;
    let totalCogs = 0;
    let totalPackagingCogs = 0;

    // Channel weight for a line: ALL bills every sale; TAKEAWAY / DINE_IN are
    // blended by the assumed takeaway share (no per-sale channel in StoreHub).
    const channelWeight = (mode: "ALL" | "DINE_IN" | "TAKEAWAY") =>
      mode === "TAKEAWAY"
        ? DEFAULT_TAKEAWAY_RATIO
        : mode === "DINE_IN"
          ? 1 - DEFAULT_TAKEAWAY_RATIO
          : 1;

    for (const agg of salesAgg.values()) {
      const recipe = recipeMap.get(agg.menuId);
      const menuInfo = menuInfoMap.get(agg.menuId);

      // Cost per unit, split into ingredient vs packaging
      let ingredientPerUnit = 0;
      let packagingPerUnit = 0;
      if (recipe) {
        for (const ing of recipe) {
          const costPerBaseUnit = priceMap.get(ing.productId) || 0;
          const lineCost = ing.quantityUsed * costPerBaseUnit * channelWeight(ing.serviceMode);
          if (ing.isPackaging) packagingPerUnit += lineCost;
          else ingredientPerUnit += lineCost;
        }
      }

      const ingredientCogs = Math.round(ingredientPerUnit * agg.qtySold * 100) / 100;
      const packagingCogs = Math.round(packagingPerUnit * agg.qtySold * 100) / 100;
      const expectedCogs = Math.round((ingredientCogs + packagingCogs) * 100) / 100;
      const revenue = Math.round(agg.revenue * 100) / 100;
      const margin = Math.round((revenue - expectedCogs) * 100) / 100;
      const marginPercent =
        revenue > 0 ? Math.round((margin / revenue) * 100 * 100) / 100 : 0;

      totalRevenue += revenue;
      totalCogs += expectedCogs;
      totalPackagingCogs += packagingCogs;

      items.push({
        menuName: menuInfo?.name || "Unknown Item",
        category: menuInfo?.category || null,
        qtySold: agg.qtySold,
        revenue,
        expectedCogs,
        ingredientCogs,
        packagingCogs,
        margin,
        marginPercent,
        outletId: agg.outletId,
        outletName: agg.outletName,
      });
    }

    // Sort by expectedCogs descending
    items.sort((a, b) => b.expectedCogs - a.expectedCogs);

    totalRevenue = Math.round(totalRevenue * 100) / 100;
    totalCogs = Math.round(totalCogs * 100) / 100;
    totalPackagingCogs = Math.round(totalPackagingCogs * 100) / 100;
    const totalIngredientCogs = Math.round((totalCogs - totalPackagingCogs) * 100) / 100;
    const grossMargin = Math.round((totalRevenue - totalCogs) * 100) / 100;
    const grossMarginPercent =
      totalRevenue > 0
        ? Math.round((grossMargin / totalRevenue) * 100 * 100) / 100
        : 0;

    return NextResponse.json({
      summary: {
        totalRevenue,
        totalCogs,
        totalIngredientCogs,
        totalPackagingCogs,
        grossMargin,
        grossMarginPercent,
        menuItemCount: items.length,
      },
      outlets,
      items,
    });
  } catch (error) {
    console.error("COGS report error:", error);
    return NextResponse.json(
      { error: "Failed to generate COGS report" },
      { status: 500 }
    );
  }
}
