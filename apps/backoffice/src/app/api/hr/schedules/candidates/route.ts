import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { hrSupabaseAdmin } from "@/lib/hr/supabase";
import { prisma } from "@/lib/prisma";
import { canAccessOutlet, hasModuleAccess } from "@/lib/hr/scope";
import { computeLateMinutes, mytDateString } from "@/lib/hr/hours";
import { GRACE_PERIOD_MINUTES } from "@/lib/hr/constants";
import { minConcurrentInSlot } from "@/lib/hr/coverage";

export const dynamic = "force-dynamic";

// Fit-score weights (v1 hand-tuned defaults). These are echoed in the response
// and stored in each assist-log snapshot so they can later be re-learned from
// manager overrides. Keep them summing sensibly; cost is a *penalty*.
export const FIT_WEIGHTS = { reliability: 0.3, availability: 0.25, fairness: 0.2, skill: 0.15, home: 0.1, cost: 0.1 };

const toMin = (t: string) => {
  const [h, m] = t.split(":").map(Number);
  return h * 60 + (m || 0);
};
const overlaps = (aS: string, aE: string, bS: string, bE: string) => toMin(aS) < toMin(bE) && toMin(bS) < toMin(aE);
const clamp01 = (n: number) => Math.max(0, Math.min(1, n));

