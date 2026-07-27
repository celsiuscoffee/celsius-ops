import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { hrSupabaseAdmin } from "@/lib/hr/supabase";
import { prisma } from "@/lib/prisma";
import { canAccessOutlet, hasModuleAccess } from "@/lib/hr/scope";

export const dynamic = "force-dynamic";

// Manager surface for open slots (hr_open_shifts). Flow is REQUEST → ASSIGN
// (owner 2026-07-19: "they request, we assign"): the generator (or a manager,
// source 'manual') posts slots, part-timers raise a hand in the staff apps
// (hr_open_shift_requests), and the manager assigns ONE here — that's when
// the real hr_schedule_shifts row materializes on the (draft) week. After the
// week is filled, the normal labour-gated Publish makes it live to staff.

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

async function gate(outletId: string | null) {
  const session = await getSession();
  if (!session || !["OWNER", "ADMIN", "MANAGER"].includes(session.role)) {
    return { error: NextResponse.json({ error: "Unauthorized" }, { status: 401 }) };
  }
  if (!(await hasModuleAccess(session, "hr:schedules"))) {
    return { error: NextResponse.json({ error: "Forbidden — no access to Schedules" }, { status: 403 }) };
  }
  if (session.role === "MANAGER" && outletId && !(await canAccessOutlet(session, outletId))) {
    return { error: NextResponse.json({ error: "Forbidden — not your outlet" }, { status: 403 }) };
  }
  return { session };
}

async function weekLoad(userId: string, weekStart: string) {
  const { data } = await hrSupabaseAdmin
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

// GET ?outlet_id&week_start — the week's slots + pending hand-raises
export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const outletId = searchParams.get("outlet_id");
  const weekStart = searchParams.get("week_start");
  if (!outletId || !weekStart) {
    return NextResponse.json({ error: "outlet_id and week_start required" }, { status: 400 });
  }
  const g = await gate(outletId);
  if (g.error) return g.error;

  const weekEnd = addDays(weekStart, 6);
  const { data, error } = await hrSupabaseAdmin
    .from("hr_open_shifts")
    .select("id, shift_date, start_time, end_time, break_minutes, station, role_type, source, status, claimed_by, claimed_at")
    .eq("outlet_id", outletId)
    .gte("shift_date", weekStart)
    .lte("shift_date", weekEnd)
    .in("status", ["open", "claimed"])
    .order("shift_date")
    .order("start_time");
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  const slots = data ?? [];

  // Pending requests per slot, with requester name + current week load so the
  // manager can pick with the caps in view.
  const slotIds = slots.map((s) => s.id);
  const { data: reqRows } = slotIds.length
    ? await hrSupabaseAdmin
        .from("hr_open_shift_requests")
        .select("id, open_shift_id, user_id, status, created_at")
        .in("open_shift_id", slotIds)
        .eq("status", "pending")
        .order("created_at")
    : { data: [] as never[] };
  const requests = reqRows ?? [];

  const userIds = [
    ...new Set([...requests.map((r) => r.user_id), ...slots.map((s) => s.claimed_by).filter(Boolean)]),
  ] as string[];
  const users = userIds.length
    ? await prisma.user.findMany({ where: { id: { in: userIds } }, select: { id: true, name: true } })
    : [];
  const nameOf = new Map(users.map((u) => [u.id, u.name]));
  const load = new Map<string, { hours: number; days: Set<string> }>();
  for (const uid of new Set(requests.map((r) => r.user_id))) {
    load.set(uid, await weekLoad(uid, weekStart));
  }

  return NextResponse.json({
    slots: slots.map((s) => ({
      ...s,
      start_time: s.start_time.slice(0, 5),
      end_time: s.end_time.slice(0, 5),
      claimed_by_name: s.claimed_by ? (nameOf.get(s.claimed_by) ?? "someone") : null,
      requests: requests
        .filter((r) => r.open_shift_id === s.id)
        .map((r) => ({
          id: r.id,
          user_id: r.user_id,
          name: nameOf.get(r.user_id) ?? "someone",
          week_hours: Math.round((load.get(r.user_id)?.hours ?? 0) * 10) / 10,
          week_days: load.get(r.user_id)?.days.size ?? 0,
        })),
    })),
  });
}

