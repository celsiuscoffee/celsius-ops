import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
// Service-role client: hr_* tables are RLS-enabled with no policies — access is
// scoped by the getSession gate + explicit filters below.
import { supabaseAdmin as supabase } from "@/lib/supabase";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

// Open slots ("slots") — demand gaps posted by the AI schedule generator
// (source 'generator') or a manager (source 'manual'). Flow is REQUEST →
// ASSIGN (owner 2026-07-19: "they request, we assign"): any station-fit
// part-timer can raise a hand here; the manager assigns ONE from the
// backoffice grid, and only then does the real shift materialize. The
// WhatsApp TAKE flow keeps instant claim for urgent decline/no-show backfill.
//
// Weekly caps mirror the generator: 24h / 5 days per PT per week ACROSS
// outlets, one outlet per day (owner rules). Checked here to fail fast with
// a reason, and re-checked at assign time.

const PT_MAX_HOURS_PER_WEEK = 24;
const PT_MAX_DAYS_PER_WEEK = 5;

const isBOH = (position: string | null) => {
  const p = (position ?? "").toLowerCase();
  return p.includes("kitchen") || p.includes("chef") || p.includes("boh");
};
const fitsStation = (position: string | null, station: string) => {
  const p = (position ?? "").toLowerCase();
  return station === "kitchen" ? isBOH(position) : !isBOH(position) || p.includes("barista");
};
const toMin = (t: string) => Number(t.slice(0, 2)) * 60 + Number(t.slice(3, 5));
const mondayOf = (ymd: string) => {
  const d = new Date(ymd + "T00:00:00Z");
  return new Date(d.getTime() - ((d.getUTCDay() + 6) % 7) * 86400000).toISOString().slice(0, 10);
};
const addDays = (ymd: string, n: number) => {
  const d = new Date(ymd + "T00:00:00Z");
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};
const mytToday = () =>
  new Date(Date.now() + 8 * 3600_000).toISOString().slice(0, 10);

type OpenShift = {
  id: string;
  outlet_id: string;
  shift_date: string;
  start_time: string;
  end_time: string;
  break_minutes: number | null;
  station: string;
  role_type: string | null;
  template_id: string | null;
  status: string;
};

async function myWeekLoad(userId: string, weekStart: string) {
  // Hours + days the PT already holds THIS week across ALL outlets (published
  // or draft — a requested slot must respect caps against everything rostered).
  const { data } = await supabase
    .from("hr_schedule_shifts")
    .select("shift_date, start_time, end_time, break_minutes, notes")
    .eq("user_id", userId)
    .gte("shift_date", weekStart)
    .lte("shift_date", addDays(weekStart, 6))
    .neq("start_time", "00:00");
  let hours = 0;
  const days = new Set<string>();
  for (const s of data ?? []) {
    if (s.notes === "rest_day") continue;
    const h = (toMin(s.end_time) - toMin(s.start_time) - (s.break_minutes || 0)) / 60;
    if (h <= 0) continue;
    hours += h;
    days.add(s.shift_date);
  }
  return { hours, days };
}

