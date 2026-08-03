import { NextRequest, NextResponse } from "next/server";
import { getUser } from "@/lib/auth";
// Service-role client: route authenticates the caller via getUser (cookie or
// Authorization: Bearer). Anon client lacks INSERT/UPDATE grants on
// hr_attendance_logs ("permission denied for table"), so writes would fail
// before RLS even runs.
import { supabaseAdmin as supabase } from "@/lib/supabase";
import { haversineDistance, GEOFENCE_RADIUS_METERS, REST_DAY_ROLE_PATTERN } from "@/lib/hr/constants";
import { evaluateClockOut } from "@/lib/hr/clock-out-gate";
import { deriveHours, mytDateString, mytInstant } from "@/lib/hr/hours";
import type { AttendanceLog, GeofenceZone } from "@/lib/hr/types";

export const dynamic = "force-dynamic";

// Multi-outlet clock-in: a staffer assigned to several outlets (or with no fixed
// primary, e.g. a roving manager) must clock in against the outlet they are
// ACTUALLY at — not a fixed session.outletId. Otherwise the geofence is measured
// against the wrong outlet (e.g. staff at Tamarind checked against Shah Alam =
// "21 km away"), the log records the wrong outlet, and the clock-out hard gate
// then traps them at an outlet they never visited.

type Zone = { outlet_id: string; name: string | null; latitude: number | string; longitude: number | string; radius_meters: number | null };

// Every outlet this user may clock into: session primary + their multi-outlet list.
async function getCandidateOutletIds(userId: string, sessionOutletId: string | null): Promise<string[]> {
  const ids = new Set<string>();
  if (sessionOutletId) ids.add(sessionOutletId);
  const { data } = await supabase.from("User").select("outletId, outletIds").eq("id", userId).maybeSingle();
  if (data?.outletId) ids.add(data.outletId as string);
  for (const id of ((data?.outletIds as string[] | null) ?? [])) if (id) ids.add(id);
  return Array.from(ids);
}

type PickedOutlet = { outletId: string | null; zone: Zone | null; distanceMeters: number | null; withinGeofence: boolean };

// Choose the outlet the staffer is physically at: the NEAREST candidate whose
// geofence they're inside; if none, the nearest overall (soft-control lets them
// clock in offsite with a warning). Falls back to the session outlet when GPS
// is missing or candidates have no zones.
async function pickOutletByLocation(candidateIds: string[], lat: number | undefined, lng: number | undefined, fallbackOutletId: string | null): Promise<PickedOutlet> {
  const fb = (fallbackOutletId && candidateIds.includes(fallbackOutletId)) ? fallbackOutletId : (candidateIds[0] ?? null);
  if (candidateIds.length === 0) return { outletId: fallbackOutletId, zone: null, distanceMeters: null, withinGeofence: false };
  const { data } = await supabase.from("hr_geofence_zones").select("outlet_id, name, latitude, longitude, radius_meters").in("outlet_id", candidateIds).eq("is_active", true);
  const zones = (data ?? []) as Zone[];
  if (lat == null || lng == null || zones.length === 0) {
    return { outletId: fb, zone: zones.find((z) => z.outlet_id === fb) ?? null, distanceMeters: null, withinGeofence: false };
  }
  let best: { z: Zone; dist: number } | null = null;
  for (const z of zones) {
    const dist = Math.round(haversineDistance(lat, lng, Number(z.latitude), Number(z.longitude)));
    if (!best || dist < best.dist) best = { z, dist };
  }
  if (!best) return { outletId: fb, zone: null, distanceMeters: null, withinGeofence: false };
  const radius = best.z.radius_meters || GEOFENCE_RADIUS_METERS;
  return { outletId: best.z.outlet_id, zone: best.z, distanceMeters: best.dist, withinGeofence: best.dist <= radius };
}

// At clock-in, stamp the rostered shift (scheduled_start / _end / _date) onto the
// log so lateness and the shift-end auto-close have a roster reference. Matches
// the same hr_schedule_shifts rows the no-show / allowance logic reads. Picks the
// shift whose start is closest to the clock-in, and checks today AND yesterday
// (MYT) so a just-past-midnight clock-in still matches its previous-evening shift.
// How far past a shift's own end we'll still accept it as the shift being
// started. Covers a late arrival onto a shift already running, and a
// just-past-midnight clock-in for the previous evening's shift.
const ROSTER_STALE_GRACE_MS = 4 * 3600 * 1000;

