import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/auth";

// GET /api/audits — list audit reports for current user
export async function GET(req: Request) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { searchParams } = new URL(req.url);
  const status = searchParams.get("status");
  const outletId = searchParams.get("outletId");

  const where: Record<string, unknown> = { auditorId: session.id };
  if (status && status !== "all") where.status = status;
  if (outletId) where.outletId = outletId;

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
