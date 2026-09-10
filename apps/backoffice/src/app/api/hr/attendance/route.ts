import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import type { SessionUser } from "@/lib/auth";
import { hrSupabaseAdmin } from "@/lib/hr/supabase";
import { prisma } from "@/lib/prisma";
import { getAccessibleOutletIds } from "@/lib/hr/scope";
import { signAttendancePhotos } from "@/lib/hr/photos";
import { deriveHours, mytDateString, mytInstant, computeLateMinutes } from "@/lib/hr/hours";
import { haversineDistance, REST_DAY_ROLE_PATTERN } from "@/lib/hr/constants";
import { approveOtForReviewedLog, logOtHours, type TailLog } from "@/lib/hr/ot-request-generator";

export const dynamic = "force-dynamic";

// Shape of a raw hr_attendance_logs row (select "*") for the fields the GET
// enrichment reads. Kept local so the route doesn't depend on the full UI type.
type AttendanceLogRow = {
  id: string;
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
  ai_flags: string[] | null;
};

const MAX_LIMIT = 1000; // PostgREST's own response cap
const DEFAULT_LIMIT = 200;

// A Malaysia calendar day → the UTC clock_in window [00:00, next 00:00).
const mytDayStartMs = (ymd: string): number | null => {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(ymd)) return null;
  const ms = Date.parse(`${ymd}T00:00:00+08:00`);
  return Number.isNaN(ms) ? null : ms;
};

