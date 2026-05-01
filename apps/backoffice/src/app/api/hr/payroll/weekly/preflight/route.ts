import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { hrSupabaseAdmin } from "@/lib/hr/supabase";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

// Pre-run readiness for the WEEKLY (part-timer) cycle. Surfaces:
//  - Global: any published schedule covering this week? if not, nothing to pay.
//  - Per-PT: hourly_rate set? scheduled this week? bank account? final payroll?
//
// Schedule-based: only PTs with shifts in a PUBLISHED roster are paid.
//
// GET /api/hr/payroll/weekly/preflight?week_start=YYYY-MM-DD
type Issue = { code: string; severity: "block" | "warn"; message: string };

export async function GET(req: NextRequest) {
  const session = await getSession();
  if (!session || !["OWNER", "ADMIN"].includes(session.role)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const weekStart = new URL(req.url).searchParams.get("week_start");
  if (!weekStart) {
    return NextResponse.json({ error: "week_start required (YYYY-MM-DD, Monday)" }, { status: 400 });
  }
  const start = new Date(`${weekStart}T00:00:00.000Z`);
  if (start.getUTCDay() !== 1) {
    return NextResponse.json({ error: "week_start must be a Monday" }, { status: 400 });
  }
  const end = new Date(start);
  end.setUTCDate(end.getUTCDate() + 6);
  const periodStart = weekStart;
  const periodEnd = end.toISOString().slice(0, 10);

  // 1. Profiles + linked users
  const { data: profiles } = await hrSupabaseAdmin
    .from("hr_employee_profiles")
    .select("user_id, hourly_rate, end_date, resigned_at")
    .eq("employment_type", "part_time");
  const userIds = (profiles || []).map((p: { user_id: string }) => p.user_id);
  const users = userIds.length
    ? await prisma.user.findMany({
        where: { id: { in: userIds } },
        select: {
          id: true, name: true, fullName: true, status: true,
          bankName: true, bankAccountNumber: true,
        },
      })
    : [];
  const userMap = new Map(users.map((u) => [u.id, u]));

  // 2. Published schedules + shifts in this week
  const { data: schedules } = await hrSupabaseAdmin
    .from("hr_schedules")
    .select("id, status")
    .eq("status", "published")
    .lte("week_start", periodEnd)
    .gte("week_end", periodStart);
  const scheduleIds = (schedules || []).map((s: { id: string }) => s.id);

  const { data: shifts } = scheduleIds.length
    ? await hrSupabaseAdmin
        .from("hr_schedule_shifts")
        .select("user_id, shift_date")
        .in("schedule_id", scheduleIds)
        .gte("shift_date", periodStart)
        .lte("shift_date", periodEnd)
    : { data: [] as Array<{ user_id: string; shift_date: string }> };

  const shiftCountByUser = new Map<string, number>();
  for (const s of shifts || []) {
    shiftCountByUser.set(s.user_id, (shiftCountByUser.get(s.user_id) || 0) + 1);
  }

  // 3. Also detect PTs with shifts in a DRAFT schedule (so we can warn that
  // the roster needs publishing before they get paid).
  const { data: draftSchedules } = await hrSupabaseAdmin
    .from("hr_schedules")
    .select("id")
    .neq("status", "published")
    .lte("week_start", periodEnd)
    .gte("week_end", periodStart);
  const draftScheduleIds = (draftSchedules || []).map((s: { id: string }) => s.id);
  const { data: draftShifts } = draftScheduleIds.length
    ? await hrSupabaseAdmin
        .from("hr_schedule_shifts")
        .select("user_id")
        .in("schedule_id", draftScheduleIds)
        .gte("shift_date", periodStart)
        .lte("shift_date", periodEnd)
    : { data: [] as Array<{ user_id: string }> };
  const draftUserIds = new Set((draftShifts || []).map((s: { user_id: string }) => s.user_id));

  type Profile = {
    user_id: string;
    hourly_rate: number | string | null;
    end_date: string | null;
    resigned_at: string | null;
  };

  const rows = ((profiles || []) as Profile[]).map((p) => {
    const u = userMap.get(p.user_id);
    const issues: Issue[] = [];
    // Use end_date (last working day) for payroll cutoff, not letter-submission date.
    const resignDate = p.end_date || p.resigned_at || null;
    const resignedBefore = resignDate && resignDate < periodStart;
    const isFinalCycle = !!resignDate && !resignedBefore && resignDate <= periodEnd;
    const shiftCount = shiftCountByUser.get(p.user_id) || 0;
    const inDraftOnly = shiftCount === 0 && draftUserIds.has(p.user_id);

    // Resigned in a prior cycle — won't appear at all.
    if (resignedBefore) {
      return {
        user_id: p.user_id,
        name: u?.fullName || u?.name || p.user_id.slice(0, 8),
        scheduled_shifts: 0,
        skipped: true,
        skip_reason: `resigned ${resignDate} (paid in prior cycle)`,
        issues: [] as Issue[],
        status: "skipped" as const,
      };
    }

    // Final payroll warning (resigning this week)
    if (isFinalCycle) {
      issues.push({
        code: "final_payroll",
        severity: "warn",
        message: `Final payroll (resign ${resignDate}). Verify final settlement.`,
      });
    }

    // Blocking — won't compute a row
    if (Number(p.hourly_rate || 0) <= 0) {
      issues.push({ code: "missing_hourly_rate", severity: "block", message: "No hourly rate set" });
    }
    if (shiftCount === 0 && !inDraftOnly) {
      // Not on the published roster at all — by design no payment line.
      // Surface as a soft note rather than a warning so HR isn't alarmed
      // when half the cohort isn't scheduled this week.
      issues.push({
        code: "not_scheduled",
        severity: "warn",
        message: "Not scheduled this week — no payroll line will be created.",
      });
    }
    if (inDraftOnly) {
      issues.push({
        code: "draft_only",
        severity: "warn",
        message: "Has shifts in a DRAFT schedule. Publish the roster before computing.",
      });
    }

    if (shiftCount > 0 && (!u?.bankName || !u?.bankAccountNumber)) {
      issues.push({
        code: "missing_bank",
        severity: "warn",
        message: "No bank account on file (Maybank file will skip)",
      });
    }

    const blocked = issues.some((i) => i.severity === "block");
    let statusLabel: "ready" | "warning" | "blocked" | "skipped" = "ready";
    if (blocked) statusLabel = "blocked";
    else if (issues.length > 0) statusLabel = "warning";

    return {
      user_id: p.user_id,
      name: u?.fullName || u?.name || p.user_id.slice(0, 8),
      scheduled_shifts: shiftCount,
      skipped: false,
      skip_reason: null,
      issues,
      status: statusLabel,
    };
  });

  const summary = {
    total_part_timers: rows.length,
    payable: rows.filter((r) => r.scheduled_shifts > 0 && r.status !== "blocked").length,
    not_scheduled: rows.filter((r) => r.scheduled_shifts === 0 && r.status !== "skipped").length,
    blocked: rows.filter((r) => r.status === "blocked").length,
    warning: rows.filter((r) => r.status === "warning").length,
    skipped: rows.filter((r) => r.status === "skipped").length,
    final_payroll: rows.filter((r) => r.issues.some((i) => i.code === "final_payroll")).length,
    published_schedules: scheduleIds.length,
    published_shifts: (shifts || []).length,
    draft_schedules: draftScheduleIds.length,
  };

  return NextResponse.json({ summary, rows });
}
