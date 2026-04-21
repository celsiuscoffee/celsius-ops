import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/auth";

// Check if user has access to a specific module
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

// GET /api/audits — list audit reports
// Managers (with ops:audit) see ALL audits at their outlet(s).
// Staff without audit access see only their own.
export async function GET(req: Request) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { searchParams } = new URL(req.url);
  const status = searchParams.get("status");
  const outletIdFilter = searchParams.get("outletId");

  // Fetch user's moduleAccess to determine if they're a manager
  const userRecord = await prisma.user.findUnique({
    where: { id: session.id },
    select: { moduleAccess: true, outletId: true, outletIds: true },
  });
  const moduleAccess = (userRecord?.moduleAccess ?? null) as Record<string, unknown> | null;
  const isManager = hasModule(session.role, moduleAccess, "ops:audit");

  const where: Record<string, unknown> = {};

  if (isManager) {
    // Managers see all audits at the outlets they have access to
    const myOutlets = [
      ...(userRecord?.outletId ? [userRecord.outletId] : []),
      ...(userRecord?.outletIds ?? []),
    ];
    if (session.role !== "OWNER" && session.role !== "ADMIN" && myOutlets.length > 0) {
      where.outletId = { in: myOutlets };
    }
  } else {
    // Non-managers see only their own audits
    where.auditorId = session.id;
  }

  if (status && status !== "all") where.status = status;
  // outletIdFilter narrows results, but never broadens scope: non-admins
  // can only filter to outlets already in `where.outletId`. OWNER/ADMIN
  // bypass since `where.outletId` was never set above.
  if (outletIdFilter) {
    const isAdmin = session.role === "OWNER" || session.role === "ADMIN";
    if (!isAdmin && isManager) {
      const myOutlets = [
        ...(userRecord?.outletId ? [userRecord.outletId] : []),
        ...(userRecord?.outletIds ?? []),
      ];
      if (!myOutlets.includes(outletIdFilter)) {
        return NextResponse.json({ error: "Outlet not in your scope" }, { status: 403 });
      }
    }
    where.outletId = outletIdFilter;
  }

  const reports = await prisma.auditReport.findMany({
    where,
    take: 50,
    select: {
      id: true,
      date: true,
      status: true,
      overallScore: true,
      completedAt: true,
      template: { select: { id: true, name: true, roleType: true } },
      outlet: { select: { id: true, name: true, code: true } },
      auditor: { select: { id: true, name: true } },
      items: { select: { id: true, rating: true, ratingType: true } },
    },
    orderBy: { date: "desc" },
  });

  // Calculate progress for each report
  const mapped = reports.map((r) => {
    const totalItems = r.items.length;
    const completedItems = r.items.filter((i) => i.rating !== null).length;
    return {
      id: r.id,
      date: r.date.toISOString().split("T")[0],
      status: r.status,
      overallScore: r.overallScore ? Number(r.overallScore) : null,
      completedAt: r.completedAt?.toISOString() ?? null,
      template: r.template,
      outlet: r.outlet,
      auditor: r.auditor,
      isMine: r.auditor.id === session.id,
      totalItems,
      completedItems,
      progress: totalItems > 0 ? Math.round((completedItems / totalItems) * 100) : 0,
    };
  });

  return NextResponse.json(mapped);
}

// POST /api/audits — start a new audit report
export async function POST(req: Request) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await req.json();
  const { templateId, outletId } = body;

  if (!templateId || !outletId) {
    return NextResponse.json({ error: "templateId and outletId required" }, { status: 400 });
  }

  // Outlet scope — non-admins may only create audits at their own outlet.
  const isAdmin = session.role === "OWNER" || session.role === "ADMIN";
  if (!isAdmin && outletId !== session.outletId) {
    return NextResponse.json({ error: "Cannot create audit for another outlet" }, { status: 403 });
  }

  // Fetch template with sections and items
  const template = await prisma.auditTemplate.findUnique({
    where: { id: templateId },
    include: {
      sections: {
        orderBy: { sortOrder: "asc" },
        include: {
          items: { orderBy: { sortOrder: "asc" } },
        },
      },
    },
  });

  if (!template) {
    return NextResponse.json({ error: "Template not found" }, { status: 404 });
  }

  // Build flat list of report items from template sections
  const reportItems: {
    sectionName: string;
    itemTitle: string;
    sortOrder: number;
    photoRequired: boolean;
    ratingType: string;
  }[] = [];

  let globalSort = 0;
  for (const section of template.sections) {
    for (const item of section.items) {
      reportItems.push({
        sectionName: section.name,
        itemTitle: item.title,
        sortOrder: globalSort++,
        photoRequired: item.photoRequired,
        ratingType: item.ratingType,
      });
    }
  }

  const today = new Date();
  const dateOnly = new Date(Date.UTC(today.getFullYear(), today.getMonth(), today.getDate()));

  const report = await prisma.auditReport.create({
    data: {
      templateId,
      outletId,
      auditorId: session.id,
      date: dateOnly,
      status: "IN_PROGRESS",
      items: { create: reportItems },
    },
    select: { id: true },
  });

  return NextResponse.json(report, { status: 201 });
}
