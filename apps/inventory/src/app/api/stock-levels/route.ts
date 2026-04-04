import { NextResponse, NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";

/**
 * Returns stock levels with par level comparison for an outlet.
 * Query params: ?outletId=xxx
 */
export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const outletId = searchParams.get("outletId");

  if (!outletId) {
    return NextResponse.json({ error: "outletId required" }, { status: 400 });
  }

  const [balances, parLevels, products] = await Promise.all([
    prisma.stockBalance.findMany({
      where: { outletId },
      select: { productId: true, quantity: true },
    }),
    prisma.parLevel.findMany({
      where: { outletId },
      select: { productId: true, parLevel: true, reorderPoint: true, maxLevel: true, avgDailyUsage: true },
    }),
    prisma.product.findMany({
      where: { isActive: true },
      select: {
        id: true,
        name: true,
        sku: true,
        baseUom: true,
        storageArea: true,
        category: { select: { name: true } },
      },
    }),
  ]);

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