// GET /api/hr/schedules/candidates?outlet_id=X&date=YYYY-MM-DD[&start=HH:MM&end=HH:MM&role=]
//   - without start/end → the day's coverage picture + shift templates (for the picker)
//   - with start/end    → ranked candidates for that shift window
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
  const start = searchParams.get("start");
  const end = searchParams.get("end");
  const role = searchParams.get("role");
  if (!outletId || !date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    return NextResponse.json({ error: "outlet_id and a valid date are required" }, { status: 400 });
  }
  if (session.role === "MANAGER" && !(await canAccessOutlet(session, outletId))) {
    return NextResponse.json({ error: "Forbidden — managers can only view their assigned outlets" }, { status: 403 });
  }

  const weekday = new Date(date + "T00:00:00Z").getUTCDay(); // 0=Sun..6=Sat
  const dateMs = Date.parse(date + "T00:00:00Z");
  const daysSinceMonday = (weekday + 6) % 7;
  const weekStart = new Date(dateMs - daysSinceMonday * 86400000).toISOString().slice(0, 10);
  const weekEnd = new Date(dateMs + (6 - daysSinceMonday) * 86400000).toISOString().slice(0, 10);

  // Outlet + open window (fallback to 08:00–22:00).
  const outlet = await prisma.outlet.findUnique({ where: { id: outletId }, select: { id: true, name: true, openTime: true, closeTime: true } });
  if (!outlet) return NextResponse.json({ error: "Outlet not found" }, { status: 404 });
  const openT = (outlet.openTime || "08:00").slice(0, 5);
  const closeT = (outlet.closeTime || "22:00").slice(0, 5);

  // Coverage target for this weekday (daily concurrency requirement).
  const { data: covRules } = await hrSupabaseAdmin
    .from("hr_outlet_coverage_rules")
    .select("day_of_week, slot_start, slot_end, min_staff")
    .eq("outlet_id", outletId)
    .eq("day_of_week", weekday);
  const dayRules = (covRules || []) as { slot_start: string; slot_end: string; min_staff: number }[];

  // Shift templates for the window picker.
  const { data: tpls } = await hrSupabaseAdmin
    .from("hr_shift_templates")
    .select("id, label, start_time, end_time, break_minutes")
    .eq("is_active", true)
    .or(`outlet_id.eq.${outletId},outlet_id.is.null`)
    .order("sort_order");
  const templates = (tpls || []).map((t: { id: string; label: string; start_time: string; end_time: string; break_minutes: number }) => ({
    id: t.id, label: t.label, start_time: t.start_time.slice(0, 5), end_time: t.end_time.slice(0, 5), break_minutes: t.break_minutes,
  }));

  // Staff pool at this outlet (mirror the grid).
  const users = await prisma.user.findMany({
    where: { status: "ACTIVE", OR: [{ outletId }, { outletIds: { has: outletId } }], role: { in: ["STAFF", "MANAGER", "OWNER"] } },
    select: { id: true, name: true, fullName: true, outletId: true, outletIds: true },
    orderBy: { name: "asc" },
  });
  const userIds = users.map((u) => u.id);

  const { data: profiles } = userIds.length
    ? await hrSupabaseAdmin.from("hr_employee_profiles").select("user_id, position, employment_type, rest_day, schedule_required, basic_salary, hourly_rate").in("user_id", userIds)
    : { data: [] as ProfileRow[] };
  type ProfileRow = { user_id: string; position: string | null; employment_type: string | null; rest_day: number | null; schedule_required: boolean | null; basic_salary: number | null; hourly_rate: number | null };
  const profileMap = new Map<string, ProfileRow>((profiles || []).map((p: ProfileRow) => [p.user_id, p]));
  const pool = users.filter((u) => profileMap.get(u.id)?.schedule_required !== false);
  const poolIds = pool.map((u) => u.id);

  // This week's shifts (weekly hours + same-day double-book).
  const { data: wkShifts } = poolIds.length
    ? await hrSupabaseAdmin.from("hr_schedule_shifts").select("user_id, shift_date, start_time, end_time, break_minutes").in("user_id", poolIds).gte("shift_date", weekStart).lte("shift_date", weekEnd)
    : { data: [] as WkShift[] };
  type WkShift = { user_id: string; shift_date: string; start_time: string; end_time: string; break_minutes: number | null };
  const weeklyMin = new Map<string, number>();
  const sameDayShifts = new Map<string, WkShift[]>();
  for (const s of (wkShifts || []) as WkShift[]) {
    const dur = toMin(s.end_time) - toMin(s.start_time) - (s.break_minutes || 0);
    if (dur > 0) weeklyMin.set(s.user_id, (weeklyMin.get(s.user_id) || 0) + dur);
    if (s.shift_date === date) (sameDayShifts.get(s.user_id) || sameDayShifts.set(s.user_id, []).get(s.user_id)!).push(s);
  }

  // Leave covering the date.
  const { data: leaves } = poolIds.length
    ? await hrSupabaseAdmin.from("hr_leave_requests").select("user_id").in("status", ["approved", "ai_approved"]).in("user_id", poolIds).lte("start_date", date).gte("end_date", date)
    : { data: [] as { user_id: string }[] };
  const onLeave = new Set((leaves || []).map((l: { user_id: string }) => l.user_id));

  // Per-date blockouts + PT weekly availability for this weekday.
  const { data: blockouts } = poolIds.length
    ? await hrSupabaseAdmin.from("hr_staff_availability").select("user_id, availability").eq("date", date).in("user_id", poolIds)
    : { data: [] as { user_id: string; availability: string }[] };
  const blocked = new Set((blockouts || []).filter((b: { availability: string }) => b.availability === "unavailable" || b.availability === "off").map((b: { user_id: string }) => b.user_id));

  const { data: wkAvail } = poolIds.length
    ? await hrSupabaseAdmin.from("hr_staff_weekly_availability").select("user_id, day_of_week, available_from, available_until, is_preferred, max_shifts_per_week").in("user_id", poolIds).eq("day_of_week", weekday)
    : { data: [] as WkAvail[] };
  type WkAvail = { user_id: string; day_of_week: number; available_from: string | null; available_until: string | null; is_preferred: boolean | null; max_shifts_per_week: number | null };
  const wkAvailByUser = new Map<string, WkAvail[]>();
  for (const a of (wkAvail || []) as WkAvail[]) (wkAvailByUser.get(a.user_id) || wkAvailByUser.set(a.user_id, []).get(a.user_id)!).push(a);
  const anyWkAvail = new Set((wkAvail || []).map((a: WkAvail) => a.user_id)); // users who HAVE weekly-availability rows at all

  // Reliability: on-time rate over the last 60 days (Bayesian-shrunk so thin
  // histories aren't over-trusted). Uses the same lateness math as the roster view.
  const since = new Date(dateMs - 60 * 86400000).toISOString();
  const { data: att } = poolIds.length
    ? await hrSupabaseAdmin.from("hr_attendance_logs").select("user_id, clock_in, scheduled_start, scheduled_date").in("user_id", poolIds).gte("clock_in", since).not("clock_out", "is", null).not("scheduled_start", "is", null)
    : { data: [] as AttRow[] };
  type AttRow = { user_id: string; clock_in: string; scheduled_start: string | null; scheduled_date: string | null };
  const relAgg = new Map<string, { onTime: number; total: number }>();
  for (const a of (att || []) as AttRow[]) {
    const late = computeLateMinutes(a.clock_in, a.scheduled_start, a.scheduled_date ?? mytDateString(a.clock_in));
    const g = relAgg.get(a.user_id) || { onTime: 0, total: 0 };
    g.total += 1;
    if (late <= GRACE_PERIOD_MINUTES) g.onTime += 1;
    relAgg.set(a.user_id, g);
  }
  const PRIOR = 0.7, K = 3;
  const reliabilityOf = (uid: string) => {
    const g = relAgg.get(uid);
    return g ? (g.onTime + PRIOR * K) / (g.total + K) : PRIOR;
  };

  const { data: settings } = await hrSupabaseAdmin.from("hr_company_settings").select("max_regular_hours_per_week").limit(1).maybeSingle();
  const capH = Number(settings?.max_regular_hours_per_week ?? 45);

  // ---- Coverage picture (always returned) ----
  const { data: sched } = await hrSupabaseAdmin.from("hr_schedules").select("id").eq("outlet_id", outletId).eq("week_start", weekStart).maybeSingle();
  let daysShifts: { user_id: string; start_time: string; end_time: string }[] = [];
  if (sched) {
    const { data } = await hrSupabaseAdmin.from("hr_schedule_shifts").select("user_id, start_time, end_time, shift_date").eq("schedule_id", sched.id).eq("shift_date", date);
    daysShifts = (data || []).filter((s: { start_time: string }) => s.start_time !== "00:00");
  }
  const assignedHeadcount = new Set(daysShifts.map((s) => s.user_id)).size;
  const coverage = dayRules.map((r) => {
    const concurrent = minConcurrentInSlot(daysShifts.map((s) => ({ start_time: s.start_time, end_time: s.end_time })), r.slot_start.slice(0, 5), r.slot_end.slice(0, 5));
    return { slot_start: r.slot_start.slice(0, 5), slot_end: r.slot_end.slice(0, 5), min_staff: r.min_staff, concurrent, gap: Math.max(0, r.min_staff - concurrent) };
  });

  const base = {
    outlet: { id: outlet.id, name: outlet.name, open: openT, close: closeT },
    date, weekday, week_start: weekStart,
    coverage, assigned_headcount: assignedHeadcount,
    has_coverage_rule: dayRules.length > 0,
    templates,
    weights: FIT_WEIGHTS,
  };

  // No slot specified → just the coverage picture + templates.
  if (!start || !end) return NextResponse.json({ ...base, candidates: null });

  const slotH = Math.max(0, (toMin(end) - toMin(start)) / 60);

  const candidates = pool.map((u) => {
    const p = profileMap.get(u.id);
    const empType = p?.employment_type || "full_time";
    const isPT = empType === "part_time" || empType === "intern";
    const weeklyH = (weeklyMin.get(u.id) || 0) / 60;

    // Hard blocks (candidate stays visible; blocked ones drop to the bottom).
    const blocks: string[] = [];
    if ((sameDayShifts.get(u.id) || []).some((s) => overlaps(start, end, s.start_time.slice(0, 5), s.end_time.slice(0, 5)))) blocks.push("double_booked");
    if (onLeave.has(u.id)) blocks.push("on_leave");
    if (p?.rest_day != null && Number(p.rest_day) === weekday) blocks.push("rest_day");
    if (weeklyH + slotH > capH) blocks.push("over_cap");
    if (blocked.has(u.id)) blocks.push("unavailable");
    // PT with declared weekly availability that doesn't cover this window → unavailable.
    let availSignal = isPT ? 0.7 : 0.8; // neutral when unknown
    if (isPT && anyWkAvail.has(u.id)) {
      const rows = wkAvailByUser.get(u.id) || [];
      const covering = rows.filter((a) => {
        const from = (a.available_from || openT).slice(0, 5);
        const until = (a.available_until || closeT).slice(0, 5);
        return toMin(from) <= toMin(start) && toMin(until) >= toMin(end);
      });
      if (covering.length === 0) blocks.push("pt_unavailable");
      else availSignal = covering.some((a) => a.is_preferred) ? 1 : 0.85;
    }

    // Signals (0..1).
    const reliability = reliabilityOf(u.id);
    const fairness = clamp01(1 - weeklyH / capH);
    const home = u.outletId === outletId ? 1 : (u.outletIds || []).includes(outletId) ? 0.8 : 0.5;
    const skill = role
      ? (p?.position && (p.position.toLowerCase().includes(role.toLowerCase()) || role.toLowerCase().includes(p.position.toLowerCase())) ? 1 : 0.5)
      : 0.7;
    // Marginal-cost penalty: a salaried FT under the cap is nearly free at the
    // margin; a PT is pay-per-hour; anyone pushed into OT is the most expensive.
    let costNorm = isPT ? 0.6 : 0.2;
    if (weeklyH + slotH > capH) costNorm = 1;

    const fit = 100 * clamp01(
      FIT_WEIGHTS.reliability * reliability +
      FIT_WEIGHTS.availability * availSignal +
      FIT_WEIGHTS.fairness * fairness +
      FIT_WEIGHTS.skill * skill +
      FIT_WEIGHTS.home * home -
      FIT_WEIGHTS.cost * costNorm,
    );

    return {
      user_id: u.id,
      name: u.fullName || u.name || null,
      position: p?.position || null,
      employment_type: empType,
      fit_score: Math.round(fit),
      weekly_hours: Math.round(weeklyH * 10) / 10,
      weekly_hours_after: Math.round((weeklyH + slotH) * 10) / 10,
      signals: {
        reliability: Math.round(reliability * 100) / 100,
        availability: Math.round(availSignal * 100) / 100,
        fairness: Math.round(fairness * 100) / 100,
        skill,
        home,
      },
      hard_blocks: blocks,
    };
  });

  // Eligible (no blocks) first, then by fit desc.
  candidates.sort((a, b) => {
    const aB = a.hard_blocks.length > 0, bB = b.hard_blocks.length > 0;
    if (aB !== bB) return aB ? 1 : -1;
    return b.fit_score - a.fit_score;
  });

  return NextResponse.json({ ...base, slot: { start, end, role: role || null, hours: slotH }, candidates });
}
