import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { hrSupabaseAdmin } from "@/lib/hr/supabase";
import { prisma } from "@/lib/prisma";
import { getAccessibleOutletIds } from "@/lib/hr/scope";

export const dynamic = "force-dynamic";

// Malaysia is UTC+8 with no DST, so a calendar day maps cleanly to a fixed
// offset window. Used to bound clock_in (timestamptz) to the requested date.
const MY_OFFSET = "+08:00";

type RosterStatus = "present" | "late" | "absent" | "on_leave" | "unscheduled";

// GET: daily roster — every scheduled employee for one outlet on one date,
// reconciled against actual clock-ins. Unlike /api/hr/attendance (which only
// surfaces existing logs), this starts from the SCHEDULE, so no-shows appear.
export async function GET(req: NextRequest) {
  const session = await getSession();
  if (!session || !["OWNER", "ADMIN", "MANAGER"].includes(session.role)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { searchParams } = new URL(req.url);
  const date = searchParams.get("date"); // YYYY-MM-DD (the day to reconcile)
  if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    return NextResponse.json({ error: "date=YYYY-MM-DD required" }, { status: 400 });
  }

  // Outlet scope: MANAGER limited to assigned outlets; OWNER/ADMIN see all.
  const requestedOutletId = searchParams.get("outlet_id");
  const allowedOutletIds = await getAccessibleOutletIds(session);

  const outlets = await prisma.outlet.findMany({
    where: {
      status: "ACTIVE",
      ...(allowedOutletIds !== null ? { id: { in: allowedOutletIds } } : {}),
    },
    select: { id: true, name: true },
    orderBy: { name: "asc" },
  });

  // Resolve the active outlet: honor the URL param only if accessible,
  // otherwise fall back to the first outlet in scope.
  let outletId: string | null;
  if (allowedOutletIds === null) {
    outletId = requestedOutletId || outlets[0]?.id || null;
  } else {
    outletId =
      requestedOutletId && allowedOutletIds.includes(requestedOutletId)
        ? requestedOutletId
        : allowedOutletIds[0] || null;
  }

  if (!outletId) {
    return NextResponse.json({ date, outlet_id: null, outlets, rows: [] });
  }

  const dayStart = `${date}T00:00:00${MY_OFFSET}`;
  const nextDay = new Date(`${date}T12:00:00Z`);
  nextDay.setUTCDate(nextDay.getUTCDate() + 1);
  const dayEnd = `${nextDay.toISOString().slice(0, 10)}T00:00:00${MY_OFFSET}`;

  // 1. Schedule(s) covering this date for the outlet, then the shifts on this day.
  // Published-only: drafts/ai_generated/archived schedules don't count as the
  // expected roster, so staff aren't marked absent against unpublished plans.
  const { data: schedules } = await hrSupabaseAdmin
    .from("hr_schedules")
    .select("id")
    .eq("outlet_id", outletId)
    .eq("status", "published")
    .lte("week_start", date)
    .gte("week_end", date);

  const scheduleIds = (schedules || []).map((s: { id: string }) => s.id);

  type ShiftRow = {
    user_id: string;
    start_time: string;
    end_time: string;
    role_type: string | null;
  };
  let shifts: ShiftRow[] = [];
  if (scheduleIds.length > 0) {
    const { data } = await hrSupabaseAdmin
      .from("hr_schedule_shifts")
      .select("user_id, start_time, end_time, role_type")
      .in("schedule_id", scheduleIds)
      .eq("shift_date", date);
    shifts = data || [];
  }

  // 2. Actual clock-ins at this outlet on this date.
  type LogRow = {
    id: string;
    user_id: string;
    clock_in: string;
    clock_out: string | null;
    total_hours: number | null;
    ai_flags: string[] | null;
  };
  const { data: logsRaw } = await hrSupabaseAdmin
    .from("hr_attendance_logs")
    .select("id, user_id, clock_in, clock_out, total_hours, ai_flags")
    .eq("outlet_id", outletId)
    .gte("clock_in", dayStart)
    .lt("clock_in", dayEnd)
    .order("clock_in", { ascending: true });
  const logs: LogRow[] = logsRaw || [];

  // Keep the earliest clock-in per user as their shift's actual.
  const logByUser = new Map<string, LogRow>();
  for (const l of logs) {
    if (!logByUser.has(l.user_id)) logByUser.set(l.user_id, l);
  }

  // 3. Approved leave covering this date (scheduled person on leave != absent).
  const scheduledUserIds = Array.from(new Set(shifts.map((s) => s.user_id)));
  const allUserIds = Array.from(
    new Set([...scheduledUserIds, ...logs.map((l) => l.user_id)]),
  );

  const { data: leaves } = scheduledUserIds.length
    ? await hrSupabaseAdmin
        .from("hr_leave_requests")
        .select("user_id, leave_type")
        .in("status", ["approved", "ai_approved"])
        .in("user_id", scheduledUserIds)
        .lte("start_date", date)
        .gte("end_date", date)
    : { data: [] as { user_id: string; leave_type: string }[] };
  const leaveByUser = new Map(
    (leaves || []).map((l: { user_id: string; leave_type: string }) => [l.user_id, l.leave_type]),
  );

  // 4. Names.
  const users = allUserIds.length
    ? await prisma.user.findMany({
        where: { id: { in: allUserIds } },
        select: { id: true, name: true, fullName: true },
      })
    : [];
  const userMap = new Map(users.map((u) => [u.id, u]));

  const nameOf = (id: string) => {
    const u = userMap.get(id);
    return {
      user_name: u?.fullName || u?.name || null,
      user_nickname: u?.name || null,
    };
  };

  const rows: Array<{
    user_id: string;
    user_name: string | null;
    user_nickname: string | null;
    status: RosterStatus;
    scheduled_start: string | null;
    scheduled_end: string | null;
    role_type: string | null;
    clock_in: string | null;
    clock_out: string | null;
    total_hours: number | null;
    leave_type: string | null;
    log_id: string | null;
    no_clock_out: boolean;
  }> = [];

  // Scheduled people first (these can be present/late/absent/on_leave).
  for (const shift of shifts) {
    const log = logByUser.get(shift.user_id);
    const onLeave = leaveByUser.get(shift.user_id);
    const flags = log?.ai_flags || [];

    let status: RosterStatus;
    if (log) {
      status = flags.includes("late_arrival") ? "late" : "present";
    } else if (onLeave) {
      status = "on_leave";
    } else {
      status = "absent";
    }

    rows.push({
      user_id: shift.user_id,
      ...nameOf(shift.user_id),
      status,
      scheduled_start: shift.start_time ? shift.start_time.slice(0, 5) : null,
      scheduled_end: shift.end_time ? shift.end_time.slice(0, 5) : null,
      role_type: shift.role_type,
      clock_in: log?.clock_in || null,
      clock_out: log?.clock_out || null,
      total_hours: log?.total_hours ?? null,
      leave_type: onLeave || null,
      log_id: log?.id || null,
      no_clock_out: !!log && !log.clock_out,
    });
  }

  // Then clock-ins from people NOT on the schedule for this day.
  const scheduledSet = new Set(scheduledUserIds);
  for (const [userId, log] of logByUser) {
    if (scheduledSet.has(userId)) continue;
    rows.push({
      user_id: userId,
      ...nameOf(userId),
      status: "unscheduled",
      scheduled_start: null,
      scheduled_end: null,
      role_type: null,
      clock_in: log.clock_in,
      clock_out: log.clock_out,
      total_hours: log.total_hours ?? null,
      leave_type: null,
      log_id: log.id,
      no_clock_out: !log.clock_out,
    });
  }

  // Stable, scan-friendly order: problems first, then by name.
  const statusRank: Record<RosterStatus, number> = {
    absent: 0,
    late: 1,
    unscheduled: 2,
    on_leave: 3,
    present: 4,
  };
  rows.sort((a, b) => {
    const r = statusRank[a.status] - statusRank[b.status];
    if (r !== 0) return r;
    return (a.user_name || "").localeCompare(b.user_name || "");
  });

  const summary = {
    scheduled: shifts.length,
    present: rows.filter((r) => r.status === "present").length,
    late: rows.filter((r) => r.status === "late").length,
    absent: rows.filter((r) => r.status === "absent").length,
    on_leave: rows.filter((r) => r.status === "on_leave").length,
    unscheduled: rows.filter((r) => r.status === "unscheduled").length,
    has_schedule: scheduleIds.length > 0,
  };

  return NextResponse.json({ date, outlet_id: outletId, outlets, rows, summary });
}