async function findRosterShift(userId: string, clockIn: Date): Promise<{ scheduled_start: string; scheduled_end: string | null; scheduled_date: string } | null> {
  const todayMyt = mytDateString(clockIn);
  const prevMyt = mytDateString(new Date(clockIn.getTime() - 24 * 3600 * 1000));
  // Accept ANY roster shift (draft or published). Rosters are often left as
  // draft, and a draft shift's end time is a far better reference for lateness /
  // auto-close than nothing (which forced the cron to fall back to the 1am sweep
  // time). We no longer filter on hr_schedules.status.
  const { data } = await supabase
    .from("hr_schedule_shifts")
    .select("shift_date, start_time, end_time")
    .eq("user_id", userId)
    .in("shift_date", [prevMyt, todayMyt]);
  const shifts = (data ?? []) as { shift_date: string; start_time: string; end_time: string | null }[];
  let best: { shift: (typeof shifts)[number]; diff: number } | null = null;
  for (const s of shifts) {
    const startInstant = mytInstant(s.shift_date, s.start_time);
    if (!startInstant) continue;

    // Skip a shift that is already OVER. Nearest-start alone picked yesterday's
    // shift whenever there was no roster row for today — it was the only
    // candidate, so it won by default and stamped a shift-end reference ~24h in
    // the past. That produced 13 of the 21 zero-hour auto-closes (the cron read
    // the stale end, found it before clock-in, and settled the log at 0.00h),
    // and it also judged lateness and early-clock-in pay against the wrong day.
    //
    // A generous grace keeps the case this lookback exists for: clocking in just
    // after midnight for a shift that ran to 23:30 the previous evening, or
    // arriving a little late onto a shift already underway.
    const endInstant = s.end_time ? mytInstant(s.shift_date, s.end_time) : null;
    if (endInstant && clockIn.getTime() - endInstant.getTime() > ROSTER_STALE_GRACE_MS) continue;

    const diff = Math.abs(clockIn.getTime() - startInstant.getTime());
    if (!best || diff < best.diff) best = { shift: s, diff };
  }
  // No plausible roster row → stamp nothing. A null roster is handled everywhere
  // downstream (the auto-close cron falls through to its stale-session
  // backstop); a stale one silently corrupts lateness, pay and the close time.
  if (!best) return null;
  return { scheduled_start: best.shift.start_time, scheduled_end: best.shift.end_time, scheduled_date: best.shift.shift_date };
}

// GET: current clock-in status for the logged-in user
export async function GET(req: NextRequest) {
  const session = await getUser(req.headers);
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  // Find today's open attendance log (clocked in but not out)
  const { data: active } = await supabase
    .from("hr_attendance_logs")
    .select("*")
    .eq("user_id", session.id)
    .is("clock_out", null)
    .order("clock_in", { ascending: false })
    .limit(1)
    .single();

  // If already clocked in, show the geofence for the outlet they clocked INTO
  // (so clock-out is measured against the right place). Otherwise pick the
  // nearest of their assigned outlets from the optional ?lat/&lng the app sends.
  const sp = new URL(req.url).searchParams;
  const lat = sp.get("lat") != null ? Number(sp.get("lat")) : undefined;
  const lng = sp.get("lng") != null ? Number(sp.get("lng")) : undefined;

  let outletId = session.outletId;
  let geofence: GeofenceZone | null = null;
  if (active?.outlet_id) {
    outletId = active.outlet_id;
    const { data } = await supabase
      .from("hr_geofence_zones").select("*").eq("outlet_id", active.outlet_id).eq("is_active", true).limit(1).maybeSingle();
    geofence = data;
  } else {
    const candidateIds = await getCandidateOutletIds(session.id, session.outletId);
    const picked = await pickOutletByLocation(candidateIds, lat, lng, session.outletId);
    outletId = picked.outletId;
    if (picked.outletId) {
      const { data } = await supabase
        .from("hr_geofence_zones").select("*").eq("outlet_id", picked.outletId).eq("is_active", true).limit(1).maybeSingle();
      geofence = data;
    }
  }

  return NextResponse.json({
    activeLog: active as AttendanceLog | null,
    geofence,
    outletId,
  });
}

