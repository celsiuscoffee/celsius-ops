import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSession } from "@celsius/auth";

export const dynamic = "force-dynamic";

// GET /api/ops/audit-reports/staff/[userId] — backoffice mirror of the
// staff-app endpoint. Returns completed staff-skills audits for the auditee
// grouped by template, with overall score + per-item deltas vs the previous
// audit in the same template (the improvement signal).
//
// Backoffice is admin-only by route convention so no per-outlet scoping here.
export async function GET(
  _req: Request,
  { params }: { params: Promise<{ userId: string }> },
) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { userId } = await params;

  const reports = await prisma.auditReport.findMany({
    where: {
      auditeeId: userId,
      status: "COMPLETED",
      template: { auditTarget: "STAFF" },
    },
    select: {
      id: true,
      date: true,
      overallScore: true,
      completedAt: true,
      template: { select: { id: true, name: true, jobRoleFilter: true } },
      auditor: { select: { id: true, name: true } },
      outlet: { select: { id: true, name: true, code: true } },
      items: {
        select: {
          id: true,
          sectionName: true,
          itemTitle: true,
          rating: true,
          ratingType: true,
          notes: true,
        },
        orderBy: { sortOrder: "asc" },
      },
    },
    orderBy: { date: "asc" },
  });

  type AuditEntry = {
    id: string;
    date: string;
    overallScore: number | null;
    scoreDelta: number | null;
    completedAt: string | null;
    auditor: { id: string; name: string };
    outlet: { id: string; name: string; code: string };
    items: Array<{
      itemTitle: string;
      sectionName: string;
      ratingType: string;
      rating: number | null;
      ratingDelta: number | null;
      notes: string | null;
    }>;
  };

  const byTemplate = new Map<
    string,
    {
      template: { id: string; name: string; jobRoleFilter: string | null };
      audits: AuditEntry[];
    }
  >();

  for (const r of reports) {
    const tid = r.template.id;
    if (!byTemplate.has(tid)) byTemplate.set(tid, { template: r.template, audits: [] });
    const entry = byTemplate.get(tid)!;
    const prev = entry.audits[entry.audits.length - 1];
    const score = r.overallScore !== null ? Number(r.overallScore) : null;
    const scoreDelta =
      prev && prev.overallScore !== null && score !== null
        ? Math.round((score - prev.overallScore) * 100) / 100
        : null;

    const prevByTitle = new Map<string, number | null>();
    if (prev) for (const it of prev.items) prevByTitle.set(it.itemTitle, it.rating);

    entry.audits.push({
      id: r.id,
      date: r.date.toISOString().split("T")[0],
      overallScore: score,
      scoreDelta,
      completedAt: r.completedAt?.toISOString() ?? null,
      auditor: r.auditor,
      outlet: r.outlet,
      items: r.items.map((it) => {
        const prevRating = prevByTitle.get(it.itemTitle);
        const ratingDelta =
          prevRating !== undefined && prevRating !== null && it.rating !== null
            ? it.rating - prevRating
            : null;
        return {
          itemTitle: it.itemTitle,
          sectionName: it.sectionName,
          ratingType: it.ratingType,
          rating: it.rating,
          ratingDelta,
          notes: it.notes,
        };
      }),
    });
  }

  const auditee = await prisma.user.findUnique({
    where: { id: userId },
    select: { id: true, name: true, fullName: true },
  });

  return NextResponse.json({
    auditee: auditee ? { id: auditee.id, name: auditee.fullName ?? auditee.name } : null,
    templates: Array.from(byTemplate.values()),
  });
}
