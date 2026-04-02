import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export async function GET() {
  const now = new Date();
  const weekAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);

  const [
    recentOrders,
    recentReceivings,
    recentWastage,
    pendingOrders,
    sentOrders,
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
    // Wastage this week
    prisma.stockAdjustment.findMany({
      where: {
        adjustmentType: "WASTAGE",
        createdAt: { gte: weekAgo },
      },
    }),
    // Pending approval orders
    prisma.order.count({
      where: { status: "PENDING_APPROVAL" },
    }),
    // Sent orders (awaiting delivery)
    prisma.order.findMany({
      where: { status: { in: ["SENT", "APPROVED", "AWAITING_DELIVERY"] } },
      include: { supplier: true },
    }),
  ]);

  // Today's stock check status
  const todayStart = new Date(now);
  todayStart.setHours(0, 0, 0, 0);
  const todayCheck = await prisma.stockCount.findFirst({
    where: { createdAt: { gte: todayStart } },
    orderBy: { createdAt: "desc" },
  });
  const lastCheck = await prisma.stockCount.findFirst({
    orderBy: { createdAt: "desc" },
  });

  // Weekly spending
  const weeklyOrders = await prisma.order.findMany({
    where: { createdAt: { gte: weekAgo } },
  });
  const weeklySpending = weeklyOrders.reduce(
    (sum, o) => sum + Number(o.totalAmount),
    0,
  );

  // Wastage total this week
  const wasteTotal = recentWastage.reduce(
    (sum, w) => sum + Number(w.costAmount ?? 0),
    0,
  );

  return NextResponse.json({
    stockCheckDone: !!todayCheck,
    lastCheckTime: lastCheck?.createdAt?.toISOString() ?? null,
    pendingApprovals: pendingOrders,
    deliveriesExpected: sentOrders.length,
    deliverySuppliers: sentOrders.map((o) => o.supplier.name),
    weeklySpending,
    wasteTotal,
    ordersPlaced: weeklyOrders.length,
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
