import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export async function GET() {
  const now = new Date();
  const weekAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);

  const todayStart = new Date(now);
  todayStart.setHours(0, 0, 0, 0);

  const [
    recentOrders,
    recentReceivings,
    wasteAgg,
    pendingOrders,
    sentOrders,
    todayCheck,
    lastCheck,
    weeklyOrderAgg,
    weeklyOrderCount,
  ] = await Promise.all([
    // Recent orders (last 5)
    prisma.order.findMany({
      include: { supplier: true, branch: true },
      orderBy: { createdAt: "desc" },
      take: 5,
    }),
    // Recent receivings count this week
    prisma.receiving.count({
      where: { receivedAt: { gte: weekAgo } },
    }),
    // Wastage cost total this week (aggregated in DB)
    prisma.stockAdjustment.aggregate({
      where: { adjustmentType: "WASTAGE", createdAt: { gte: weekAgo } },
      _sum: { costAmount: true },
    }),
    // Pending approval orders
    prisma.order.count({
      where: { status: "PENDING_APPROVAL" },
    }),
    // Sent orders (awaiting delivery)
    prisma.order.findMany({
      where: { status: { in: ["SENT", "APPROVED", "AWAITING_DELIVERY"] } },
      select: { supplier: { select: { name: true } } },
    }),
    // Today's stock check
    prisma.stockCount.findFirst({
      where: { createdAt: { gte: todayStart } },
      orderBy: { createdAt: "desc" },
    }),
    // Last stock check ever
    prisma.stockCount.findFirst({
      orderBy: { createdAt: "desc" },
    }),
    // Weekly spending (aggregated in DB)
    prisma.order.aggregate({
      where: { createdAt: { gte: weekAgo } },
      _sum: { totalAmount: true },
    }),
    // Weekly order count
    prisma.order.count({
      where: { createdAt: { gte: weekAgo } },
    }),
  ]);

  const weeklySpending = Number(weeklyOrderAgg._sum.totalAmount ?? 0);
  const wasteTotal = Number(wasteAgg._sum.costAmount ?? 0);

  return NextResponse.json({
    stockCheckDone: !!todayCheck,
    lastCheckTime: lastCheck?.createdAt?.toISOString() ?? null,
    pendingApprovals: pendingOrders,
    deliveriesExpected: sentOrders.length,
    deliverySuppliers: sentOrders.map((o) => o.supplier.name),
    weeklySpending,
    wasteTotal,
    ordersPlaced: weeklyOrderCount,
    receivingsThisWeek: recentReceivings,
    recentOrders: recentOrders.map((o) => ({
      id: o.id,
      orderNumber: o.orderNumber,
      supplier: o.supplier.name,
      status: o.status.toLowerCase(),
      totalAmount: Number(o.totalAmount),
      createdAt: o.createdAt.toISOString(),
    })),
  });
}
