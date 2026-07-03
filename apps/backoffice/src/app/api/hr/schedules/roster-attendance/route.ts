import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { hrSupabaseAdmin } from "@/lib/hr/supabase";
import { prisma } from "@/lib/prisma";
import { computeLateMinutes, mytDateString } from "@/lib/hr/hours";
import { GRACE_PERIOD_MINUTES } from "@/lib/hr/constants";
import { canAccessOutlet, hasModuleAccess } from "@/lib/hr/scope";

export const dynamic = "force-dynamic";

type Cell = {
  scheduled_start: string | null;
  scheduled_end: string | null;
  clock_in: string | null;
  clock_out: string | null;
  total_hours: number | null;
  late_minutes: number;
  open: boolean;
  status: "on_time" | "late" | "absent" | "no_roster" | "off";
};

function cellStatus(hasShift: boolean, hasLog: boolean, lateMin: number): Cell["status"] {
  if (!hasShift && !hasLog) return "off"; // not scheduled and didn't work
  if (!hasShift) return "no_roster"; // worked without a roster
  if (!hasLog) return "absent"; // rostered but no-show
  return lateMin > GRACE_PERIOD_MINUTES ? "late" : "on_time";
}

// GET /api/hr/schedules/roster-attendance?outlet_id=X&date=YYYY-MM-DD
//                                        (or) &week_start=YYYY-MM-DD (Monday)
//
// Roster-vs-actual for one outlet. `date` → a single day's rows; `week_start`
// → a staff × 7-day matrix. Read-only companion to the Schedules grid.
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
  const date = searchParams.get("date");
  const weekStart = searchParams.get("week_start");
  const anchor = weekStart || date;
  if (!outletId || !anchor || !/^\d{4}-\d{2}-\d{2}$/.test(anchor)) {
    return NextResponse.json({ error: "outlet_id and a valid date or week_start are required" }, { status: 400 });
  }

  if (session.role === "MANAGER" && !(await canAccessOutlet(session, outletId))) {
    return NextResponse.json({ error: "Forbidden — managers can only view their assigned outlets" }, { status: 403 });
  }

  const outlet = await prisma.outlet.findUnique({ where: { id: outletId }, select: { id: true, name: true } });
  if (!outlet) return NextResponse.json({ error: "Outlet not found" }, { status: 404 });

  // Days covered by this query (1 for day mode, 7 for week mode).
  const days: string[] = [];
  if (weekStart) {
    const startMs = Date.parse(`${weekStart}T00:00:00+08:00`);
    for (let i = 0; i < 7; i++) days.push(mytDateString(new Date(startMs + i * 24 * 3600 * 1000)));
  } else {
    days.push(anchor);
  }

  // 1. Rostered shifts across these days (any status — rosters are often draft).
  const { data: scheds } = await hrSupabaseAdmin.from("hr_schedules").select("id").eq("outlet_id", outletId);
  const schedIds = (scheds || []).map((s: { id: string }) => s.id);
  let shifts: { user_id: string; shift_date: string; start_time: string; end_time: string | null; role_type: string | null }[] = [];
  if (schedIds.length > 0) {
    const { data } = await hrSupabaseAdmin
      .from("hr_schedule_shifts")
      .select("user_id, shift_date, start_time, end_time, role_type")
      .in("schedule_id", schedIds)
      .in("shift_date", days);
    shifts = data || [];
  }

  // 2. Attendance logs across the window at this outlet.
  const windowStartMs = Date.parse(`${days[0]}T00:00:00+08:00`);
  const windowStart = new Date(windowStartMs).toISOString();
  const windowEnd = new Date(windowStartMs + days.length * 24 * 3600 * 1000).toISOString();
  const { data: logs } = await hrSupabaseAdmin
    .from("hr_attendance_logs")
    .select("user_id, clock_in, clock_out, total_hours")
    .eq("outlet_id", outletId)
    .gte("clock_in", windowStart)
    .lt("clock_in", windowEnd)
    .order("clock_in", { ascending: true });

  // Index by user+date. Earliest-starting shift / earliest clock-in wins.
  const key = (u: string, d: string) => `${u}|${d}`;
  const shiftByKey = new Map<string, (typeof shifts)[number]>();
  for (const s of shifts) {
    const k = key(s.user_id, s.shift_date);
    const prev = shiftByKey.get(k);
    if (!prev || s.start_time < prev.start_time) shiftByKey.set(k, s);
  }
  const logByKey = new Map<string, { clock_in: string; clock_out: string | null; total_hours: number | null }>();
  for (const l of logs || []) {
    const k = key(l.user_id, mytDateString(l.clock_in));
    if (!logByKey.has(k)) logByKey.set(k, l);
  }

  // 3. Names + positions for everyone involved.
  const userIds = Array.from(
    new Set([...shifts.map((s) => s.user_id), ...(logs || []).map((l) => l.user_id)]),
  );
  const [users, profilesResp] = await Promise.all([
    userIds.length
      ? prisma.user.findMany({ where: { id: { in: userIds } }, select: { id: true, name: true, fullName: true } })
      : Promise.resolve([]),
    userIds.length
      ? hrSupabaseAdmin.from("hr_employee_profiles").select("user_id, position").in("user_id", userIds)
      : Promise.resolve({ data: [] as { user_id: string; position: string | null }[] }),
  ]);
  const userMap = new Map(users.map((u) => [u.id, u]));
  const positionMap = new Map(
    (profilesResp.data || []).map((p: { user_id: string; position: string | null }) => [p.user_id, p.position]),
  );

  const buildCell = (uid: string, d: string): Cell => {
    const shift = shiftByKey.get(key(uid, d)) || null;
    const log = logByKey.get(key(uid, d)) || null;
    const lateMin = shift && log ? Math.max(0, computeLateMinutes(log.clock_in, shift.start_time, d)) : 0;
    return {
      scheduled_start: shift ? shift.start_time.slice(0, 5) : null,
      scheduled_end: shift?.end_time ? shift.end_time.slice(0, 5) : null,
      clock_in: log?.clock_in ?? null,
      clock_out: log?.clock_out ?? null,
      total_hours: log?.total_hours ?? null,
      late_minutes: lateMin,
      open: !!log && !log.clock_out,
      status: cellStatus(!!shift, !!log, lateMin),
    };
  };

  const meta = (uid: string) => {
    const u = userMap.get(uid);
    return {
      user_id: uid,
      name: u?.fullName || u?.name || null,
      nickname: u?.name || null,
      position: positionMap.get(uid) || null,
    };
  };

  const countStatuses = (cells: Cell[]) => ({
    rostered: cells.filter((c) => c.status === "on_time" || c.status === "late" || c.status === "absent").length,
    present: cells.filter((c) => c.status === "on_time" || c.status === "late").length,
    late: cells.filter((c) => c.status === "late").length,
    absent: cells.filter((c) => c.status === "absent").length,
    unrostered: cells.filter((c) => c.status === "no_roster").length,
  });

  // ---- WEEK MODE: staff × day matrix ----
  if (weekStart) {
    const staff = userIds
      .map((uid) => ({ ...meta(uid), days: Object.fromEntries(days.map((d) => [d, buildCell(uid, d)])) }))
      .sort((a, b) => (a.name || "").localeCompare(b.name || ""));
    const allCells = staff.flatMap((s) => days.map((d) => s.days[d]));
    return NextResponse.json({ mode: "week", week_start: weekStart, days, outlet, staff, summary: countStatuses(allCells) });
  }

  // ---- DAY MODE: flat rows ----
  const d = days[0];
  const rows = userIds
    .map((uid) => ({ ...meta(uid), position: positionMap.get(uid) || shiftByKey.get(key(uid, d))?.role_type || null, ...buildCell(uid, d), user_id: uid }))
    .sort((a, b) => {
      if ((a.status === "no_roster") !== (b.status === "no_roster")) return a.status === "no_roster" ? 1 : -1;
      if (a.scheduled_start && b.scheduled_start && a.scheduled_start !== b.scheduled_start) {
        return a.scheduled_start.localeCompare(b.scheduled_start);
      }
      const rank: Record<Cell["status"], number> = { absent: 0, late: 1, on_time: 2, no_roster: 3, off: 4 };
      return rank[a.status] - rank[b.status];
    });
  return NextResponse.json({ mode: "day", date: d, outlet, rows, summary: countStatuses(rows) });
}
