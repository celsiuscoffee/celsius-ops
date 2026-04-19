import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { hrSupabaseAdmin } from "@/lib/hr/supabase";
import { computeAllowancesForUser, loadAllowanceRules } from "@/lib/hr/allowances";

export const dynamic = "force-dynamic";

async function managerDirectReports(managerId: string): Promise<string[]> {
  const { data } = await hrSupabaseAdmin
    .from("hr_employee_profiles")
    .select("user_id")
    .eq("manager_user_id", managerId);
  return (data || []).map((r: { user_id: string }) => r.user_id);
}

// GET /api/hr/allowances?year=2026&month=4&userId=xxx&outletId=yyy
// - userId provided → single-user breakdown (staff: self only; manager: direct reports; admin: anyone)
// - otherwise: list staff — admin sees all; manager sees only direct reports
export async function GET(req: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { searchParams } = new URL(req.url);
  const now = new Date();
  const year = parseInt(searchParams.get("year") || String(now.getFullYear()));
  const month = parseInt(searchParams.get("month") || String(now.getMonth() + 1));
  const userId = searchParams.get("userId");
  const outletId = searchParams.get("outletId");

  const rules = await loadAllowanceRules();
  const isAdmin = ["OWNER", "ADMIN"].includes(session.role);
  const isManager = session.role === "MANAGER";

  // Single user — full breakdown
  if (userId) {
    const isSelf = userId === session.id;
    let allowed = isSelf || isAdmin;
    if (!allowed && isManager) {
      const reports = await managerDirectReports(session.id);
      allowed = reports.includes(userId);
    }
    if (!allowed) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

    const breakdown = await computeAllowancesForUser(userId, year, month, rules);
    return NextResponse.json({ breakdown, rules });
  }

  // List — admin or manager only
  if (!isAdmin && !isManager) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const managerVisibleIds = isManager ? await managerDirectReports(session.id) : null;
  if (managerVisibleIds !== null && managerVisibleIds.length === 0) {
    return NextResponse.json({ period: { year, month }, rules, staff: [] });
  }

  // Allowances are FT-only — filter to full_time employment_type via profile.
  const { data: ftProfiles } = await hrSupabaseAdmin
    .from("hr_employee_profiles")
    .select("user_id")
    .eq("employment_type", "full_time");
  const ftUserIds = new Set((ftProfiles || []).map((p: { user_id: string }) => p.user_id));

  const users = await prisma.user.findMany({
    where: {
      status: "ACTIVE",
      role: { in: ["STAFF", "MANAGER"] },
      id: {
        in: Array.from(
          managerVisibleIds !== null
            ? new Set(managerVisibleIds.filter((id) => ftUserIds.has(id)))
            : ftUserIds,
        ),
      },
      ...(outletId ? { OR: [{ outletId }, { outletIds: { has: outletId } }] } : {}),
    },
    select: { id: true, name: true, fullName: true, outletId: true, outlet: { select: { name: true } } },
  });

  // Compute in parallel. Swallow per-user errors (rare edge cases like
  // profile missing, bad leave date) so one broken user doesn't zero the
  // whole page.
  const settled = await Promise.allSettled(
    users.map((u) => computeAllowancesForUser(u.id, year, month, rules).then((b) => ({
      userId: u.id,
      name: u.name,
      fullName: u.fullName,
      outletName: u.outlet?.name || null,
      employmentType: b.employmentType,
      isFullTime: b.isFullTime,
      attendanceEarned: b.attendance.earned,
      attendanceBase: b.attendance.base,
      performanceEarned: b.performance.earned,
      performanceBase: b.performance.base,
      performanceScore: b.performance.score,
      performanceEligible: b.performance.eligible,
      reviewPenaltyTotal: b.reviewPenalty.total,
      totalEarned: b.totalEarned,
      totalMax: b.totalMax,
      lateCount: b.attendance.metrics.lateCount,
      absentCount: b.attendance.metrics.absentCount,
    }))),
  );
  const results = settled.flatMap((r) => (r.status === "fulfilled" ? [r.value] : []));
  const failedCount = settled.length - results.length;
  if (failedCount > 0) {
    const firstErrors = settled
      .filter((r): r is PromiseRejectedResult => r.status === "rejected")
      .slice(0, 3)
      .map((r) => r.reason?.message || String(r.reason));
    console.warn(`[hr/allowances] ${failedCount} user(s) failed to compute`, firstErrors);
  }

  return NextResponse.json({
    period: { year, month },
    rules,
    staff: results.sort((a, b) => b.totalEarned - a.totalEarned),
  });
}
