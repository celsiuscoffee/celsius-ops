import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { hrSupabaseAdmin } from "@/lib/hr/supabase";
import { prisma } from "@/lib/prisma";
import { canAccessOutlet, hasModuleAccess } from "@/lib/hr/scope";

export const dynamic = "force-dynamic";

// Manager surface for open slots (hr_open_shifts): the generator and the
// WhatsApp PT loop post them; staff book them first-come-first-served. This
// route lets the backoffice SEE the week's slots (with who booked what),
// CANCEL a stale open slot, and POST a manual one (source 'manual').

async function gate(req: NextRequest, outletId: string | null) {
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

// GET ?outlet_id&week_start — the week's slots, claimed ones annotated
export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const outletId = searchParams.get("outlet_id");
  const weekStart = searchParams.get("week_start");
  if (!outletId || !weekStart) {
    return NextResponse.json({ error: "outlet_id and week_start required" }, { status: 400 });
  }
  const g = await gate(req, outletId);
  if (g.error) return g.error;

  const end = new Date(weekStart + "T00:00:00Z");
  end.setUTCDate(end.getUTCDate() + 6);
  const weekEnd = end.toISOString().slice(0, 10);

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

  const claimantIds = [...new Set((data ?? []).map((s) => s.claimed_by).filter(Boolean))] as string[];
  const claimants = claimantIds.length
    ? await prisma.user.findMany({ where: { id: { in: claimantIds } }, select: { id: true, name: true } })
    : [];
  const nameOf = new Map(claimants.map((u) => [u.id, u.name]));

  return NextResponse.json({
    slots: (data ?? []).map((s) => ({
      ...s,
      start_time: s.start_time.slice(0, 5),
      end_time: s.end_time.slice(0, 5),
      claimed_by_name: s.claimed_by ? (nameOf.get(s.claimed_by) ?? "someone") : null,
    })),
  });
}

// POST { action: "cancel", id } | { action: "create", outlet_id, shift_date,
//        start_time, end_time, break_minutes?, station, role_type? }
export async function POST(req: NextRequest) {
  const body = await req.json();

  if (body.action === "cancel") {
    const { id } = body as { id?: string };
    if (!id) return NextResponse.json({ error: "id required" }, { status: 400 });
    const { data: slot } = await hrSupabaseAdmin
      .from("hr_open_shifts")
      .select("outlet_id, status")
      .eq("id", id)
      .maybeSingle();
    if (!slot) return NextResponse.json({ error: "Slot not found" }, { status: 404 });
    const g = await gate(req, slot.outlet_id);
    if (g.error) return g.error;
    // Only still-open slots can be cancelled — a claimed one is already a real
    // shift on the grid; remove that shift there instead.
    const { data: cancelled } = await hrSupabaseAdmin
      .from("hr_open_shifts")
      .update({ status: "cancelled" })
      .eq("id", id)
      .eq("status", "open")
      .select("id")
      .maybeSingle();
    if (!cancelled) {
      return NextResponse.json({ error: "Already booked — remove the shift from the grid instead" }, { status: 409 });
    }
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
    const g = await gate(req, outlet_id);
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
