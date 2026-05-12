import { NextResponse, NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAuth } from "@/lib/auth";

// GET — list all audit reports (with filters)
export async function GET(req: NextRequest) {
  const auth = await requireAuth(req);
  if (auth.error) return auth.error;
  const { searchParams } = new URL(req.url);
  const outletId = searchParams.get("outletId");
  const templateId = searchParams.get("templateId");
  const status = searchParams.get("status");
  const roleType = searchParams.get("roleType");
  const auditorId = searchParams.get("auditorId");
  const dateFrom = searchParams.get("dateFrom");
  const dateTo = searchParams.get("dateTo");

  const where: Record<string, unknown> = {};
  if (outletId) where.outletId = outletId;
  if (templateId) where.templateId = templateId;
  if (auditorId) where.auditorId = auditorId;
  if (status && status !== "all") where.status = status;
  if (roleType && roleType !== "all") where.template = { roleType };
  if (dateFrom || dateTo) {
    where.date = {};
    if (dateFrom) (where.date as Record<string, unknown>).gte = new Date(dateFrom);
    if (dateTo) (where.date as Record<string, unknown>).lte = new Date(dateTo);
  }

  const reports = await prisma.auditReport.findMany({
    where,
    include: {
      template: { select: { id: true, name: true, roleType: true } },
      outlet: { select: { id: true, name: true, code: true } },
      auditor: { select: { id: true, name: true } },
      auditee: { select: { id: true, name: true, fullName: true } },
      items: { select: { id: true, rating: true, ratingType: true, photos: true } },
    },
    orderBy: { date: "desc" },
    take: 100,
  });

  const mapped = reports.map((r) => {
    const totalItems = r.items.length;
    const ratedItems = r.items.filter((i) => i.rating !== null).length;
    const totalPhotos = r.items.reduce((s, i) => s + i.photos.length, 0);
    return {
      id: r.id,
      date: r.date.toISOString().split("T")[0],
      status: r.status,
      overallScore: r.overallScore ? Number(r.overallScore) : null,
      overallNotes: r.overallNotes,
      completedAt: r.completedAt?.toISOString() ?? null,
      template: r.template,
      outlet: r.outlet,
      auditor: r.auditor,
      auditee: r.auditee
        ? { id: r.auditee.id, name: r.auditee.fullName ?? r.auditee.name }
        : null,
      totalItems,
      ratedItems,
      totalPhotos,
      progress: totalItems > 0 ? Math.round((ratedItems / totalItems) * 100) : 0,
    };
  });

  return NextResponse.json(mapped);
}