// GET: requestable open slots at my outlet(s), with eligibility + my request state
export async function GET() {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const user = await prisma.user.findUnique({
    where: { id: session.id },
    select: { outletId: true, outletIds: true },
  });
  const outletIds = [...new Set([user?.outletId, ...(user?.outletIds ?? [])].filter(Boolean))] as string[];
  if (outletIds.length === 0) return NextResponse.json({ shifts: [], is_pt: false, week_hours: 0, week_days: 0 });

  const { data: profile } = await supabase
    .from("hr_employee_profiles")
    .select("position, employment_type")
    .eq("user_id", session.id)
    .maybeSingle();
  const isPT = ["part_time", "intern"].includes(profile?.employment_type ?? "");

  const today = mytToday();
  const { data: opens } = await supabase
    .from("hr_open_shifts")
    .select("id, outlet_id, shift_date, start_time, end_time, break_minutes, station, role_type, template_id, status")
    .eq("status", "open")
    .in("outlet_id", outletIds)
    .gte("shift_date", today)
    .order("shift_date")
    .order("start_time");
  const shifts = (opens ?? []) as OpenShift[];
  if (shifts.length === 0) {
    return NextResponse.json({ shifts: [], is_pt: isPT, week_hours: 0, week_days: 0 });
  }

  const outlets = await prisma.outlet.findMany({
    where: { id: { in: outletIds } },
    select: { id: true, name: true },
  });
  const outletName = new Map(outlets.map((o) => [o.id, o.name.replace(/^Celsius Coffee\s*/i, "")]));

  // My pending/assigned requests + total pending hand-raises per slot.
  const slotIds = shifts.map((s) => s.id);
  const { data: reqs } = await supabase
    .from("hr_open_shift_requests")
    .select("open_shift_id, user_id, status")
    .in("open_shift_id", slotIds)
    .in("status", ["pending", "assigned"]);
  const myReq = new Map<string, string>(); // slot id → my request status
  const pendingCount = new Map<string, number>();
  for (const r of reqs ?? []) {
    if (r.user_id === session.id) myReq.set(r.open_shift_id, r.status);
    if (r.status === "pending") pendingCount.set(r.open_shift_id, (pendingCount.get(r.open_shift_id) ?? 0) + 1);
  }

  // My existing shifts over the covered weeks (cap + same-day checks).
  const weekStarts = [...new Set(shifts.map((s) => mondayOf(s.shift_date)))];
  const loadByWeek = new Map<string, { hours: number; days: Set<string> }>();
  for (const ws of weekStarts) loadByWeek.set(ws, await myWeekLoad(session.id, ws));

  const { data: myLeaves } = await supabase
    .from("hr_leave_requests")
    .select("start_date, end_date")
    .eq("user_id", session.id)
    .in("status", ["approved", "ai_approved"])
    .gte("end_date", today);
  const onLeave = (date: string) =>
    (myLeaves ?? []).some((l) => l.start_date <= date && l.end_date >= date);

  const result = shifts.map((s) => {
    const load = loadByWeek.get(mondayOf(s.shift_date))!;
    const h = (toMin(s.end_time) - toMin(s.start_time) - (s.break_minutes || 0)) / 60;
    let blocked: string | null = null;
    if (!isPT) blocked = "Open slots are for part-timers";
    else if (!fitsStation(profile?.position ?? null, s.station)) blocked = `Needs a ${s.station} position`;
    else if (load.days.has(s.shift_date)) blocked = "You already work that day";
    else if (onLeave(s.shift_date)) blocked = "You're on leave that day";
    else if (load.hours + h > PT_MAX_HOURS_PER_WEEK) blocked = `Would exceed your ${PT_MAX_HOURS_PER_WEEK}h weekly cap`;
    else if (load.days.size >= PT_MAX_DAYS_PER_WEEK) blocked = `Already at ${PT_MAX_DAYS_PER_WEEK} days that week`;
    return {
      id: s.id,
      outlet_id: s.outlet_id,
      outlet_name: outletName.get(s.outlet_id) ?? "Outlet",
      shift_date: s.shift_date,
      start_time: s.start_time.slice(0, 5),
      end_time: s.end_time.slice(0, 5),
      hours: Math.round(h * 10) / 10,
      station: s.station,
      role_type: s.role_type,
      blocked,
      my_request: myReq.get(s.id) ?? null, // 'pending' | 'assigned' | null
      pending_requests: pendingCount.get(s.id) ?? 0,
    };
  });

  const thisWeek = loadByWeek.get(mondayOf(today)) ?? { hours: 0, days: new Set() };
  return NextResponse.json({
    shifts: result,
    is_pt: isPT,
    week_hours: Math.round(thisWeek.hours * 10) / 10,
    week_days: thisWeek.days.size,
  });
}

