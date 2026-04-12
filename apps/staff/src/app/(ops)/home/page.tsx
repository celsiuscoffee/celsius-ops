import { redirect } from "next/navigation";
import nextDynamic from "next/dynamic";
import { getSession } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

const HomeClient = nextDynamic(() => import("./home-client").then((m) => m.HomeClient));

export const dynamic = "force-dynamic";

function getToday() {
  // Malaysia time (UTC+8)
  const now = new Date(Date.now() + 8 * 60 * 60 * 1000);
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
}

export default async function HomePage() {
  const session = await getSession();
  if (!session) redirect("/login");

  const dateObj = getToday();
  const outletId = session.outletId ?? undefined;
  const outletFilter = outletId ? { outletId } : undefined;

  const todayStart = new Date();
  todayStart.setHours(0, 0, 0, 0);

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const db = prisma as any;
  // Fetch checklists + dashboard in parallel — use _count with filter to avoid fetching item rows
  const [checklists, lastCheck, sentOrders] = await Promise.all([
    db.checklist.findMany({
      where: {
        ...(outletId ? { outletId } : { assignedToId: session.id }),
        date: dateObj,
      },
      orderBy: [{ date: "desc" }, { createdAt: "desc" }],
      select: {
        id: true, timeSlot: true, dueAt: true, status: true,
        sop: { select: { title: true, category: { select: { name: true } } } },
        _count: { select: { items: true } },
        items: { where: { isCompleted: true }, select: { id: true } },
      },
    }),
    // Single stockCount query — latest one tells us both "done today?" and "last check time"
    outletId
      ? db.stockCount.findFirst({
          where: outletFilter,
          orderBy: { createdAt: "desc" },
          select: { createdAt: true },
        })
      : null,
    outletId
      ? db.order.findMany({
          where: { status: { in: ["SENT", "APPROVED", "AWAITING_DELIVERY"] }, ...outletFilter },
          select: { supplier: { select: { name: true } } },
        })
      : [],
  ]);

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const checklistData = (checklists as any[]).map(({ items, ...cl }: any) => {
    const totalItems = cl._count.items;
    const completedItems = items.length;
    return {
      id: cl.id,
      status: cl.status as "PENDING" | "IN_PROGRESS" | "COMPLETED",
      sop: cl.sop,
      timeSlot: cl.timeSlot,
      dueAt: cl.dueAt?.toISOString() ?? null,
      totalItems,
      completedItems,
      progress: totalItems > 0 ? Math.round((completedItems / totalItems) * 100) : 0,
    };
  });

  const dashboardData = outletId
    ? {
        stockCheckDone: lastCheck ? lastCheck.createdAt >= todayStart : false,
        lastCheckTime: lastCheck?.createdAt?.toISOString() ?? null,
        deliveriesExpected: sentOrders.length,
        deliverySuppliers: (sentOrders as any[]).map((o: any) => o.supplier.name),
      }
    : null;

  return (
    <HomeClient
      user={{
        id: session.id,
        name: session.name,
        role: session.role,
        outletId: session.outletId ?? null,
        outletName: session.outletName ?? null,
      }}
      initialChecklists={checklistData}
      initialDashboard={dashboardData}
    />
  );
}
