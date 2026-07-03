import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { hrSupabaseAdmin } from "@/lib/hr/supabase";
import { prisma } from "@/lib/prisma";
import { computeLateMinutes } from "@/lib/hr/hours";
import { GRACE_PERIOD_MINUTES } from "@/lib/hr/constants";
import { canAccessOutlet, hasModuleAccess } from "@/lib/hr/scope";

export const dynamic = "force-dynamic";

// GET /api/hr/schedules/roster-attendance?outlet_id=X&date=YYYY-MM-DD
//
// Roster-vs-actual for one outlet on one day: every rostered shift with who
// actually clocked in, who's late, and who's absent — plus anyone who worked
// without being on the roster. Read-only companion to the Schedules grid.
export async function GET(req: NextRequest) {
  const session = await getSession();
  if (!session || !["OWNER", "ADMIN", "MANAGER"].includes(session.role)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (!(await hasModuleAccess(session, "hr:schedules"))) {
    return NextResponse.json({ error: "Forbidden — no access to Schedules" }, { status: 403 });
  }

  const { searchParams } = new URL(req.url);
  const outletId = searchParams.get("outlet_id");
  const date = searchParams.get("date"); // YYYY-MM-DD (MYT calendar day)
  if (!outletId || !date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    return NextResponse.json({ error: "outlet_id and a valid date are required" }, { status: 400 });
  }

  if (session.role === "MANAGER" && !(await canAccessOutlet(session, outletId))) {
    return NextResponse.json({ error: "Forbidden — managers can only view their assigned outlets" }, { status: 403 });
  }

  const outlet = await prisma.outlet.findUnique({ where: { id: outletId }, select: { id: true, name: true } });
  if (!outlet) return NextResponse.json({ error: "Outlet not found" }, { status: 404 });

  // 1. Rostered shifts for this outlet on this date (any status — rosters are
  //    often kept as draft). Two-step to stay off embed typing.
  const { data: scheds } = await hrSupabaseAdmin
    .from("hr_schedules")
    .select("id")
    .eq("outlet_id", outletId);
  const schedIds = (scheds || []).map((s: { id: string }) => s.id);

  let shifts: { user_id: string; start_time: string; end_time: string | null; role_type: string | null }[] = [];
  if (schedIds.length > 0) {
    const { data } = await hrSupabaseAdmin
      .from("hr_schedule_shifts")
      .select("user_id, start_time, end_time, role_type")
      .in("schedule_id", schedIds)
      .eq("shift_date", date);
    shifts = data || [];
  }
  // Keep the earliest-starting shift per user for the day.
  const shiftByUser = new Map<string, (typeof shifts)[number]>();
  for (const s of shifts) {
    const prev = shiftByUser.get(s.user_id);
    if (!prev || s.start_time < prev.start_time) shiftByUser.set(s.user_id, s);
  }

  // 2. Attendance logs at this outlet on this MYT calendar day.
  const startMs = Date.parse(`${date}T00:00:00+08:00`);
  const dayStart = new Date(startMs).toISOString();
  const dayEnd = new Date(startMs + 24 * 3600 * 1000).toISOString();
  const { data: logs } = await hrSupabaseAdmin
    .from("hr_attendance_logs")
    .select("user_id, clock_in, clock_out, total_hours")
    .eq("outlet_id", outletId)
    .gte("clock_in", dayStart)
    .lt("clock_in", dayEnd)
    .order("clock_in", { ascending: true });
  // Earliest clock-in per user is the shift start.
  const logByUser = new Map<string, { user_id: string; clock_in: string; clock_out: string | null; total_hours: number | null }>();
  for (const l of logs || []) {
    if (!logByUser.has(l.user_id)) logByUser.set(l.user_id, l);
  }

  // 3. Names + positions for everyone involved.
  const userIds = Array.from(new Set([...shiftByUser.keys(), ...logByUser.keys()]));
  const [users, profilesResp] = await Promise.all([
    userIds.length
      ? prisma.user.findMany({ where: { id: { in: userIds } }, select: { id: true, name: true, fullName: true } })
      : Promise.resolve([]),
    userIds.length
      ? hrSupabaseAdmin.from("hr_employee_profiles").select("user_id, position").in("user_id", userIds)
      : Promise.resolve({ data: [] as { user_id: string; position: string | null }[] }),
  ]);
  const userMap = new Map(users.map((u) => [u.id, u]));
  const positionMap = new Map((profilesResp.data || []).map((p: { user_id: string; position: string | null }) => [p.user_id, p.position]));

  type Row = {
    user_id: string;
    name: string | null;
    nickname: string | null;
    position: string | null;
    scheduled_start: string | null;
    scheduled_end: string | null;
    clock_in: string | null;
    clock_out: string | null;
    total_hours: number | null;
    late_minutes: number;
    open: boolean;
    status: "on_time" | "late" | "absent" | "no_roster";
  };

  const rows: Row[] = userIds.map((uid) => {
    const shift = shiftByUser.get(uid) || null;
    const log = logByUser.get(uid) || null;
    const u = userMap.get(uid);
    const lateMin = shift && log ? Math.max(0, computeLateMinutes(log.clock_in, shift.start_time, date)) : 0;
    let status: Row["status"];
    if (!shift) status = "no_roster";
    else if (!log) status = "absent";
    else if (lateMin > GRACE_PERIOD_MINUTES) status = "late";
    else status = "on_time";
    return {
      user_id: uid,
      name: u?.fullName || u?.name || null,
      nickname: u?.name || null,
      position: positionMap.get(uid) || shift?.role_type || null,
      scheduled_start: shift ? shift.start_time.slice(0, 5) : null,
      scheduled_end: shift?.end_time ? shift.end_time.slice(0, 5) : null,
      clock_in: log?.clock_in ?? null,
      clock_out: log?.clock_out ?? null,
      total_hours: log?.total_hours ?? null,
      late_minutes: lateMin,
      open: !!log && !log.clock_out,
      status,
    };
  });

  // Order: rostered first (by scheduled start), unrostered last; within that,
  // attention-needing (absent/late) bubble up.
  const statusRank: Record<Row["status"], number> = { absent: 0, late: 1, on_time: 2, no_roster: 3 };
  rows.sort((a, b) => {
    if ((a.status === "no_roster") !== (b.status === "no_roster")) return a.status === "no_roster" ? 1 : -1;
    if (a.scheduled_start && b.scheduled_start && a.scheduled_start !== b.scheduled_start) {
      return a.scheduled_start.localeCompare(b.scheduled_start);
    }
    return statusRank[a.status] - statusRank[b.status];
  });

  const summary = {
    rostered: shiftByUser.size,
    present: rows.filter((r) => r.status === "on_time" || r.status === "late").length,
    late: rows.filter((r) => r.status === "late").length,
    absent: rows.filter((r) => r.status === "absent").length,
    unrostered: rows.filter((r) => r.status === "no_roster").length,
  };

  return NextResponse.json({ date, outlet, rows, summary });
}
