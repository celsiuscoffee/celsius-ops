import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { hrSupabaseAdmin } from "@/lib/hr/supabase";
import { prisma } from "@/lib/prisma";
import { computeLateMinutes, mytDateString } from "@/lib/hr/hours";
import { GRACE_PERIOD_MINUTES } from "@/lib/hr/constants";
import { canAccessOutlet, hasModuleAccess } from "@/lib/hr/scope";
import { signAttendancePhotos } from "@/lib/hr/photos";

export const dynamic = "force-dynamic";

type Cell = {
  scheduled_start: string | null;
  scheduled_end: string | null;
  clock_in: string | null;
  clock_out: string | null;
  clock_in_method: string | null;
  clock_out_method: string | null;
  clock_in_lat: number | null;
  clock_in_lng: number | null;
  clock_out_lat: number | null;
  clock_out_lng: number | null;
  clock_in_photo_url: string | null;
  clock_out_photo_url: string | null;
  total_hours: number | null;
  regular_hours: number | null;
  overtime_hours: number | null;
  late_minutes: number;
  open: boolean;
  status: "on_time" | "late" | "absent" | "upcoming" | "rest_day" | "no_roster" | "off";
};

// `shiftEnded` = the rostered shift's scheduled end is already in the past
// (MYT). A rostered shift with no clock-in is only "absent" once it has
// ended — before then it's still "upcoming", so future/in-progress days are
// never pre-marked as no-shows.
function cellStatus(
  hasShift: boolean,
  hasLog: boolean,
  lateMin: number,
  shiftEnded: boolean,
  isRest: boolean,
): Cell["status"] {
  if (hasShift) return hasLog ? (lateMin > GRACE_PERIOD_MINUTES ? "late" : "on_time") : shiftEnded ? "absent" : "upcoming";
  if (hasLog) return "no_roster"; // clocked in without a rostered shift (incl. working a rest day)
  if (isRest) return "rest_day"; // explicitly scheduled off
  return "off"; // nothing at all
}

// Rest-day markers are saved as a shift with role_type "Rest Day" (times
// 00:00–00:00). They aren't real shifts, so they must never count as
// rostered/absent — surfaced separately as an explicit "Off day".
function isRealShift(s: { start_time: string; end_time: string | null; role_type: string | null }): boolean {
  if ((s.role_type ?? "").trim().toLowerCase() === "rest day") return false;
  if (s.end_time && s.start_time.slice(0, 5) === s.end_time.slice(0, 5)) return false;
  return true;
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
    .select(
      "user_id, clock_in, clock_out, clock_in_method, clock_out_method, clock_in_lat, clock_in_lng, clock_out_lat, clock_out_lng, clock_in_photo_url, clock_out_photo_url, total_hours, regular_hours, overtime_hours",
    )
    .eq("outlet_id", outletId)
    .gte("clock_in", windowStart)
    .lt("clock_in", windowEnd)
    .order("clock_in", { ascending: true });

  // Index by user+date. Earliest-starting shift / earliest clock-in wins.
  // Rest-day markers are indexed separately so a scheduled day off reads as
  // "Off day" rather than a real (absent) shift.
  const key = (u: string, d: string) => `${u}|${d}`;
  const shiftByKey = new Map<string, (typeof shifts)[number]>();
  const restKeys = new Set<string>();
  for (const s of shifts) {
    const k = key(s.user_id, s.shift_date);
    if (!isRealShift(s)) {
      restKeys.add(k);
      continue;
    }
    const prev = shiftByKey.get(k);
    if (!prev || s.start_time < prev.start_time) shiftByKey.set(k, s);
  }
  type LogRow = {
    clock_in: string; clock_out: string | null;
    clock_in_method: string | null; clock_out_method: string | null;
    clock_in_lat: number | null; clock_in_lng: number | null;
    clock_out_lat: number | null; clock_out_lng: number | null;
    clock_in_photo_url: string | null; clock_out_photo_url: string | null;
    total_hours: number | null; regular_hours: number | null; overtime_hours: number | null;
  };
  const logByKey = new Map<string, LogRow>();
  for (const l of (logs as (LogRow & { user_id: string })[]) || []) {
    const k = key(l.user_id, mytDateString(l.clock_in));
    if (!logByKey.has(k)) logByKey.set(k, l);
  }

  // Selfies live in a PRIVATE bucket as object paths — mint short-lived signed
  // URLs so the detail panel can actually render them.
  const photoUrls = await signAttendancePhotos(
    (logs || []).flatMap((l) => [l.clock_in_photo_url, l.clock_out_photo_url]),
  );

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

  const nowMs = Date.now();
  const buildCell = (uid: string, d: string): Cell => {
    const k = key(uid, d);
    const shift = shiftByKey.get(k) || null;
    const log = logByKey.get(k) || null;
    const lateMin = shift && log ? Math.max(0, computeLateMinutes(log.clock_in, shift.start_time, d)) : 0;
    // Has the scheduled shift already ended (MYT)? No end_time → end of day.
    const endClock = shift?.end_time && shift.end_time.slice(0, 5) !== "00:00" ? shift.end_time : "23:59:59";
    const shiftEnded = shift ? nowMs > Date.parse(`${d}T${endClock}+08:00`) : false;
    return {
      scheduled_start: shift ? shift.start_time.slice(0, 5) : null,
      scheduled_end: shift?.end_time ? shift.end_time.slice(0, 5) : null,
      clock_in: log?.clock_in ?? null,
      clock_out: log?.clock_out ?? null,
      clock_in_method: log?.clock_in_method ?? null,
      clock_out_method: log?.clock_out_method ?? null,
      clock_in_lat: log?.clock_in_lat ?? null,
      clock_in_lng: log?.clock_in_lng ?? null,
      clock_out_lat: log?.clock_out_lat ?? null,
      clock_out_lng: log?.clock_out_lng ?? null,
      clock_in_photo_url: log?.clock_in_photo_url ? (photoUrls.get(log.clock_in_photo_url) ?? null) : null,
      clock_out_photo_url: log?.clock_out_photo_url ? (photoUrls.get(log.clock_out_photo_url) ?? null) : null,
      total_hours: log?.total_hours ?? null,
      regular_hours: log?.regular_hours ?? null,
      overtime_hours: log?.overtime_hours ?? null,
      late_minutes: lateMin,
      open: !!log && !log.clock_out,
      status: cellStatus(!!shift, !!log, lateMin, shiftEnded, restKeys.has(k)),
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
    rostered: cells.filter((c) => ["on_time", "late", "absent", "upcoming"].includes(c.status)).length,
    present: cells.filter((c) => c.status === "on_time" || c.status === "late").length,
    late: cells.filter((c) => c.status === "late").length,
    absent: cells.filter((c) => c.status === "absent").length,
    upcoming: cells.filter((c) => c.status === "upcoming").length,
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
      const rank: Record<Cell["status"], number> = { absent: 0, late: 1, on_time: 2, upcoming: 3, no_roster: 4, rest_day: 5, off: 6 };
      return rank[a.status] - rank[b.status];
    });
  return NextResponse.json({ mode: "day", date: d, outlet, rows, summary: countStatuses(rows) });
}
