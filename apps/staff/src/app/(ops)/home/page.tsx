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

// Check if user has access to a specific module.
// moduleAccess format: { ops: ["audit", "checklists"], inventory: true }
function hasModule(
  role: string,
  moduleAccess: Record<string, unknown> | null | undefined,
  key: string,
): boolean {
  if (role === "OWNER" || role === "ADMIN") return true;
  if (!moduleAccess) return false;
  if (key.includes(":")) {
    const [app, mod] = key.split(":");
    const appAccess = moduleAccess[app];
    if (appAccess === true) return true;
    if (Array.isArray(appAccess)) return appAccess.includes(mod);
    return false;
  }
  const appAccess = moduleAccess[key];
  if (appAccess === true) return true;
  if (Array.isArray(appAccess) && appAccess.length > 0) return true;
  return false;
}

export default async function HomePage() {
  const session = await getSession();
  if (!session) redirect("/login");

  // Fetch moduleAccess to filter home page sections
  const userRecord = await prisma.user.findUnique({
    where: { id: session.id },
    select: { moduleAccess: true },
  });
  const moduleAccess = (userRecord?.moduleAccess ?? null) as Record<string, unknown> | null;

  const canSeeChecklists = hasModule(session.role, moduleAccess, "ops:checklists");
  const canSeeInventory = hasModule(session.role, moduleAccess, "inventory");
  const canSeeAudit = hasModule(session.role, moduleAccess, "ops:audit");

  const dateObj = getToday();
  const outletId = session.outletId ?? undefined;
  const outletFilter = outletId ? { outletId } : undefined;

  const myt = new Date(Date.now() + 8 * 60 * 60 * 1000);
  const todayStart = new Date(Date.UTC(myt.getUTCFullYear(), myt.getUTCMonth(), myt.getUTCDate()));

  // Fetch checklists + dashboard in parallel — only fetch what user has access to
  const [checklists, lastCheck, sentOrders, teamChecklists, recentAudits, myAuditsToday] = await Promise.all([
    canSeeChecklists
      ? prisma.checklist.findMany({
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
        })
      : [],
    // Single stockCount query — latest one tells us both "done today?" and "last check time"
    canSeeInventory && outletId
      ? prisma.stockCount.findFirst({
          where: outletFilter,
          orderBy: { createdAt: "desc" },
          select: { createdAt: true },
        })
      : null,
    canSeeInventory && outletId
      ? prisma.order.findMany({
          where: { status: { in: ["SENT", "APPROVED", "AWAITING_DELIVERY"] }, ...outletFilter },
          select: { supplier: { select: { name: true } } },
        })
      : [],
    // Team checklists summary for managers — total/done across all staff at this outlet
    canSeeAudit && outletId
      ? prisma.checklist.findMany({
          where: { outletId, date: dateObj },
          select: { status: true },
        })
      : [],
    // Recent audits at this outlet (last 3 completed)
    canSeeAudit && outletId
      ? prisma.auditReport.findMany({
          where: { outletId, status: "COMPLETED" },
          orderBy: { completedAt: "desc" },
          take: 3,
          select: {
            id: true, completedAt: true, overallScore: true,
            template: { select: { name: true } },
            auditor: { select: { name: true } },
          },
        })
      : [],
    // Has the manager started/completed an audit today?
    canSeeAudit && outletId
      ? prisma.auditReport.findMany({
          where: { auditorId: session.id, date: dateObj },
          select: { id: true, status: true },
        })
      : [],
  ]);

  const checklistData = checklists.map(({ items, ...cl }) => {
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

  const dashboardData = canSeeInventory && outletId
    ? {
        stockCheckDone: lastCheck ? lastCheck.createdAt >= todayStart : false,
        lastCheckTime: lastCheck?.createdAt?.toISOString() ?? null,
        deliveriesExpected: sentOrders.length,
        deliverySuppliers: sentOrders.map((o) => o.supplier?.name ?? "Unknown"),
      }
    : null;

  // Manager view data (only populated if user has ops:audit)
  const managerData = canSeeAudit
    ? {
        auditDoneToday: myAuditsToday.some((a) => a.status === "COMPLETED"),
        auditInProgress: myAuditsToday.find((a) => a.status === "IN_PROGRESS")?.id ?? null,
        teamChecklistsTotal: teamChecklists.length,
        teamChecklistsDone: teamChecklists.filter((c) => c.status === "COMPLETED").length,
        recentAudits: recentAudits.map((a) => ({
          id: a.id,
          template: a.template.name,
          auditor: a.auditor.name,
          score: a.overallScore ? Number(a.overallScore) : null,
          completedAt: a.completedAt?.toISOString() ?? null,
        })),
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
        moduleAccess: moduleAccess ?? undefined,
      }}
      initialChecklists={checklistData}
      initialDashboard={dashboardData}
      showQuickActions={canSeeInventory}
      managerData={managerData}
    />
  );
}