// POST: raise a hand for an open slot (request — manager assigns later).
export async function POST(req: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = (await req.json()) as { id?: string };
  if (!id) return NextResponse.json({ error: "id required" }, { status: 400 });

  const { data: target } = await supabase
    .from("hr_open_shifts")
    .select("*")
    .eq("id", id)
    .eq("status", "open")
    .maybeSingle();
  if (!target) {
    return NextResponse.json({ error: "This slot is no longer available." }, { status: 409 });
  }

  const user = await prisma.user.findUnique({
    where: { id: session.id },
    select: { outletId: true, outletIds: true },
  });
  const myOutlets = new Set([user?.outletId, ...(user?.outletIds ?? [])].filter(Boolean));
  if (!myOutlets.has(target.outlet_id)) {
    return NextResponse.json({ error: "This slot belongs to an outlet you're not assigned to." }, { status: 403 });
  }
  const { data: profile } = await supabase
    .from("hr_employee_profiles")
    .select("position, employment_type, join_date, end_date")
    .eq("user_id", session.id)
    .maybeSingle();
  if (!["part_time", "intern"].includes(profile?.employment_type ?? "")) {
    return NextResponse.json({ error: "Open slots are for part-timers — full-time schedules are set by your manager." }, { status: 403 });
  }
  if (!fitsStation(profile?.position ?? null, target.station)) {
    return NextResponse.json({ error: `This slot needs a ${target.station} position.` }, { status: 403 });
  }
  // Employment window — no requests before your start date or after your last day.
  if (profile?.end_date && target.shift_date > profile.end_date) {
    return NextResponse.json({ error: `This shift is after your last day (${profile.end_date}).` }, { status: 403 });
  }
  if (profile?.join_date && target.shift_date < profile.join_date) {
    return NextResponse.json({ error: `This shift is before your start date (${profile.join_date}).` }, { status: 403 });
  }
  const { data: leave } = await supabase
    .from("hr_leave_requests")
    .select("id")
    .eq("user_id", session.id)
    .in("status", ["approved", "ai_approved"])
    .lte("start_date", target.shift_date)
    .gte("end_date", target.shift_date)
    .limit(1);
  if ((leave ?? []).length > 0) {
    return NextResponse.json({ error: "You're on approved leave that day." }, { status: 409 });
  }
  const weekStart = mondayOf(target.shift_date);
  const load = await myWeekLoad(session.id, weekStart);
  if (load.days.has(target.shift_date)) {
    return NextResponse.json({ error: "You're already rostered that day (one outlet per day)." }, { status: 409 });
  }
  const h = (toMin(target.end_time) - toMin(target.start_time) - (target.break_minutes || 0)) / 60;
  if (load.hours + h > PT_MAX_HOURS_PER_WEEK) {
    return NextResponse.json(
      { error: `This would take you past the ${PT_MAX_HOURS_PER_WEEK}h weekly cap (you have ${Math.round(load.hours * 10) / 10}h).` },
      { status: 409 },
    );
  }
  if (load.days.size >= PT_MAX_DAYS_PER_WEEK) {
    return NextResponse.json({ error: `You're already at ${PT_MAX_DAYS_PER_WEEK} working days that week.` }, { status: 409 });
  }

  // Upsert my hand-raise; re-requesting after a withdraw flips it back to pending.
  const { error: upErr } = await supabase
    .from("hr_open_shift_requests")
    .upsert(
      { open_shift_id: target.id, user_id: session.id, status: "pending", decided_at: null, decided_by: null },
      { onConflict: "open_shift_id,user_id" },
    );
  if (upErr) return NextResponse.json({ error: upErr.message }, { status: 500 });

  return NextResponse.json({ success: true, status: "pending" });
}

// DELETE ?id= — withdraw my pending request.
export async function DELETE(req: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { searchParams } = new URL(req.url);
  const id = searchParams.get("id");
  if (!id) return NextResponse.json({ error: "id required" }, { status: 400 });

  const { error } = await supabase
    .from("hr_open_shift_requests")
    .update({ status: "withdrawn", decided_at: new Date().toISOString(), decided_by: session.id })
    .eq("open_shift_id", id)
    .eq("user_id", session.id)
    .eq("status", "pending");
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ success: true });
}
