import { NextResponse, NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAuth } from "@/lib/auth";

// GET — single audit report with all items + photos
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const auth = await requireAuth(_req);
  if (auth.error) return auth.error;
  const { id } = await params;

  const report = await prisma.auditReport.findUnique({
    where: { id },
    include: {
      template: {
        select: {
          id: true,
          name: true,
          description: true,
          roleType: true,
          version: true,
        },
      },
      outlet: { select: { id: true, name: true, code: true } },
      auditor: { select: { id: true, name: true, role: true } },
      auditee: { select: { id: true, name: true, fullName: true, role: true } },
      items: { orderBy: { sortOrder: "asc" } },
    },
  });

  if (!report) {
    return NextResponse.json({ error: "Report not found" }, { status: 404 });
  }

  // Group items by sectionName, preserving sortOrder within a section
  const sectionMap = new Map<
    string,
    { name: string; items: typeof report.items }
  >();
  for (const item of report.items) {
    if (!sectionMap.has(item.sectionName)) {
      sectionMap.set(item.sectionName, { name: item.sectionName, items: [] });
    }
    sectionMap.get(item.sectionName)!.items.push(item);
  }
  const sections = Array.from(sectionMap.values());

  // Roll-up metrics
  const totalItems = report.items.length;
  const ratedItems = report.items.filter((i) => i.rating !== null).length;
  const passFailItems = report.items.filter((i) => i.ratingType === "pass_fail");
  const passed = passFailItems.filter((i) => i.rating === 1).length;
  const failed = passFailItems.filter((i) => i.rating === 0).length;
  const totalPhotos = report.items.reduce((s, i) => s + i.photos.length, 0);
  const photoRequiredItems = report.items.filter((i) => i.photoRequired);
  const missingPhotos = photoRequiredItems.filter((i) => i.photos.length === 0).length;

  return NextResponse.json({
    id: report.id,
    date: report.date.toISOString().split("T")[0],
    status: report.status,
    overallScore: report.overallScore ? Number(report.overallScore) : null,
    overallNotes: report.overallNotes,
    completedAt: report.completedAt?.toISOString() ?? null,
    createdAt: report.createdAt.toISOString(),
    updatedAt: report.updatedAt.toISOString(),
    template: report.template,
    outlet: report.outlet,
    auditor: report.auditor,
    auditee: report.auditee
      ? {
          id: report.auditee.id,
          name: report.auditee.fullName ?? report.auditee.name,
          role: report.auditee.role,
        }
      : null,
    sections: sections.map((s) => ({
      name: s.name,
      items: s.items.map((i) => ({
        id: i.id,
        title: i.itemTitle,
        ratingType: i.ratingType,
        rating: i.rating,
        notes: i.notes,
        photos: i.photos,
        photoRequired: i.photoRequired,
      })),
    })),
    summary: {
      totalItems,
      ratedItems,
      passed,
      failed,
      totalPhotos,
      missingPhotos,
      progress: totalItems > 0 ? Math.round((ratedItems / totalItems) * 100) : 0,
    },
  });
}
