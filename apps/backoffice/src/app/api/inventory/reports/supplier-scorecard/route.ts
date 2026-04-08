import { NextResponse, NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";

/**
 * GET /api/inventory/reports/supplier-scorecard?supplierId=xxx&from=ISO&to=ISO
 * Returns supplier performance scorecard with delivery, fulfillment, and pricing metrics.
 * Defaults to last 90 days if no date range provided.
 */
export async function GET(req: NextRequest) {
  const params = new URL(req.url).searchParams;
  const supplierId = params.get("supplierId");
  const now = new Date();
  const from = params.get("from")
    ? new Date(params.get("from")!)
    : new Date(now.getTime() - 90 * 24 * 60 * 60 * 1000);
  const to = params.get("to") ? new Date(params.get("to")!) : now;

  // Fetch active suppliers (or single supplier)
  const suppliers = await prisma.supplier.findMany({
    where: {
      status: "ACTIVE",
      ...(supplierId ? { id: supplierId } : {}),
    },
    select: { id: true, name: true, leadTimeDays: true },
  });

  const scorecards = await Promise.all(
    suppliers.map(async (supplier) => {
      // Fetch orders (excluding DRAFT and CANCELLED) within date range
      const orders = await prisma.order.findMany({
        where: {
          supplierId: supplier.id,
          status: { notIn: ["DRAFT", "CANCELLED"] },
          createdAt: { gte: from, lte: to },
        },
        select: {
          id: true,
          status: true,
          totalAmount: true,
          deliveryDate: true,
          receivings: {
            select: { receivedAt: true },
            take: 1,
            orderBy: { receivedAt: "asc" },
          },
        },
      });

      const totalOrders = orders.length;

      const completedOrders = orders.filter(
        (o) => o.status === "COMPLETED" || o.status === "PARTIALLY_RECEIVED"
      );

      // On-time: receiving receivedAt <= order deliveryDate
      const ordersWithDeliveryDate = completedOrders.filter(
        (o) => o.deliveryDate !== null
      );
      const onTimeDeliveries = ordersWithDeliveryDate.filter((o) => {
        const firstReceiving = o.receivings[0];
        if (!firstReceiving) return false;
        return firstReceiving.receivedAt <= o.deliveryDate!;
      }).length;

      const onTimeRate =
        ordersWithDeliveryDate.length > 0
          ? (onTimeDeliveries / ordersWithDeliveryDate.length) * 100
          : null;

      // Fulfillment accuracy from ReceivingItems
      const receivingItems = await prisma.receivingItem.findMany({
        where: {
          receiving: {
            supplierId: supplier.id,
            receivedAt: { gte: from, lte: to },
          },
        },
        select: {
          orderedQty: true,
          receivedQty: true,
        },
      });

      const totalItemsOrdered = receivingItems.length;
      const shortDeliveries = receivingItems.filter((ri) => {
        if (ri.orderedQty === null) return false;
        return Number(ri.receivedQty) < Number(ri.orderedQty);
      }).length;

      const fulfillmentRate =
        totalItemsOrdered > 0
          ? ((totalItemsOrdered - shortDeliveries) / totalItemsOrdered) * 100
          : null;

      // Pricing metrics from PriceHistory
      const priceHistory = await prisma.priceHistory.findMany({
        where: {
          supplierId: supplier.id,
          changedAt: { gte: from, lte: to },
        },
        select: { changePercent: true },
      });

      const priceChanges = priceHistory.length;
      const avgPriceChange =
        priceChanges > 0
          ? priceHistory.reduce(
              (sum, ph) => sum + Number(ph.changePercent),
              0
            ) / priceChanges
          : 0;

      // Total spend
      const totalSpend = orders.reduce(
        (sum, o) => sum + Number(o.totalAmount),
        0
      );

      // Price stability: 100 - |avgPriceChange|, clamped 0-100
      const priceStability = Math.max(
        0,
        Math.min(100, 100 - Math.abs(avgPriceChange))
      );

      // Overall score: weighted average (only if data exists)
      let score: number | null = null;
      const hasDeliveryData = onTimeRate !== null;
      const hasFulfillmentData = fulfillmentRate !== null;

      if (hasDeliveryData || hasFulfillmentData || totalOrders > 0) {
        // Use available metrics with their weights, redistributing if a metric is unavailable
        let totalWeight = 0;
        let weightedSum = 0;

        if (onTimeRate !== null) {
          weightedSum += onTimeRate * 0.4;
          totalWeight += 0.4;
        }
        if (fulfillmentRate !== null) {
          weightedSum += fulfillmentRate * 0.4;
          totalWeight += 0.4;
        }
        if (totalOrders > 0) {
          weightedSum += priceStability * 0.2;
          totalWeight += 0.2;
        }

        score = totalWeight > 0 ? weightedSum / totalWeight : null;
      }

      return {
        id: supplier.id,
        name: supplier.name,
        score: score !== null ? Math.round(score * 10) / 10 : null,
        totalOrders,
        completedOrders: completedOrders.length,
        onTimeRate:
          onTimeRate !== null ? Math.round(onTimeRate * 10) / 10 : null,
        fulfillmentRate:
          fulfillmentRate !== null
            ? Math.round(fulfillmentRate * 10) / 10
            : null,
        shortDeliveries,
        priceChanges,
        avgPriceChange: Math.round(avgPriceChange * 100) / 100,
        totalSpend,
        leadTimeDays: supplier.leadTimeDays,
      };
    })
  );

  // Sort by score descending (nulls at end)
  scorecards.sort((a, b) => {
    if (a.score === null && b.score === null) return 0;
    if (a.score === null) return 1;
    if (b.score === null) return -1;
    return b.score - a.score;
  });

  const suppliersWithScore = scorecards.filter((s) => s.score !== null);
  const avgScore =
    suppliersWithScore.length > 0
      ? Math.round(
          (suppliersWithScore.reduce((sum, s) => sum + s.score!, 0) /
            suppliersWithScore.length) *
            10
        ) / 10
      : null;

  const topPerformer =
    suppliersWithScore.length > 0 ? suppliersWithScore[0].name : null;

  const totalSpend = scorecards.reduce((sum, s) => sum + s.totalSpend, 0);

  return NextResponse.json({
    summary: {
      totalSuppliers: scorecards.length,
      avgScore,
      topPerformer,
      totalSpend,
    },
    suppliers: scorecards,
  });
}
