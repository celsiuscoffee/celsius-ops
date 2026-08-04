import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { hrSupabaseAdmin } from "@/lib/hr/supabase";
import { computeAllowancesForUser, loadAllowanceRules } from "@/lib/hr/allowances";
import { resolveVisibleUserIds } from "@/lib/hr/scope";

export const dynamic = "force-dynamic";

// GET /api/hr/allowances?year=2026&month=4&userId=xxx&outletId=yyy
// - userId provided → single-user breakdown (staff: self only; manager: full subtree; admin: anyone)
// - otherwise: list staff — admin sees all; manager sees full subtree
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
      const visible = await resolveVisibleUserIds(session);
      allowed = (visible || []).includes(userId);
    }
    if (!allowed) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

    const breakdown = await computeAllowancesForUser(userId, year, month, rules);
    return NextResponse.json({ breakdown, rules });
  }

  // List — admin or manager only
  if (!isAdmin && !isManager) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const managerVisibleIds = isManager ? await resolveVisibleUserIds(session) : null;
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
      eligible: b.eligible,
      // v2 single-pool shape
      // `lineKey` is what a hand edit is stored against — see the
      // hr_performance_line_overrides migration.
      levers: b.levers.map((l) => ({
        key: l.key, lineKey: `lever|${l.key}`, label: l.label, applicable: l.applicable,
        score: l.score, tier: l.tier, slice: l.slice, earned: l.earned, detail: l.detail,
        originalEarned: l.originalEarned, edited: l.edited, editReason: l.editReason,
      })),
      performanceEarned: b.performanceEarned,
      attendanceDeducted: b.attendance.total,
      reviewPenaltyTotal: b.reviewPenalty.total,
      totalEarned: b.totalEarned,
      totalMax: b.totalMax,
      lateCount: b.attendance.lateCount,
      absentCount: b.attendance.absentCount,
      // Every deduction as its own line, so /hr/performance can waive one
      // without replacing the whole month. `key` is what a waiver is stored
      // against — see the hr_performance_deduction_waivers migration.
      deductions: [
        ...b.attendance.deductions.map((d) => ({
          key: d.key, kind: d.kind, label: d.label, date: d.date ?? null,
          amount: d.amount, originalAmount: d.originalAmount,
          edited: d.edited, editReason: d.editReason,
        })),
        ...b.reviewPenalty.entries.map((e) => ({
          key: e.key, kind: "review" as const,
          label: `${e.rating}★ review${e.reviewText ? ` — ${e.reviewText.slice(0, 80)}` : ""}`,
          date: e.reviewDate,
          amount: e.amount, originalAmount: e.originalAmount,
          edited: e.edited, editReason: e.editReason,
        })),
      ],
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
