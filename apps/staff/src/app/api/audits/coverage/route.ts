import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/auth";
import { supabaseAdmin } from "@/lib/supabase";

export const dynamic = "force-dynamic";

// GET /api/audits/coverage?outletId=...&windowDays=30
//
// For every active STAFF audit template, returns the per-auditee state:
//   - eligible auditees at the given outlet (or session.outletId)
//   - their most recent completed audit for this template (date + score)
//   - status: "never" (no audit ever), "stale" (last audit older than
//     windowDays), "recent" (within window)
//
// Powers the "Staff skill coverage" section on the audit landing page —
// answers "who hasn't been audited yet, and how did the ones audited do?"
//
// Auditor scope: anyone with audit module access can read this. The data
// doesn't expose anything beyond what the existing /audits/auditees
// endpoint already does.

export async function GET(req: NextRequest) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const url = new URL(req.url);
  const outletId = url.searchParams.get("outletId") ?? session.outletId;
  const windowDays = Math.max(
    1,
    Math.min(180, Number(url.searchParams.get("windowDays") ?? 30)),
  );

  if (!outletId) {
    return NextResponse.json({
      templates: [],
      windowDays,
      note: "No outlet scope — sign in as outlet-scoped user.",
    });
  }

  // Active STAFF templates only. OUTLET templates are about the outlet,
  // not individual people, so they have no "who needs audit" view.
  const templates = await prisma.auditTemplate.findMany({
    where: { auditTarget: "STAFF", isActive: true },
    select: {
      id: true,
      name: true,
      description: true,
      jobRoleFilter: true,
    },
    orderBy: { name: "asc" },
  });

  // All STAFF users assigned to the outlet (same scoping the
  // auditees endpoint uses — supports both outletId scalar + outletIds
  // array members).
  const allCandidates = await prisma.user.findMany({
    where: {
      role: "STAFF",
      status: "ACTIVE",
      OR: [{ outletId }, { outletIds: { has: outletId } }],
    },
    select: { id: true, name: true, fullName: true },
    orderBy: { name: "asc" },
  });

  // Look up positions for the whole candidate list once, then filter per
  // template in memory — beats N+1 round-trips.
  const userIds = allCandidates.map((c) => c.id);
  const { data: profiles } = await supabaseAdmin
    .from("hr_employee_profiles")
    .select("user_id, position")
    .in("user_id", userIds);
  const positionByUser = new Map<string, string | null>(
    (profiles ?? []).map((p) => [p.user_id, p.position ?? null]),
  );

  // Pull the most recent completed audit for each (template, auditee).
  // Single query — DISTINCT ON (template, auditee) ORDERED BY date DESC.
  // Prisma doesn't expose DISTINCT ON directly, so fetch the recent set
  // and reduce in memory.
  const windowStart = new Date();
  windowStart.setDate(windowStart.getDate() - 365); // pull a year of audits to find "latest" + classify staleness
  const recentReports = await prisma.auditReport.findMany({
    where: {
      status: "COMPLETED",
      auditeeId: { in: userIds.length > 0 ? userIds : ["__none__"] },
      templateId: { in: templates.map((t) => t.id) },
      date: { gte: windowStart },
    },
    select: {
      id: true,
      templateId: true,
      auditeeId: true,
      date: true,
      overallScore: true,
    },
    orderBy: { date: "desc" },
  });
  // Reduce: keep only the most recent per (templateId, auditeeId).
  const latestByPair = new Map<
    string,
    { id: string; date: Date; overallScore: number | null }
  >();
  for (const r of recentReports) {
    if (!r.auditeeId) continue;
    const key = `${r.templateId}::${r.auditeeId}`;
    if (!latestByPair.has(key)) {
      latestByPair.set(key, {
        id: r.id,
        date: r.date,
        overallScore:
          r.overallScore != null ? Number(r.overallScore) : null,
      });
    }
  }

  const staleCutoff = new Date();
  staleCutoff.setDate(staleCutoff.getDate() - windowDays);

  const result = templates.map((tmpl) => {
    const allowedRoles = tmpl.jobRoleFilter ?? [];
    const eligibleUsers = allCandidates.filter((u) => {
      if (allowedRoles.length === 0) return true;
      const pos = positionByUser.get(u.id);
      return pos != null && allowedRoles.includes(pos);
    });

    const auditees = eligibleUsers.map((u) => {
      const last = latestByPair.get(`${tmpl.id}::${u.id}`);
      let status: "never" | "stale" | "recent" = "never";
      if (last) {
        status = last.date >= staleCutoff ? "recent" : "stale";
      }
      return {
        userId: u.id,
        name: u.fullName ?? u.name,
        position: positionByUser.get(u.id) ?? null,
        status,
        lastAudit: last
          ? {
              reportId: last.id,
              date: last.date.toISOString().split("T")[0],
              overallScore: last.overallScore,
            }
          : null,
      };
    });

    const recentCount = auditees.filter((a) => a.status === "recent").length;
    const neverCount = auditees.filter((a) => a.status === "never").length;
    const staleCount = auditees.filter((a) => a.status === "stale").length;
    const avgScore = (() => {
      const withScore = auditees
        .map((a) => a.lastAudit?.overallScore)
        .filter((s): s is number => typeof s === "number");
      if (withScore.length === 0) return null;
      return Math.round(
        withScore.reduce((s, v) => s + v, 0) / withScore.length,
      );
    })();

    return {
      id: tmpl.id,
      name: tmpl.name,
      description: tmpl.description,
      jobRoleFilter: tmpl.jobRoleFilter,
      totals: {
        eligible: auditees.length,
        recent: recentCount,
        stale: staleCount,
        never: neverCount,
        avgScore,
      },
      auditees,
    };
  });

  return NextResponse.json({ templates: result, windowDays });
}