// GET: the review queue.
//
//   review=pending|reviewed|all   pending = closed-or-open logs nobody has
//                                 decided on yet (final_status null); this is
//                                 what the queue shows by default.
//   status=flagged|all            legacy filter on ai_status, honoured when
//                                 `review` is absent so older callers keep
//                                 working.
//   from=YYYY-MM-DD&to=YYYY-MM-DD MYT date range (inclusive). `date=` is the
//                                 single-day form.
//   user_id, outlet_id, flag      narrow to a person / outlet / one AI flag.
//   has_ot=1                      only logs whose approval would pay OT.
//   limit                         default 200, max 1000.
//
// Why the range and the default matter: the old queue returned the 50 newest
// flagged rows and nothing else. A manager who did not review every day fell
// behind, and the older days dropped off the bottom silently — 159 August
// 2026 logs (≈80h of OT tail) were never seen, let alone approved.
export async function GET(req: NextRequest) {
  const session = await getSession();
  if (!session || !["OWNER", "ADMIN", "MANAGER"].includes(session.role)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { searchParams } = new URL(req.url);
  const review = searchParams.get("review");
  const status = searchParams.get("status");
  const limit = Math.min(MAX_LIMIT, Math.max(1, parseInt(searchParams.get("limit") || String(DEFAULT_LIMIT)) || DEFAULT_LIMIT));
  const userId = searchParams.get("user_id");
  const flag = searchParams.get("flag");
  const hasOt = searchParams.get("has_ot") === "1";

  // MANAGER sees attendance across ALL their assigned outlets (outletId +
  // outletIds[]). A URL outlet_id param is honored only if accessible.
  // OWNER/ADMIN honor the URL param freely.
  const requestedOutletId = searchParams.get("outlet_id");
  const allowedOutletIds = await getAccessibleOutletIds(session);

  let outletFilterIds: string[] | null = null;
  if (allowedOutletIds === null) {
    outletFilterIds = requestedOutletId ? [requestedOutletId] : null;
  } else {
    if (allowedOutletIds.length === 0) {
      return NextResponse.json({ logs: [], count: 0, summary: { pending: 0, pendingOtHours: 0, suspicious: 0 } });
    }
    outletFilterIds = requestedOutletId && allowedOutletIds.includes(requestedOutletId)
      ? [requestedOutletId]
      : allowedOutletIds;
  }

  // Date window. `from`/`to` are MYT days; `date` is the legacy single day.
  const dateParam = searchParams.get("date");
  const fromParam = searchParams.get("from") ?? dateParam;
  const toParam = searchParams.get("to") ?? dateParam;
  const fromMs = fromParam ? mytDayStartMs(fromParam) : null;
  const toMs = toParam ? mytDayStartMs(toParam) : null;
  const startIso = fromMs != null ? new Date(fromMs).toISOString() : null;
  const endIso = toMs != null ? new Date(toMs + 24 * 3600 * 1000).toISOString() : null;

  // Every filter except the review state, applied to both the list and the
  // exact pending count so the summary describes the same slice as the list.
  // Synthetic OT rows are an approval, not something to review.
  let query = hrSupabaseAdmin
    .from("hr_attendance_logs")
    .select("*")
    .neq("clock_in_method", "ot_approval")
    .order("clock_in", { ascending: false })
    .limit(limit);
  let countQuery = hrSupabaseAdmin
    .from("hr_attendance_logs")
    .select("id", { count: "exact", head: true })
    .neq("clock_in_method", "ot_approval")
    .is("final_status", null);
  if (outletFilterIds !== null) {
    query = query.in("outlet_id", outletFilterIds);
    countQuery = countQuery.in("outlet_id", outletFilterIds);
  }
  if (startIso) {
    query = query.gte("clock_in", startIso);
    countQuery = countQuery.gte("clock_in", startIso);
  }
  if (endIso) {
    query = query.lt("clock_in", endIso);
    countQuery = countQuery.lt("clock_in", endIso);
  }
  if (userId) {
    query = query.eq("user_id", userId);
    countQuery = countQuery.eq("user_id", userId);
  }
  if (flag) {
    query = query.contains("ai_flags", [flag]);
    countQuery = countQuery.contains("ai_flags", [flag]);
  }
  if (review === "pending") query = query.is("final_status", null);
  else if (review === "reviewed") query = query.not("final_status", "is", null);
  else if (!review && (status ?? "flagged") !== "all") query = query.eq("ai_status", status ?? "flagged");

  const [{ data: rawData, error }, { count: pendingCount }] = await Promise.all([query, countQuery]);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const data = (rawData || []) as (AttendanceLogRow & TailLog)[];

  const userIds = Array.from(new Set(data.map((l) => l.user_id)));
  const outletIds = Array.from(new Set(data.map((l) => l.outlet_id).filter(Boolean)));

  const [users, outlets] = await Promise.all([
    userIds.length > 0
      ? prisma.user.findMany({ where: { id: { in: userIds } }, select: { id: true, name: true, fullName: true } })
      : Promise.resolve([]),
    outletIds.length > 0
      ? prisma.outlet.findMany({ where: { id: { in: outletIds } }, select: { id: true, name: true } })
      : Promise.resolve([]),
  ]);

  const userMap = new Map(users.map((u) => [u.id, u]));
  const outletMap = new Map(outlets.map((o) => [o.id, o.name]));

  // OT is full-time only; the tail is only meaningful (and only approvable)
  // for them. PT overstays are a roster matter.
  const { data: ftRows } = userIds.length > 0
    ? await hrSupabaseAdmin
        .from("hr_employee_profiles")
        .select("user_id")
        .in("user_id", userIds)
        .eq("employment_type", "full_time")
    : { data: [] as { user_id: string }[] };
  const ftIds = new Set((ftRows || []).map((r) => r.user_id as string));

  // Geofence zone per outlet — lets us show the manager how far each clock
  // punch was from the outlet and whether it fell inside the allowed radius.
  const { data: zones } = outletIds.length > 0
    ? await hrSupabaseAdmin
        .from("hr_geofence_zones")
        .select("outlet_id, latitude, longitude, radius_meters, is_active")
        .in("outlet_id", outletIds)
        .eq("is_active", true)
    : { data: [] as { outlet_id: string; latitude: number; longitude: number; radius_meters: number }[] };
  const zoneMap = new Map((zones || []).map((z) => [z.outlet_id, z]));

  // Attendance selfies live in a PRIVATE bucket — swap the stored path for a
  // short-lived signed URL so the review UI can render them without exposure.
  const photoMap = await signAttendancePhotos(
    data.flatMap((l) => [l.clock_in_photo_url, l.clock_out_photo_url]),
  );

  const distTo = (
    zone: { latitude: number; longitude: number } | undefined,
    lat: number | null,
    lng: number | null,
  ): number | null =>
    zone && lat != null && lng != null
      ? Math.round(haversineDistance(Number(lat), Number(lng), Number(zone.latitude), Number(zone.longitude)))
      : null;

  let pendingOtHours = 0;
  let suspicious = 0;
  const enriched = data.map((log) => {
    const u = userMap.get(log.user_id);
    const zone = zoneMap.get(log.outlet_id);
    // Clocked OT the manager's approval will send to payroll: the bracketed
    // tail outside the rostered window plus any threshold OT on the row.
    // Null for part-timers, system auto-closes and logs a request already
    // covers (their OT is decided elsewhere or already landed).
    let otTailHours: number | null = null;
    let otTailSuspicious = false;
    if (ftIds.has(log.user_id) && log.clock_out && log.clock_out_method !== "system" && log.clock_in_method !== "ot_approval" && !log.ot_approval_id) {
      const { tail, threshold, implausible } = logOtHours(log);
      otTailHours = Math.floor((tail + threshold) * 2) / 2;
      otTailSuspicious = implausible;
    }
    if (log.final_status == null) {
      pendingOtHours += otTailHours ?? 0;
      if (otTailSuspicious) suspicious += 1;
    }
    return {
      ...log,
      ot_tail_hours: otTailHours,
      ot_tail_suspicious: otTailSuspicious,
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

  const logs = hasOt ? enriched.filter((l) => (l.ot_tail_hours ?? 0) >= 0.5 || l.ot_tail_suspicious) : enriched;

  return NextResponse.json({
    logs,
    count: logs.length,
    summary: {
      pending: pendingCount ?? 0,
      pendingOtHours: Math.round(pendingOtHours * 2) / 2,
      suspicious,
    },
  });
}

type ReviewAction = "acknowledge" | "excuse" | "approve" | "reject" | "set_times";
const BULK_ACTIONS: ReviewAction[] = ["acknowledge", "excuse", "reject"];
const MAX_BULK = 200;

type ExistingLog = {
  user_id: string;
  outlet_id: string | null;
  clock_in: string;
  clock_out: string | null;
  overtime_type: string | null;
  scheduled_start: string | null;
  scheduled_end: string | null;
  scheduled_date: string | null;
};

type ReviewInput = {
  id: string;
  action: ReviewAction;
  notes?: string;
  excuseReason?: string;
  clockIn?: string; // ISO — new clock-in (set_times)
  clockOut?: string; // ISO — new clock-out / manual clock-out (set_times)
};

type ReviewOutcome =
  | { ok: true; log: unknown; otApprovedHours: number }
  | { ok: false; status: number; error: string };

// PATCH: review a log — or, with `ids`, the same decision on many at once.
//
//   { id, action, ... }             one log, any action.
//   { ids: [...], action, ... }     acknowledge / excuse / reject on up to 200
//                                  logs. Each log is decided independently;
//                                  the response lists what worked and what
//                                  did not, so one bad row never blocks the
//                                  rest of a week's approvals.
export async function PATCH(req: NextRequest) {
  const session = await getSession();
  if (!session || !["OWNER", "ADMIN", "MANAGER"].includes(session.role)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = (await req.json()) as ReviewInput & { ids?: string[] };
  const allowedOutletIds = session.role === "MANAGER" ? await getAccessibleOutletIds(session) : null;

  if (Array.isArray(body.ids)) {
    const ids = Array.from(new Set(body.ids.filter((x): x is string => typeof x === "string" && x.length > 0)));
    if (ids.length === 0) return NextResponse.json({ error: "ids required" }, { status: 400 });
    if (ids.length > MAX_BULK) return NextResponse.json({ error: `At most ${MAX_BULK} logs per request` }, { status: 400 });
    if (!BULK_ACTIONS.includes(body.action)) {
      return NextResponse.json({ error: "Bulk review supports acknowledge, excuse and reject only" }, { status: 400 });
    }
    const results: { id: string; ok: boolean; otApprovedHours?: number; error?: string }[] = [];
    let otApprovedHours = 0;
    // Sequential on purpose: each approval may write an OT request, and the
    // generator de-dupes per (person, day) — racing them would double-file.
    for (const id of ids) {
      const r = await reviewOne({ ...body, id }, session, allowedOutletIds);
      if (r.ok) {
        otApprovedHours += r.otApprovedHours;
        results.push({ id, ok: true, otApprovedHours: r.otApprovedHours });
      } else {
        results.push({ id, ok: false, error: r.error });
      }
    }
    const done = results.filter((r) => r.ok).length;
    return NextResponse.json({ done, failed: results.length - done, otApprovedHours, results });
  }

  if (!body.id) return NextResponse.json({ error: "id required" }, { status: 400 });
  const r = await reviewOne(body, session, allowedOutletIds);
  if (!r.ok) return NextResponse.json({ error: r.error }, { status: r.status });
  return NextResponse.json({ log: r.log, otApprovedHours: r.otApprovedHours });
}

async function reviewOne(
  input: ReviewInput,
  session: SessionUser,
  allowedOutletIds: string[] | null,
): Promise<ReviewOutcome> {
  const { id, action, notes, excuseReason, clockIn, clockOut } = input;

  // Load the log first so we can gate MANAGER access by its outlet.
  const { data: existingLog } = await hrSupabaseAdmin
    .from("hr_attendance_logs")
    .select("user_id, outlet_id, clock_in, clock_out, overtime_type, scheduled_start, scheduled_end, scheduled_date")
    .eq("id", id)
    .maybeSingle();
  if (!existingLog) return { ok: false, status: 404, error: "Attendance log not found" };
  const log = existingLog as ExistingLog;
  if (session.role === "MANAGER") {
    if (!allowedOutletIds || !log.outlet_id || !allowedOutletIds.includes(log.outlet_id)) {
      return { ok: false, status: 403, error: "Forbidden — managers can only review their assigned outlets" };
    }
  }

  if (action === "set_times") return setTimes(id, log, { clockIn, clockOut, notes }, session);

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
  } else {
    // "adjust" (a raw hours override) was removed 2026-09-03: no UI or agent
    // ever sent it, it split hours on an 8h day when payroll uses 7.5h, and it
    // wrote OT straight onto the row, bypassing the approved-request rule.
    // Correcting a day is set_times — the shared hours engine recomputes it.
    return { ok: false, status: 400, error: `Unknown action: ${String(action)}` };
  }

  const { data, error } = await hrSupabaseAdmin
    .from("hr_attendance_logs")
    .update(updateData)
    .eq("id", id)
    .select()
    .single();
  if (error) return { ok: false, status: 500, error: error.message };

  // Owner 2026-09-03: "only the OT Ariff approves in attendance will be
  // counted as OT on payroll." Confirming the day (approve / acknowledge /
  // excuse / adjust) approves its OT tail: an approved hr_overtime_requests
  // row is written and stamped onto the log, exactly as the OT queue would.
  // Until now this approval set final_status and paid 0 OT — the tail is not
  // on the row (paid-window rule), and only a request can put it there.
  // Reject leaves nothing to approve. An implausible tail (missed tap-out)
  // yields 0 from the generator, so a confirm never pays a day of phantom OT.
  let otApprovedHours = 0;
  if (action !== "reject") {
    otApprovedHours = await approveOtForReviewedLog({ user_id: log.user_id, clock_in: log.clock_in }, session.id);
  }
  return { ok: true, log: data, otApprovedHours };
}

// set_times: the manager fixes the real clock-in/out (or manually clocks out a
// stranded staffer). Hours recompute via the SAME deriveHours engine as a normal
// clock-out, so a corrected log pays identically. The corrected clock-in flows
// into the allowance lateness naturally (not force-excused).
async function setTimes(
  id: string,
  log: ExistingLog,
  input: { clockIn?: string; clockOut?: string; notes?: string },
  session: SessionUser,
): Promise<ReviewOutcome> {
  const newClockInIso = input.clockIn || log.clock_in;
  const newClockOutIso = input.clockOut || log.clock_out;
  if (!newClockOutIso) return { ok: false, status: 400, error: "A clock-out time is required" };
  const ci = new Date(newClockInIso);
  const co = new Date(newClockOutIso);
  if (isNaN(ci.getTime()) || isNaN(co.getTime())) return { ok: false, status: 400, error: "Invalid clock-in/out time" };
  if (co.getTime() < ci.getTime()) return { ok: false, status: 400, error: "Clock-out must be after clock-in" };
  if (co.getTime() - ci.getTime() > 24 * 3600 * 1000) {
    return { ok: false, status: 400, error: "Shift can't exceed 24 hours — check the times" };
  }
  const mytDate = mytDateString(ci);
  // Rest day is ROSTERED, not a weekday on the profile — same source as the
  // staff clock-out, the AI processor and the auto-close cron. This path was
  // the last one still reading hr_employee_profiles.rest_day, and it was
  // wrong every single time: that column is NULL for all 77 profiles, so
  // `?? 0` resolved to Sunday and stamped every Sunday shift as a rest day.
  // July 2026: 96 logs carried rest_day_1x/ot_2x, ALL of them Sundays, and
  // NONE on one of the 161 genuinely rostered rest days.
  const [profResp, phResp, restResp] = await Promise.all([
    hrSupabaseAdmin.from("hr_employee_profiles").select("employment_type").eq("user_id", log.user_id).maybeSingle(),
    hrSupabaseAdmin.from("hr_public_holidays").select("date").eq("date", mytDate).limit(1).maybeSingle(),
    hrSupabaseAdmin
      .from("hr_schedule_shifts")
      .select("id")
      .eq("user_id", log.user_id)
      .eq("shift_date", mytDate)
      .ilike("role_type", REST_DAY_ROLE_PATTERN)
      .limit(1)
      .maybeSingle(),
  ]);
  const employmentType = profResp.data?.employment_type || "full_time";
  const derived = deriveHours({
    clockIn: ci,
    clockOut: co,
    employmentType,
    isPublicHoliday: !!phResp.data,
    isRestDay: !!restResp.data,
    // The paid window: only time inside the rostered shift counts.
    scheduledStart: mytInstant(log.scheduled_date ?? mytDate, log.scheduled_start),
    scheduledEnd: mytInstant(log.scheduled_date ?? mytDate, log.scheduled_end),
  });
  const wasOpen = !log.clock_out;
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
      review_notes: input.notes || (wasOpen ? "Manager manual clock-out" : "Manager corrected clock in/out times"),
    })
    .eq("id", id)
    .select()
    .single();
  if (setErr) return { ok: false, status: 500, error: setErr.message };
  // Corrected times are a manager's statement of what was worked: any tail
  // past the roster in the NEW times is approved OT (owner 2026-09-03).
  const otApprovedHours = await approveOtForReviewedLog({ user_id: log.user_id, clock_in: ci.toISOString() }, session.id);
  return { ok: true, log: updated, otApprovedHours };
}
