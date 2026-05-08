import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/auth";

export const dynamic = "force-dynamic";

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

// GET /api/audits/staff/[userId] — completed staff-skills audits for a single
// auditee, grouped by template, with per-audit overall score and per-item
// rating, plus the delta vs the previous audit on the same template (the
// improvement signal).
//
// Auth: a staff user can view their own history; managers (ops:audit) can
// view anyone in their outlet scope; OWNER/ADMIN can view anyone.
export async function GET(
  _req: Request,
  { params }: { params: Promise<{ userId: string }> },
) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { userId } = await params;

  const me = await prisma.user.findUnique({
    where: { id: session.id },
    select: { moduleAccess: true, outletId: true, outletIds: true },
  });
  const moduleAccess = (me?.moduleAccess ?? null) as Record<string, unknown> | null;
  const isManager = hasModule(session.role, moduleAccess, "ops:audit");
  const isAdmin = session.role === "OWNER" || session.role === "ADMIN";
  const isSelf = session.id === userId;

  if (!isSelf && !isManager && !isAdmin) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  // For non-admin managers, confirm the auditee shares an outlet with them.
  if (!isSelf && isManager && !isAdmin) {
    const auditee = await prisma.user.findUnique({
      where: { id: userId },
      select: { outletId: true, outletIds: true },
    });
    const auditeeOutlets = new Set<string>([
      ...(auditee?.outletId ? [auditee.outletId] : []),
      ...(auditee?.outletIds ?? []),
    ]);
    const myOutlets = new Set<string>([
      ...(me?.outletId ? [me.outletId] : []),
      ...(me?.outletIds ?? []),
    ]);
    const sharesOutlet = [...auditeeOutlets].some((o) => myOutlets.has(o));
    if (!sharesOutlet) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

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

  // Group by template, then compute deltas vs the previous audit in that
  // template. Both overall score and per-item ratings.
  const byTemplate = new Map<
    string,
    {
      template: { id: string; name: string; jobRoleFilter: string | null };
      audits: Array<{
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
      }>;
    }
  >();

  for (const r of reports) {
    const tid = r.template.id;
    if (!byTemplate.has(tid)) {
      byTemplate.set(tid, { template: r.template, audits: [] });
    }
    const entry = byTemplate.get(tid)!;
    const prev = entry.audits[entry.audits.length - 1];
    const score = r.overallScore !== null ? Number(r.overallScore) : null;
    const scoreDelta =
      prev && prev.overallScore !== null && score !== null
        ? Math.round((score - prev.overallScore) * 100) / 100
        : null;

    // Map prev item ratings by title for delta lookup. Using itemTitle as
    // the join key (rather than item id) so a re-saved template that
    // recreates items still lines up.
    const prevByTitle = new Map<string, number | null>();
    if (prev) {
      for (const it of prev.items) prevByTitle.set(it.itemTitle, it.rating);
    }

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