// POST { action: "assign", request_id }
//      { action: "cancel", id }
//      { action: "create", outlet_id, shift_date, start_time, end_time, break_minutes?, station, role_type? }
export async function POST(req: NextRequest) {
  const body = await req.json();

  if (body.action === "assign") {
    const { request_id } = body as { request_id?: string };
    if (!request_id) return NextResponse.json({ error: "request_id required" }, { status: 400 });
    const { data: request } = await hrSupabaseAdmin
      .from("hr_open_shift_requests")
      .select("id, open_shift_id, user_id, status")
      .eq("id", request_id)
      .maybeSingle();
    if (!request || request.status !== "pending") {
      return NextResponse.json({ error: "Request not found or already decided" }, { status: 404 });
    }
    const { data: slot } = await hrSupabaseAdmin
      .from("hr_open_shifts")
      .select("*")
      .eq("id", request.open_shift_id)
      .maybeSingle();
    if (!slot || slot.status !== "open") {
      return NextResponse.json({ error: "Slot is no longer open" }, { status: 409 });
    }
    const g = await gate(slot.outlet_id);
    if (g.error) return g.error;

    // Re-validate the person NOW — their week may have changed since they asked.
    const { data: profile } = await hrSupabaseAdmin
      .from("hr_employee_profiles")
      .select("position, employment_type, join_date, end_date")
      .eq("user_id", request.user_id)
      .maybeSingle();
    if (!fitsStation(profile?.position ?? null, slot.station)) {
      return NextResponse.json({ error: `They don't fit the ${slot.station} station` }, { status: 409 });
    }
    if (profile?.end_date && slot.shift_date > profile.end_date) {
      return NextResponse.json({ error: `Their last day is ${profile.end_date} — the shift is after it` }, { status: 409 });
    }
    if (profile?.join_date && slot.shift_date < profile.join_date) {
      return NextResponse.json({ error: `They only start on ${profile.join_date}` }, { status: 409 });
    }
    const weekStart = mondayOf(slot.shift_date);
    const wl = await weekLoad(request.user_id, weekStart);
    const h = (toMin(slot.end_time) - toMin(slot.start_time) - (slot.break_minutes || 0)) / 60;
    if (wl.days.has(slot.shift_date)) {
      return NextResponse.json({ error: "They're already rostered that day (one outlet per day)" }, { status: 409 });
    }
    if (wl.hours + h > PT_MAX_HOURS_PER_WEEK) {
      return NextResponse.json({ error: `Assigning would exceed their ${PT_MAX_HOURS_PER_WEEK}h weekly cap (${Math.round(wl.hours * 10) / 10}h now)` }, { status: 409 });
    }
    if (wl.days.size >= PT_MAX_DAYS_PER_WEEK) {
      return NextResponse.json({ error: `They're already at ${PT_MAX_DAYS_PER_WEEK} working days that week` }, { status: 409 });
    }

    // Take the slot (optimistic — only if still open).
    const { data: claimed } = await hrSupabaseAdmin
      .from("hr_open_shifts")
      .update({ status: "claimed", claimed_by: request.user_id, claimed_at: new Date().toISOString() })
      .eq("id", slot.id)
      .eq("status", "open")
      .select("id")
      .maybeSingle();
    if (!claimed) return NextResponse.json({ error: "Slot was just taken" }, { status: 409 });

    const release = () =>
      hrSupabaseAdmin.from("hr_open_shifts").update({ status: "open", claimed_by: null, claimed_at: null }).eq("id", slot.id);

    const { data: sched } = await hrSupabaseAdmin
      .from("hr_schedules")
      .select("id")
      .eq("outlet_id", slot.outlet_id)
      .eq("week_start", weekStart)
      .maybeSingle();
    if (!sched) {
      await release();
      return NextResponse.json({ error: "No schedule exists for that week — generate it first" }, { status: 409 });
    }
    const { data: shiftRow, error: insErr } = await hrSupabaseAdmin
      .from("hr_schedule_shifts")
      .insert({
        schedule_id: sched.id,
        user_id: request.user_id,
        shift_date: slot.shift_date,
        start_time: slot.start_time,
        end_time: slot.end_time,
        role_type: slot.role_type ?? (slot.station === "kitchen" ? "Kitchen Cover" : "Cover"),
        break_minutes: slot.break_minutes ?? 30,
        notes: slot.template_id,
        ack_status: "acknowledged",
        acknowledged_at: new Date().toISOString(),
        is_ai_assigned: false,
      })
      .select("id")
      .single();
    if (insErr || !shiftRow) {
      await release();
      return NextResponse.json({ error: "Failed to create the shift — try again" }, { status: 500 });
    }
    await hrSupabaseAdmin.from("hr_open_shifts").update({ claimed_shift_id: shiftRow.id }).eq("id", slot.id);

    const now = new Date().toISOString();
    const decider = g.session!.id;
    await hrSupabaseAdmin
      .from("hr_open_shift_requests")
      .update({ status: "assigned", decided_at: now, decided_by: decider })
      .eq("id", request.id);
    await hrSupabaseAdmin
      .from("hr_open_shift_requests")
      .update({ status: "declined", decided_at: now, decided_by: decider })
      .eq("open_shift_id", slot.id)
      .eq("status", "pending");

    return NextResponse.json({ success: true });
  }

  if (body.action === "cancel") {
    const { id } = body as { id?: string };
    if (!id) return NextResponse.json({ error: "id required" }, { status: 400 });
    const { data: slot } = await hrSupabaseAdmin
      .from("hr_open_shifts")
      .select("outlet_id, status")
      .eq("id", id)
      .maybeSingle();
    if (!slot) return NextResponse.json({ error: "Slot not found" }, { status: 404 });
    const g = await gate(slot.outlet_id);
    if (g.error) return g.error;
    // Only still-open slots can be cancelled — an assigned one is already a
    // real shift on the grid; remove it there instead.
    const { data: cancelled } = await hrSupabaseAdmin
      .from("hr_open_shifts")
      .update({ status: "cancelled" })
      .eq("id", id)
      .eq("status", "open")
      .select("id")
      .maybeSingle();
    if (!cancelled) {
      return NextResponse.json({ error: "Already assigned — remove the shift from the grid instead" }, { status: 409 });
    }
    await hrSupabaseAdmin
      .from("hr_open_shift_requests")
      .update({ status: "declined", decided_at: new Date().toISOString(), decided_by: g.session!.id })
      .eq("open_shift_id", id)
      .eq("status", "pending");
    return NextResponse.json({ success: true });
  }

  if (body.action === "create") {
    const { outlet_id, shift_date, start_time, end_time, break_minutes, station, role_type } = body as {
      outlet_id?: string; shift_date?: string; start_time?: string; end_time?: string;
      break_minutes?: number; station?: string; role_type?: string;
    };
    if (!outlet_id || !shift_date || !start_time || !end_time || !station) {
      return NextResponse.json({ error: "outlet_id, shift_date, start_time, end_time, station required" }, { status: 400 });
    }
    if (!["barista", "kitchen"].includes(station)) {
      return NextResponse.json({ error: "station must be barista or kitchen" }, { status: 400 });
    }
    if (!/^\d{2}:\d{2}$/.test(start_time) || !/^\d{2}:\d{2}$/.test(end_time) || start_time >= end_time) {
      return NextResponse.json({ error: "times must be HH:MM with start before end" }, { status: 400 });
    }
    const g = await gate(outlet_id);
    if (g.error) return g.error;
    const { data, error } = await hrSupabaseAdmin
      .from("hr_open_shifts")
      .insert({
        outlet_id,
        shift_date,
        start_time,
        end_time,
        break_minutes: break_minutes ?? 30,
        station,
        role_type: role_type ?? null,
        source: "manual",
        status: "open",
        expires_at: `${shift_date}T${start_time}:00+08:00`,
      })
      .select("id")
      .single();
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ success: true, id: data.id });
  }

  return NextResponse.json({ error: "Unknown action" }, { status: 400 });
}
