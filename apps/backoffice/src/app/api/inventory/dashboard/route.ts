import { NextResponse, NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { getUserFromHeaders } from "@/lib/auth";

export async function GET(req: NextRequest) {
  const caller = await getUserFromHeaders(req.headers);
  if (!caller) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const outletId = new URL(req.url).searchParams.get("outletId") || undefined;
  const outletFilter = outletId ? { outletId } : undefined;
  const now = new Date();
  const weekAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);

  // Use Malaysia time (UTC+8) for today boundary
  const myt = new Date(Date.now() + 8 * 60 * 60 * 1000);
  const todayStart = new Date(Date.UTC(myt.getUTCFullYear(), myt.getUTCMonth(), myt.getUTCDate()));

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
      where: outletFilter,
      select: {
        id: true,
        orderNumber: true,
        status: true,
        totalAmount: true,
        createdAt: true,
        supplier: { select: { name: true } },
      },
      orderBy: { createdAt: "desc" },
      take: 5,
    }),
    // Recent receivings count this week
    prisma.receiving.count({
      where: { receivedAt: { gte: weekAgo }, ...outletFilter },
    }),
    // Wastage cost total this week (aggregated in DB)
    prisma.stockAdjustment.aggregate({
      where: { adjustmentType: "WASTAGE", createdAt: { gte: weekAgo }, ...outletFilter },
      _sum: { costAmount: true },
    }),
    // Pending approval orders
    prisma.order.count({
      where: { status: "PENDING_APPROVAL", ...outletFilter },
    }),
    // Sent orders (awaiting delivery)
    prisma.order.findMany({
      where: { status: { in: ["SENT", "AWAITING_DELIVERY"] }, ...outletFilter },
      select: { supplier: { select: { name: true } } },
    }),
    // Today's stock check
    prisma.stockCount.findFirst({
      where: { createdAt: { gte: todayStart }, ...outletFilter },
      select: { id: true },
    }),
    // Last stock check ever
    prisma.stockCount.findFirst({
      where: outletFilter,
      orderBy: { createdAt: "desc" },
      select: { createdAt: true },
    }),
    // Weekly spending (aggregated in DB)
    prisma.order.aggregate({
      where: { createdAt: { gte: weekAgo }, ...outletFilter },
      _sum: { totalAmount: true },
    }),
    // Weekly order count
    prisma.order.count({
      where: { createdAt: { gte: weekAgo }, ...outletFilter },
    }),
  ]);

  const weeklySpending = Number(weeklyOrderAgg._sum.totalAmount ?? 0);
  const wasteTotal = Number(wasteAgg._sum.costAmount ?? 0);

  return NextResponse.json({
    stockCheckDone: !!todayCheck,
    lastCheckTime: lastCheck?.createdAt?.toISOString() ?? null,
    pendingApprovals: pendingOrders,
    deliveriesExpected: sentOrders.length,
    deliverySuppliers: sentOrders.map((o) => o.supplier?.name ?? "Unknown"),
    weeklySpending,
    wasteTotal,
    ordersPlaced: weeklyOrderCount,
    receivingsThisWeek: recentReceivings,
    recentOrders: recentOrders.map((o) => ({
      id: o.id,
      orderNumber: o.orderNumber,
      supplier: o.supplier?.name ?? "Unknown",
      status: o.status,
      totalAmount: Number(o.totalAmount),
      createdAt: o.createdAt.toISOString(),
    })),
  });
}
