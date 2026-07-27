import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { hrSupabaseAdmin } from "@/lib/hr/supabase";
import { prisma } from "@/lib/prisma";
import { breakHoursFor } from "@/lib/hr/hours";

export const dynamic = "force-dynamic";

// Pre-run readiness for the WEEKLY (part-timer) cycle — CLOCK-BASED. Surfaces:
//  - Per-PT: hourly_rate set? clocked any shifts this week? bank account? final payroll?
//
// Part-timers are paid for the hours they CLOCK on the staff app, so readiness is
// "did they clock in this week", not "is there a published roster".
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
  const weekStartIso = `${periodStart}T00:00:00+08:00`;
  const weekEndIso = `${periodEnd}T23:59:59+08:00`;

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

  // 2. Clocked (closed) attendance for these PTs in the MYT week.
  type Log = { user_id: string; clock_in: string; clock_out: string | null; total_hours: number | string | null; final_status: string | null };
  const { data: logs } = userIds.length
    ? await hrSupabaseAdmin
        .from("hr_attendance_logs")
        .select("user_id, clock_in, clock_out, total_hours, final_status")
        .in("user_id", userIds)
        .gte("clock_in", weekStartIso)
        .lte("clock_in", weekEndIso)
        .not("clock_out", "is", null)
    : { data: [] as Log[] };

  // 2b. ROSTERED shifts this week — "no clock-ins" is only a warning when the
  // PT was actually scheduled (owner 2026-07-19: a PT who simply isn't on the
  // roster this week is not a problem, just not working). Unconfirmed AI
  // suggestions don't count as scheduled.
  const { data: rostered } = userIds.length
    ? await hrSupabaseAdmin
        .from("hr_schedule_shifts")
        .select("user_id, shift_date, start_time, notes")
        .in("user_id", userIds)
        .gte("shift_date", periodStart)
        .lte("shift_date", periodEnd)
    : { data: [] as Array<{ user_id: string; start_time: string; notes: string | null }> };
  const scheduledCountByUser = new Map<string, number>();
  for (const s of (rostered ?? []) as Array<{ user_id: string; start_time: string; notes: string | null }>) {
    if (s.start_time?.slice(0, 5) === "00:00") continue; // rest-day marker
    if (s.notes === "pt_suggestion") continue; // unconfirmed suggestion
    scheduledCountByUser.set(s.user_id, (scheduledCountByUser.get(s.user_id) || 0) + 1);
  }

  const shiftCountByUser = new Map<string, number>();
  const hoursByUser = new Map<string, number>();
  for (const l of (logs || []) as Log[]) {
    if (l.final_status === "rejected") continue;
    shiftCountByUser.set(l.user_id, (shiftCountByUser.get(l.user_id) || 0) + 1);
    const totalH = l.total_hours != null
      ? Number(l.total_hours)
      : Math.max(0, (new Date(l.clock_out as string).getTime() - new Date(l.clock_in).getTime()) / 3600000);
    const worked = Math.max(0, totalH - breakHoursFor("part_time", totalH));
    hoursByUser.set(l.user_id, (hoursByUser.get(l.user_id) || 0) + worked);
  }

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
    const loggedShifts = shiftCountByUser.get(p.user_id) || 0;
    const loggedHours = Math.round((hoursByUser.get(p.user_id) || 0) * 100) / 100;

    // Resigned in a prior cycle — won't appear at all.
    if (resignedBefore) {
      return {
        user_id: p.user_id,
        name: u?.fullName || u?.name || p.user_id.slice(0, 8),
        logged_shifts: 0,
        logged_hours: 0,
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
    const scheduledShifts = scheduledCountByUser.get(p.user_id) || 0;
    if (loggedShifts === 0 && scheduledShifts > 0) {
      // Rostered but never clocked — THAT'S the anomaly worth a warning
      // (no-show, or the clock-in never happened / wasn't closed). A PT who
      // simply isn't on this week's roster raises nothing.
      issues.push({
        code: "scheduled_no_clockins",
        severity: "warn",
        message: `Scheduled ${scheduledShifts} shift${scheduledShifts > 1 ? "s" : ""} this week but has NO clock-ins — check before paying.`,
      });
    }

    if (loggedShifts > 0 && (!u?.bankName || !u?.bankAccountNumber)) {
      issues.push({
        code: "missing_bank",
        severity: "warn",
        message: "No bank account on file — the payment file will BLOCK until it's added on the employee page.",
      });
    }

    const blocked = issues.some((i) => i.severity === "block");
    let statusLabel: "ready" | "warning" | "blocked" | "skipped" = "ready";
    if (blocked) statusLabel = "blocked";
    else if (issues.length > 0) statusLabel = "warning";

    return {
      user_id: p.user_id,
      name: u?.fullName || u?.name || p.user_id.slice(0, 8),
      logged_shifts: loggedShifts,
      logged_hours: loggedHours,
      skipped: false,
      skip_reason: null,
      issues,
      status: statusLabel,
    };
  });

  const summary = {
    total_part_timers: rows.length,
    payable: rows.filter((r) => r.logged_shifts > 0 && r.status !== "blocked").length,
    no_clockins: rows.filter((r) => r.logged_shifts === 0 && r.status !== "skipped").length,
    blocked: rows.filter((r) => r.status === "blocked").length,
    warning: rows.filter((r) => r.status === "warning").length,
    skipped: rows.filter((r) => r.status === "skipped").length,
    final_payroll: rows.filter((r) => r.issues.some((i) => i.code === "final_payroll")).length,
    total_logged_shifts: (rows as { logged_shifts: number }[]).reduce((s, r) => s + r.logged_shifts, 0),
    total_logged_hours: Math.round((rows as { logged_hours: number }[]).reduce((s, r) => s + r.logged_hours, 0) * 100) / 100,
  };

  return NextResponse.json({ summary, rows });
}
