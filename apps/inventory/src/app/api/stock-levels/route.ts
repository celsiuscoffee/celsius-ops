import { NextResponse, NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";

/**
 * Returns stock levels with par level comparison for a branch.
 * Query params: ?branchId=xxx
 * Returns items below par, at par, and above par.
 */
export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const branchId = searchParams.get("branchId");

  if (!branchId) {
    return NextResponse.json({ error: "branchId required" }, { status: 400 });
  }

  const [balances, parLevels, products] = await Promise.all([
    prisma.stockBalance.findMany({
      where: { branchId },
      include: { product: { include: { category: true } } },
    }),
    prisma.parLevel.findMany({
      where: { branchId },
    }),
    prisma.product.findMany({
      where: { isActive: true },
      include: { category: true },
    }),
  ]);

  // Build lookup maps
  const balanceMap = new Map(balances.map((b) => [b.productId, Number(b.quantity)]));
  const parMap = new Map(
    parLevels.map((p) => [
      p.productId,
      {
        parLevel: Number(p.parLevel),
        reorderPoint: Number(p.reorderPoint),
        maxLevel: p.maxLevel ? Number(p.maxLevel) : null,
        avgDailyUsage: p.avgDailyUsage ? Number(p.avgDailyUsage) : null,
      },
    ]),
  );

  const items = products.map((product) => {
    const currentQty = balanceMap.get(product.id) ?? 0;
    const par = parMap.get(product.id);
    const parLevel = par?.parLevel ?? 0;
    const reorderPoint = par?.reorderPoint ?? 0;
    const avgDailyUsage = par?.avgDailyUsage ?? 0;

    let status: "critical" | "low" | "ok" | "overstocked" | "no_par" = "no_par";
    if (par) {
      if (currentQty <= 0) status = "critical";
      else if (currentQty <= reorderPoint) status = "low";
      else if (par.maxLevel && currentQty > par.maxLevel) status = "overstocked";
      else status = "ok";
    }

    const daysLeft = avgDailyUsage > 0 ? currentQty / avgDailyUsage : null;
    const suggestedOrderQty = par ? Math.max(0, parLevel - currentQty) : 0;

    return {
      productId: product.id,
      name: product.name,
      sku: product.sku,
      category: product.category.name,
      baseUom: product.baseUom,
      storageArea: product.storageArea,
      currentQty,
      parLevel,
      reorderPoint,
      avgDailyUsage,
      daysLeft,
      suggestedOrderQty,
      status,
    };
  });

  // Sort: critical first, then low, then no_par, then ok
  const statusOrder = { critical: 0, low: 1, no_par: 2, ok: 3, overstocked: 4 };
  items.sort((a, b) => statusOrder[a.status] - statusOrder[b.status]);

  const summary = {
    critical: items.filter((i) => i.status === "critical").length,
    low: items.filter((i) => i.status === "low").length,
    ok: items.filter((i) => i.status === "ok").length,
    noPar: items.filter((i) => i.status === "no_par").length,
    total: items.length,
  };

  return NextResponse.json({ summary, items });
}
