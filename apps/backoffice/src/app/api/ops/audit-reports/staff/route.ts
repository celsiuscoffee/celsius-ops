import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSession } from "@celsius/auth";

export const dynamic = "force-dynamic";

// GET /api/ops/audit-reports/staff — list of staff who have been audited
// (auditTarget = STAFF), most recent first, with latest score and audit count.
// Powers the backoffice "Staff Skills" overview page.
export async function GET() {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const reports = await prisma.auditReport.findMany({
    where: {
      auditeeId: { not: null },
      status: "COMPLETED",
      template: { auditTarget: "STAFF" },
    },
    select: {
      id: true,
      date: true,
      overallScore: true,
      auditeeId: true,
      auditee: { select: { id: true, name: true, fullName: true } },
      template: { select: { id: true, name: true, jobRoleFilter: true } },
      outlet: { select: { id: true, name: true, code: true } },
    },
    orderBy: { date: "desc" },
  });

  // Aggregate: one row per (auditee, template) showing latest audit + count.
  // The page lets the user expand into the per-staff history.
  const groups = new Map<
    string,
    {
      auditeeId: string;
      auditee: { id: string; name: string };
      templateId: string;
      templateName: string;
      jobRole: string | null;
      latestDate: string;
      latestScore: number | null;
      auditCount: number;
      outlet: { id: string; name: string; code: string };
    }
  >();

  for (const r of reports) {
    if (!r.auditeeId || !r.auditee) continue;
    const key = `${r.auditeeId}::${r.template.id}`;
    const existing = groups.get(key);
    if (existing) {
      existing.auditCount += 1;
      continue;
    }
    groups.set(key, {
      auditeeId: r.auditeeId,
      auditee: { id: r.auditee.id, name: r.auditee.fullName ?? r.auditee.name },
      templateId: r.template.id,
      templateName: r.template.name,
      jobRole: r.template.jobRoleFilter,
      latestDate: r.date.toISOString().split("T")[0],
      latestScore: r.overallScore !== null ? Number(r.overallScore) : null,
      auditCount: 1,
      outlet: r.outlet,
    });
  }

  return NextResponse.json(Array.from(groups.values()));
}
