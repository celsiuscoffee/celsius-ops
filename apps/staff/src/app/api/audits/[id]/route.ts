import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/auth";

// GET /api/audits/[id] — full audit report detail
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = await params;

  const report = await prisma.auditReport.findUnique({
    where: { id },
    include: {
      template: { select: { id: true, name: true, description: true, roleType: true } },
      outlet: { select: { id: true, name: true, code: true } },
      auditor: { select: { id: true, name: true } },
      items: { orderBy: { sortOrder: "asc" } },
    },
  });

  if (!report) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  return NextResponse.json({
    id: report.id,
    date: report.date.toISOString().split("T")[0],
    status: report.status,
    overallScore: report.overallScore ? Number(report.overallScore) : null,
    overallNotes: report.overallNotes,
    completedAt: report.completedAt?.toISOString() ?? null,
    template: report.template,
    outlet: report.outlet,
    auditor: report.auditor,
    items: report.items.map((i) => ({
      id: i.id,
      sectionName: i.sectionName,
      itemTitle: i.itemTitle,
      sortOrder: i.sortOrder,
      photoRequired: i.photoRequired,
      ratingType: i.ratingType,
      rating: i.rating,
      notes: i.notes,
      photos: i.photos,
    })),
  });
}

// PATCH /api/audits/[id] — complete or update overall notes
export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = await params;
  const body = await req.json();
  const { overallNotes, complete } = body;

  const data: Record<string, unknown> = {};
  if (overallNotes !== undefined) data.overallNotes = overallNotes;

  if (complete) {
    // Calculate overall score
    const items = await prisma.auditReportItem.findMany({
      where: { reportId: id },
    });

    let totalScore = 0;
    let maxScore = 0;
    for (const item of items) {
      if (item.rating !== null) {
        if (item.ratingType === "pass_fail") {
          totalScore += item.rating; // 0 or 1
          maxScore += 1;
        } else if (item.ratingType === "rating_5") {
          totalScore += item.rating;
          maxScore += 5;
        } else if (item.ratingType === "rating_3") {
          totalScore += item.rating;
          maxScore += 3;
        }
      }
    }

    data.overallScore = maxScore > 0 ? Math.round((totalScore / maxScore) * 100) : 0;
    data.status = "COMPLETED";
    data.completedAt = new Date();
  }

  const updated = await prisma.auditReport.update({
    where: { id },
    data,
    select: { id: true, status: true, overallScore: true },
  });

  return NextResponse.json(updated);
}
