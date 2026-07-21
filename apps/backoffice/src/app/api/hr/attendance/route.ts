import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { hrSupabaseAdmin } from "@/lib/hr/supabase";
import { prisma } from "@/lib/prisma";
import { getAccessibleOutletIds } from "@/lib/hr/scope";
import { signAttendancePhotos } from "@/lib/hr/photos";
import { deriveHours, mytDateString, mytDayOfWeek, computeLateMinutes } from "@/lib/hr/hours";
import { haversineDistance } from "@/lib/hr/constants";

export const dynamic = "force-dynamic";

// Shape of a raw hr_attendance_logs row (select "*") for the fields the GET
// enrichment reads. Kept local so the route doesn't depend on the full UI type.
type AttendanceLogRow = {
  user_id: string;
  outlet_id: string;
  clock_in: string;
  clock_out: string | null;
  clock_in_lat: number | null;
  clock_in_lng: number | null;
  clock_out_lat: number | null;
  clock_out_lng: number | null;
  scheduled_start: string | null;
  scheduled_date: string | null;
  clock_in_photo_url: string | null;
  clock_out_photo_url: string | null;
};

// GET: list attendance logs with filters
export async function GET(req: NextRequest) {
  const session = await getSession();
  if (!session || !["OWNER", "ADMIN", "MANAGER"].includes(session.role)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { searchParams } = new URL(req.url);
  const status = searchParams.get("status") || "flagged"; // default to flagged only
  const limit = parseInt(searchParams.get("limit") || "50");
  // MANAGER sees attendance across ALL their assigned outlets (outletId +
  // outletIds[]). A URL outlet_id param is honored only if accessible.
  // OWNER/ADMIN honor the URL param freely.
  const requestedOutletId = searchParams.get("outlet_id");
  const allowedOutletIds = await getAccessibleOutletIds(session);

  let outletFilterIds: string[] | null = null;
  if (allowedOutletIds === null) {
    // OWNER/ADMIN: optional single-outlet filter from URL
    outletFilterIds = requestedOutletId ? [requestedOutletId] : null;
  } else {
    if (allowedOutletIds.length === 0) {
      return NextResponse.json({ logs: [] });
    }
    outletFilterIds = requestedOutletId && allowedOutletIds.includes(requestedOutletId)
      ? [requestedOutletId]
      : allowedOutletIds;
  }

  let query = hrSupabaseAdmin
    .from("hr_attendance_logs")
    .select("*")
    .order("clock_in", { ascending: false })
    .limit(limit);

  if (status !== "all") {
    query = query.eq("ai_status", status);
  }
  if (outletFilterIds !== null) {
    query = query.in("outlet_id", outletFilterIds);
  }
  // Optional day filter — `date` is a Malaysia-wall-time YYYY-MM-DD; translate
  // to the UTC half-open [00:00, next-00:00) window so it matches clock_in.
  const dateParam = searchParams.get("date");
  if (dateParam && /^\d{4}-\d{2}-\d{2}$/.test(dateParam)) {
    const startMs = Date.parse(`${dateParam}T00:00:00+08:00`);
    if (!Number.isNaN(startMs)) {
      const startIso = new Date(startMs).toISOString();
      const endIso = new Date(startMs + 24 * 3600 * 1000).toISOString();
      query = query.gte("clock_in", startIso).lt("clock_in", endIso);
    }
  }

  const { data: rawData, error } = await query;
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  // Exclude "OT-only" flagged logs from the attendance queue — those route to
  // the OT approval queue instead. A log stays in attendance if it has any
  // non-OT flag (late_arrival, early_out, outside_geofence, no_clock_out, etc).
  const data = status === "flagged"
    ? (rawData || []).filter((l: { ai_flags: string[] | null }) => {
        const flags = l.ai_flags || [];
        if (flags.length === 0) return true;
        return flags.some((f) => f !== "overtime_detected");
      })
    : (rawData || []);

  // Enrich with user name + fullName + outlet name
  const userIds = Array.from(new Set((data || []).map((l: { user_id: string }) => l.user_id)));
  const outletIds = Array.from(
    new Set((data || []).map((l: { outlet_id: string }) => l.outlet_id).filter(Boolean)),
  );

  const [users, outlets] = await Promise.all([
    userIds.length > 0
      ? prisma.user.findMany({
          where: { id: { in: userIds } },
          select: { id: true, name: true, fullName: true },
        })
      : Promise.resolve([]),
    outletIds.length > 0
      ? prisma.outlet.findMany({
          where: { id: { in: outletIds } },
          select: { id: true, name: true },
        })
      : Promise.resolve([]),
  ]);

  const userMap = new Map(users.map((u) => [u.id, u]));
  const outletMap = new Map(outlets.map((o) => [o.id, o.name]));

  // Geofence zone per outlet — lets us show the manager how far each clock
  // punch was from the outlet and whether it fell inside the allowed radius.
  const { data: zones } = outletIds.length > 0
    ? await hrSupabaseAdmin
        .from("hr_geofence_zones")
        .select("outlet_id, latitude, longitude, radius_meters, is_active")
        .in("outlet_id", outletIds as string[])
        .eq("is_active", true)
    : { data: [] as { outlet_id: string; latitude: number; longitude: number; radius_meters: number }[] };
  const zoneMap = new Map(
    (zones || []).map((z) => [z.outlet_id, z]),
  );

  // Attendance selfies live in a PRIVATE bucket — swap the stored path for a
  // short-lived signed URL so the review UI can render them without exposure.
  const photoMap = await signAttendancePhotos(
    (data || []).flatMap((l: { clock_in_photo_url: string | null; clock_out_photo_url: string | null }) => [l.clock_in_photo_url, l.clock_out_photo_url]),
  );

  const distTo = (
    zone: { latitude: number; longitude: number } | undefined,
    lat: number | null,
    lng: number | null,
  ): number | null =>
    zone && lat != null && lng != null
      ? Math.round(haversineDistance(Number(lat), Number(lng), Number(zone.latitude), Number(zone.longitude)))
      : null;

  const enriched = (data || []).map((log: AttendanceLogRow) => {
    const u = userMap.get(log.user_id);
    const zone = zoneMap.get(log.outlet_id);
    return {
      ...log,
      clock_in_photo_url: log.clock_in_photo_url ? (photoMap.get(log.clock_in_photo_url) ?? null) : null,
      clock_out_photo_url: log.clock_out_photo_url ? (photoMap.get(log.clock_out_photo_url) ?? null) : null,
      user_name: u?.fullName || u?.name || null,
      user_nickname: u?.name || null,
      outlet_name: outletMap.get(log.outlet_id) || null,
      // Manager context: how late vs the roster, and how far each punch landed
      // from the outlet against the allowed geofence radius.
      late_minutes: computeLateMinutes(log.clock_in, log.scheduled_start, log.scheduled_date ?? mytDateString(new Date(log.clock_in))),
      clock_in_distance_m: distTo(zone, log.clock_in_lat, log.clock_in_lng),
      clock_out_distance_m: distTo(zone, log.clock_out_lat, log.clock_out_lng),
      geofence_radius_m: zone ? Number(zone.radius_meters) : null,
    };
  });

  return NextResponse.json({ logs: enriched, count: enriched.length });
}

// PATCH: review a flagged attendance log
export async function PATCH(req: NextRequest) {
  const session = await getSession();
  if (!session || !["OWNER", "ADMIN", "MANAGER"].includes(session.role)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await req.json();
  const { id, action, adjustedHours, notes, excuseReason, clockIn, clockOut } = body as {
    id: string;
    action: "acknowledge" | "excuse" | "approve" | "reject" | "adjust" | "set_times";
    adjustedHours?: number;
    notes?: string;
    excuseReason?: string;
    clockIn?: string; // ISO — new clock-in (set_times)
    clockOut?: string; // ISO — new clock-out / manual clock-out (set_times)
  };

  if (!id) {
    return NextResponse.json({ error: "id required" }, { status: 400 });
  }

  // Load the log first so we can gate MANAGER access by its outlet AND so
  // 'adjust' can preserve the original overtime_type (PH/rest-day/weekday).
  const { data: existingLog } = await hrSupabaseAdmin
    .from("hr_attendance_logs")
    .select("user_id, outlet_id, clock_in, clock_out, overtime_type")
    .eq("id", id)
    .maybeSingle();
  if (!existingLog) {
    return NextResponse.json({ error: "Attendance log not found" }, { status: 404 });
  }
  if (session.role === "MANAGER") {
    const allowedOutletIds = await getAccessibleOutletIds(session);
    if (!allowedOutletIds || !existingLog.outlet_id || !allowedOutletIds.includes(existingLog.outlet_id)) {
      return NextResponse.json(
        { error: "Forbidden — managers can only review their assigned outlets" },
        { status: 403 },
      );
    }
  }

  // set_times: the manager fixes the real clock-in/out (or manually clocks out a
  // stranded staffer). Hours recompute via the SAME deriveHours engine as a normal
  // clock-out, so a corrected log pays identically. The corrected clock-in flows
  // into the allowance lateness naturally (not force-excused).
  if (action === "set_times") {
    const newClockInIso = clockIn || existingLog.clock_in;
    const newClockOutIso = clockOut || existingLog.clock_out;
    if (!newClockOutIso) {
      return NextResponse.json({ error: "A clock-out time is required" }, { status: 400 });
    }
    const ci = new Date(newClockInIso);
    const co = new Date(newClockOutIso);
    if (isNaN(ci.getTime()) || isNaN(co.getTime())) {
      return NextResponse.json({ error: "Invalid clock-in/out time" }, { status: 400 });
    }
    if (co.getTime() < ci.getTime()) {
      return NextResponse.json({ error: "Clock-out must be after clock-in" }, { status: 400 });
    }
    if (co.getTime() - ci.getTime() > 24 * 3600 * 1000) {
      return NextResponse.json({ error: "Shift can't exceed 24 hours — check the times" }, { status: 400 });
    }
    const { data: prof } = await hrSupabaseAdmin
      .from("hr_employee_profiles")
      .select("employment_type, rest_day")
      .eq("user_id", existingLog.user_id)
      .maybeSingle();
    const employmentType = prof?.employment_type || "full_time";
    const restDay = prof?.rest_day == null ? 0 : Number(prof.rest_day);
    const mytDate = mytDateString(ci);
    const { data: ph } = await hrSupabaseAdmin
      .from("hr_public_holidays").select("date").eq("date", mytDate).maybeSingle();
    const derived = deriveHours({
      clockIn: ci,
      clockOut: co,
      employmentType,
      isPublicHoliday: !!ph,
      isRestDay: mytDayOfWeek(ci) === restDay,
    });
    const wasOpen = !existingLog.clock_out;
    const { data: updated, error: setErr } = await hrSupabaseAdmin
      .from("hr_attendance_logs")
      .update({
        clock_in: ci.toISOString(),
        clock_out: co.toISOString(),
        clock_out_method: "manual",
        total_hours: derived.totalHours,
        regular_hours: derived.regularHours,
        overtime_hours: derived.overtimeHours,
        overtime_type: derived.overtimeType,
        final_status: "adjusted",
        ai_status: "reviewed",
        reviewed_by: session.id,
        reviewed_at: new Date().toISOString(),
        review_notes: notes || (wasOpen ? "Manager manual clock-out" : "Manager corrected clock in/out times"),
      })
      .eq("id", id)
      .select()
      .single();
    if (setErr) return NextResponse.json({ error: setErr.message }, { status: 500 });
    return NextResponse.json({ log: updated });
  }

  const updateData: Record<string, unknown> = {
    ai_status: "reviewed",
    reviewed_by: session.id,
    reviewed_at: new Date().toISOString(),
    review_notes: notes || null,
  };

  if (action === "approve" || action === "acknowledge") {
    // "Acknowledge": manager saw it, penalty still applies as calculated
    updateData.final_status = "approved";
    updateData.excused = false;
  } else if (action === "excuse") {
    // "Excuse": legitimate reason — allowance engine waives the penalty
    updateData.final_status = "approved";
    updateData.excused = true;
    updateData.excused_reason = excuseReason || notes || null;
  } else if (action === "reject") {
    updateData.final_status = "rejected";
  } else if (action === "adjust" && adjustedHours != null) {
    // Bound the manager-entered value — it flows straight into payroll
    // (total/regular/OT). Without this a typo or malicious value (negative,
    // 9999) inflates OT pay or writes nonsense hours. (set_times already caps.)
    if (!Number.isFinite(adjustedHours) || adjustedHours < 0 || adjustedHours > 24) {
      return NextResponse.json({ error: "adjustedHours must be between 0 and 24" }, { status: 400 });
    }
    // Preserve the original overtime classification so a manager-adjusted
    // rest-day / public-holiday shift doesn't silently become a weekday 1.5x
    // line in payroll. OT hours always floor to whole numbers per policy.
    const NORMAL_SHIFT_HOURS = 8;
    const regularHours = Math.min(adjustedHours, NORMAL_SHIFT_HOURS);
    const overtimeHours = Math.floor(Math.max(0, adjustedHours - NORMAL_SHIFT_HOURS));
    updateData.final_status = "adjusted";
    updateData.total_hours = adjustedHours;
    updateData.regular_hours = regularHours;
    updateData.overtime_hours = overtimeHours;
    // Only set overtime_type if there's OT to classify and the existing log
    // already has a type; otherwise leave the existing value untouched.
    if (overtimeHours > 0 && !existingLog.overtime_type) {
      updateData.overtime_type = "ot_1_5x"; // default weekday OT for un-classified adjusts
    }
  }

  const { data, error } = await hrSupabaseAdmin
    .from("hr_attendance_logs")
    .update(updateData)
    .eq("id", id)
    .select()
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ log: data });
}
