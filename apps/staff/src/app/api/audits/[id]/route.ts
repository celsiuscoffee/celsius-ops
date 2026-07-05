import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/auth";

// Authorization for a single audit report. Mirrors the list/DELETE routes:
//   - OWNER/ADMIN: any report.
//   - The auditor who created it: always.
//   - The auditee (staff being audited): read-only, their own report — this is
//     the "see your own performance" path (allowAuditee).
//   - A manager with ops:audit: reports at an outlet in their scope.
// Everyone else: forbidden. Without this, any authenticated staffer could read
// or rewrite any audit by id (their own or a colleague's scores/notes).
async function canAccessReport(
  session: { id: string; role: string },
  report: { auditorId: string; auditeeId: string | null; outletId: string },
  opts: { allowAuditee: boolean },
): Promise<boolean> {
  if (session.role === "OWNER" || session.role === "ADMIN") return true;
  if (report.auditorId === session.id) return true;
  if (opts.allowAuditee && report.auditeeId === session.id) return true;

  const me = await prisma.user.findUnique({
    where: { id: session.id },
    select: { moduleAccess: true, outletId: true, outletIds: true },
  });
  const moduleAccess = (me?.moduleAccess ?? null) as Record<string, unknown> | null;
  if (!hasModule(session.role, moduleAccess, "ops:audit")) return false;

  const myOutlets = new Set<string>([
    ...(me?.outletId ? [me.outletId] : []),
    ...(me?.outletIds ?? []),
  ]);
  return myOutlets.has(report.outletId);
}

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

  if (!(await canAccessReport(session, report, { allowAuditee: true }))) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
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

  // Only the auditor / managers-in-outlet / admins may finalize or edit an
  // audit — the auditee cannot score their own report.
  const existing = await prisma.auditReport.findUnique({
    where: { id },
    select: { auditorId: true, auditeeId: true, outletId: true },
  });
  if (!existing) return NextResponse.json({ error: "Not found" }, { status: 404 });
  if (!(await canAccessReport(session, existing, { allowAuditee: false }))) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

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

// DELETE /api/audits/[id] — delete an audit report (cascades to items).
// Permission model:
//   - Auditor can always delete their own audit.
//   - OWNER/ADMIN can delete any audit.
//   - Managers with ops:audit can delete audits at their assigned outlets.
// COMPLETED audits remain deletable by admins/auditors — there's no historical
// integrity reason to lock them once a manager wants the record gone.
export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = await params;

  const report = await prisma.auditReport.findUnique({
    where: { id },
    select: { id: true, auditorId: true, outletId: true },
  });
  if (!report) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const me = await prisma.user.findUnique({
    where: { id: session.id },
    select: { moduleAccess: true, outletId: true, outletIds: true },
  });
  const moduleAccess = (me?.moduleAccess ?? null) as Record<string, unknown> | null;
  const isAdmin = session.role === "OWNER" || session.role === "ADMIN";
  const isAuditor = report.auditorId === session.id;
  const isManager = hasModule(session.role, moduleAccess, "ops:audit");

  let allowed = isAdmin || isAuditor;
  if (!allowed && isManager) {
    const myOutlets = new Set<string>([
      ...(me?.outletId ? [me.outletId] : []),
      ...(me?.outletIds ?? []),
    ]);
    allowed = myOutlets.has(report.outletId);
  }
  if (!allowed) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  await prisma.auditReport.delete({ where: { id } });
  return NextResponse.json({ ok: true });
}