// POST: clock in or clock out
export async function POST(req: NextRequest) {
  const session = await getUser(req.headers);
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await req.json();
  const { action, latitude, longitude, photo } = body as {
    action: "clock_in" | "clock_out";
    latitude?: number;
    longitude?: number;
    photo?: string; // base64 data URL
  };

  // Resolve the outlet the staffer is ACTUALLY at (nearest of their assigned
  // outlets by GPS), not a fixed session.outletId — the multi-outlet fix.
  const candidateIds = await getCandidateOutletIds(session.id, session.outletId);
  if (candidateIds.length === 0) {
    return NextResponse.json({ error: "No outlet assigned" }, { status: 400 });
  }
  const picked = await pickOutletByLocation(candidateIds, latitude, longitude, session.outletId);
  const outletId = picked.outletId;
  if (!outletId) {
    return NextResponse.json({ error: "No outlet assigned" }, { status: 400 });
  }

  const zone = picked.zone;
  const withinGeofence = picked.withinGeofence;
  const distanceMeters = picked.distanceMeters;
  const zoneName = zone?.name ?? null;
  const zoneRadius = zone?.radius_meters || GEOFENCE_RADIUS_METERS;

  // SOFT CONTROL (company policy: warn + allow + audit, NOT a hard block — a
  // barista must never be locked out of starting their shift). Out-of-zone /
  // no-GPS clock-ins are ALLOWED but tagged via clock_in_method + a warning, so
  // attendance review can flag them. Hard-blocking here is also what kept clock-in
  // adoption near zero — the point now is to GET the clock-in, then review it.
  let geofenceWarning: string | null = null;
  let clockInMethod = "app";
  if (action === "clock_in" && zone) {
    if (latitude == null || longitude == null) {
      clockInMethod = "app_nogps";
      geofenceWarning = "Clocked in without GPS — flagged for review.";
    } else if (!withinGeofence) {
      clockInMethod = "app_offsite";
      geofenceWarning = `Clocked in ${distanceMeters}m from ${zoneName} (zone ${zoneRadius}m) — flagged for review.`;
    }
  }

  // Upload photo to Supabase Storage if provided
  async function uploadPhoto(photoData: string, prefix: string): Promise<string | null> {
    if (!photoData) return null;
    try {
      // Strip data URL prefix: "data:image/jpeg;base64,..."
      const base64 = photoData.includes(",") ? photoData.split(",")[1] : photoData;
      const buffer = Buffer.from(base64, "base64");
      const timestamp = Date.now();
      const path = `attendance/${session!.id}/${prefix}_${timestamp}.jpg`;

      const { error: uploadErr } = await supabase.storage
        .from("hr-photos")
        .upload(path, buffer, { contentType: "image/jpeg", upsert: false });

      if (uploadErr) {
        console.error("Photo upload error:", uploadErr.message);
        return null;
      }

      // Store the object PATH — the bucket is private, so the backoffice mints a
      // short-lived signed URL at read time. Legacy rows hold a full public URL;
      // the signer strips either form back to the path, so both keep working.
      return path;
    } catch {
      return null;
    }
  }

  if (action === "clock_in") {
    // Check if already clocked in
    const { data: existing } = await supabase
      .from("hr_attendance_logs")
      .select("id")
      .eq("user_id", session.id)
      .is("clock_out", null)
      .limit(1)
      .single();

    if (existing) {
      return NextResponse.json({ error: "Already clocked in" }, { status: 400 });
    }

    const photoUrl = photo ? await uploadPhoto(photo, "in") : null;
    const clockInAt = new Date();
    const roster = await findRosterShift(session.id, clockInAt);

    const { data, error } = await supabase
      .from("hr_attendance_logs")
      .insert({
        user_id: session.id,
        outlet_id: outletId,
        clock_in: clockInAt.toISOString(),
        clock_in_lat: latitude ?? null,
        clock_in_lng: longitude ?? null,
        clock_in_method: clockInMethod,
        clock_in_photo_url: photoUrl,
        // Roster stamp → lateness + shift-end auto-close reference (null when no shift rostered).
        scheduled_start: roster?.scheduled_start ?? null,
        scheduled_end: roster?.scheduled_end ?? null,
        scheduled_date: roster?.scheduled_date ?? null,
        ai_status: "pending",
      })
      .select()
      .single();

    if (error) {
      // 23505 = the one-open-log-per-user partial unique index: a concurrent
      // clock-in (double tap / retry) beat this one. Treat as already clocked in.
      if ((error as { code?: string }).code === "23505") {
        return NextResponse.json({ error: "Already clocked in" }, { status: 400 });
      }
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json({
      success: true,
      log: data,
      withinGeofence,
      warning: geofenceWarning,
    });
  }

  if (action === "clock_out") {
    // Find the open log
    const { data: activeLog } = await supabase
      .from("hr_attendance_logs")
      .select("*")
      .eq("user_id", session.id)
      .is("clock_out", null)
      .order("clock_in", { ascending: false })
      .limit(1)
      .single();

    if (!activeLog) {
      return NextResponse.json({ error: "Not clocked in" }, { status: 400 });
    }

    // Guard against an ACCIDENTAL immediate clock-out. The clock button flips
    // straight from "Clock In" to "Clock Out" the moment you clock in, so a
    // reflexive double-tap was closing shifts seconds later at 0h — and since
    // the staffer then had no open log, they lost the shift entirely. Reject a
    // clock-out in the first couple of minutes and keep them clocked in.
    const MIN_SHIFT_MINUTES = 2;
    const minutesClockedIn = (Date.now() - new Date(activeLog.clock_in).getTime()) / 60000;
    if (minutesClockedIn < MIN_SHIFT_MINUTES) {
      return NextResponse.json({
        error: "You just clocked in — you're all set. (Tap Clock Out at the end of your shift.)",
        justClockedIn: true,
      }, { status: 400 });
    }

    // Geofence check against the OUTLET THEY CLOCKED INTO (not their session outletId — rotating staff may differ)
    const { data: clockInZone } = await supabase
      .from("hr_geofence_zones")
      .select("*")
      .eq("outlet_id", activeLog.outlet_id)
      .eq("is_active", true)
      .limit(1)
      .maybeSingle();

    // HARD GATE — but only against a clock-in we actually verified. An
    // app_offsite / app_nogps log carries a guessed outlet, and gating on a
    // guess locks the staffer out of ending their own shift. See clock-out-gate.ts.
    const gate = evaluateClockOut({
      zone: clockInZone,
      clockInMethod: activeLog.clock_in_method,
      latitude,
      longitude,
    });
    const clockOutWithinGeofence = gate.withinGeofence;
    const clockOutDistance = gate.distanceMeters;

    if (!gate.allowed) {
      return NextResponse.json({
        error: gate.error,
        ...(gate.reason === "no_gps"
          ? { needsGps: true }
          : { withinGeofence: false, distanceMeters: gate.distanceMeters, zoneName: gate.zoneName }),
      }, { status: gate.reason === "no_gps" ? 400 : 403 });
    }

    const clockOut = new Date();
    const clockIn = new Date(activeLog.clock_in);

    // Pay-hours split via the shared engine — the SAME one the auto-close cron
    // and AI processor use. Previously a normal clock-out wrote total_hours
    // ONLY, leaving regular_hours/overtime_hours NULL; payroll sums
    // regular_hours, so every app clock-out paid 0 hours. Derive them here so a
    // clean clock-out pays immediately.
    // Rest day is ROSTERED, not a weekday on the profile: the schedule carries a
    // "Rest Day" row (00:00-00:00) per person per week and it rotates. The old
    // profile-based read defaulted NULL to Sunday and mis-stamped 107 of 108
    // rest-day logs. Same source as the AI processor and the auto-close cron.
    const clockInDate = mytDateString(clockIn);
    const [profileResp, holidayResp, restResp] = await Promise.all([
      supabase.from("hr_employee_profiles").select("employment_type").eq("user_id", session.id).maybeSingle(),
      supabase.from("hr_public_holidays").select("date").eq("date", clockInDate).maybeSingle(),
      supabase
        .from("hr_schedule_shifts")
        .select("id")
        .eq("user_id", session.id)
        .eq("shift_date", clockInDate)
        .ilike("role_type", REST_DAY_ROLE_PATTERN)
        .limit(1)
        .maybeSingle(),
    ]);
    const derived = deriveHours({
      clockIn,
      clockOut,
      employmentType: profileResp.data?.employment_type || "full_time",
      isPublicHoliday: !!holidayResp.data,
      isRestDay: !!restResp.data,
      // Early clock-in pays from the rostered start (stamped at clock-in).
      scheduledStart: mytInstant(activeLog.scheduled_date ?? clockInDate, activeLog.scheduled_start),
    });
    const totalHours = derived.totalHours;

    const photoUrl = photo ? await uploadPhoto(photo, "out") : null;

    const { data, error } = await supabase
      .from("hr_attendance_logs")
      .update({
        clock_out: clockOut.toISOString(),
        clock_out_lat: latitude ?? null,
        clock_out_lng: longitude ?? null,
        clock_out_method: gate.method,
        clock_out_photo_url: photoUrl,
        total_hours: totalHours,
        regular_hours: derived.regularHours,
        overtime_hours: derived.overtimeHours,
        overtime_type: derived.overtimeType,
      })
      .eq("id", activeLog.id)
      .select()
      .single();

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json({
      success: true,
      log: data,
      withinGeofence: clockOutWithinGeofence,
      distanceMeters: clockOutDistance,
      warning: gate.warning,
      totalHours: Math.round(totalHours * 100) / 100,
    });
  }

  return NextResponse.json({ error: "Invalid action" }, { status: 400 });
}
