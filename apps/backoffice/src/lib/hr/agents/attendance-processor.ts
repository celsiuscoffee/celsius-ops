import { hrSupabaseAdmin } from "../supabase";
import {
  haversineDistance,
  GEOFENCE_RADIUS_METERS,
  LATE_THRESHOLD_MINUTES,
  AUTO_CLOCKOUT_AFTER_HOURS,
  REST_DAY_ROLE_PATTERN,
  CLOCKOUT_REMINDER_FLAG,
} from "../constants";
import { deriveHours, mytDateString, mytInstant, computeLateMinutes } from "../hours";
import type { AttendanceLog, GeofenceZone } from "../types";

type ProcessResult = {
  processed: number;
  autoApproved: number;
  flagged: number;
  errors: string[];
};

/**
 * AI Attendance Processor
 *
 * Pure rules engine — no LLM. Processes pending attendance logs:
 * 1. Geofence check (clock location vs outlet zone)
 * 2. Late arrival check (>15 min after scheduled start)
 * 3. Missing clock-out detection (>12h without clock-out)
 * 4. OT detection (hours > threshold based on employment type)
 * 5. Auto-approve if zero flags, flag otherwise
 */
export async function processAttendance(): Promise<ProcessResult> {
  const result: ProcessResult = { processed: 0, autoApproved: 0, flagged: 0, errors: [] };

  // 1. Get all pending attendance logs
  const { data: pendingLogs, error: logError } = await hrSupabaseAdmin
    .from("hr_attendance_logs")
    .select("*")
    .eq("ai_status", "pending")
    .order("clock_in", { ascending: true })
    .limit(500);

  if (logError || !pendingLogs) {
    result.errors.push(`Failed to fetch logs: ${logError?.message}`);
    return result;
  }

  if (pendingLogs.length === 0) return result;

  // 2. Get all active geofence zones
  const { data: zones } = await hrSupabaseAdmin
    .from("hr_geofence_zones")
    .select("*")
    .eq("is_active", true);

  const zonesByOutlet = new Map<string, GeofenceZone>();
  (zones || []).forEach((z: GeofenceZone) => zonesByOutlet.set(z.outlet_id, z));

  // 3. Get employee profiles (employment type for OT threshold)
  const userIds = [...new Set((pendingLogs as AttendanceLog[]).map((l) => l.user_id))];
  const { data: profiles } = await hrSupabaseAdmin
    .from("hr_employee_profiles")
    .select("user_id, employment_type")
    .in("user_id", userIds);

  const profileMap = new Map<string, string>();
  (profiles || []).forEach((p: { user_id: string; employment_type: string }) => {
    profileMap.set(p.user_id, p.employment_type);
  });

  // 4. Get public holidays for the date range of pending logs (MYT calendar day —
  // a pre-08:00-MYT clock-in is the previous day in UTC, so slice() would miss it).
  const logDates = [...new Set((pendingLogs as AttendanceLog[]).map((l) => mytDateString(l.clock_in)))];
  const { data: holidays } = await hrSupabaseAdmin
    .from("hr_public_holidays")
    .select("date")
    .in("date", logDates);

  const publicHolidaySet = new Set((holidays || []).map((h: { date: string }) => h.date));

  // 5. Rest days come from the ROSTER, not from a fixed weekday on the profile.
  // Celsius rosters a "Rest Day" row (00:00-00:00) per person per week and it
  // rotates: across July the 229 rest-day rows fall Sun 33 / Mon 35 / Tue 25 /
  // Wed 38 / Thu 35 / Fri 34 / Sat 29. There is no weekly pattern to read off a
  // profile column — and in fact `rest_day` is NULL for all 27 full-timers, so
  // the old `?? 0` default made it Sunday for everybody. Of the 108 logs that
  // default flagged as rest-day work, exactly ONE was a real rostered rest day.
  const { data: restRows } = await hrSupabaseAdmin
    .from("hr_schedule_shifts")
    .select("user_id, shift_date")
    .ilike("role_type", REST_DAY_ROLE_PATTERN)
    .in("user_id", userIds)
    .in("shift_date", logDates);
  const rosteredRestDays = new Set(
    (restRows || []).map((r: { user_id: string; shift_date: string }) => `${r.user_id}|${r.shift_date}`),
  );

  // 4. Process each log
  const now = new Date();

  for (const log of pendingLogs as AttendanceLog[]) {
    // Fresh verdict each pass — except two markers the auto-close cron stamps:
    // the clock-out reminder (dropping it re-sends the push every 15 minutes)
    // and `auto_closed_<reason>` (the cron closes the log and calls this
    // processor in the same run, so the marker was lost seconds after it was
    // written and the review queue's "Auto-closed" filter missed most of them).
    const flags: string[] = (Array.isArray(log.ai_flags) ? log.ai_flags : []).filter(
      (f: string) => f === CLOCKOUT_REMINDER_FLAG || f.startsWith("auto_closed_"),
    );
    const employmentType = profileMap.get(log.user_id) || "full_time";

    // --- Geofence Check ---
    const zone = zonesByOutlet.get(log.outlet_id);
    if (zone && log.clock_in_lat != null && log.clock_in_lng != null) {
      const dist = haversineDistance(
        Number(log.clock_in_lat), Number(log.clock_in_lng),
        Number(zone.latitude), Number(zone.longitude),
      );
      if (dist > (zone.radius_meters || GEOFENCE_RADIUS_METERS)) {
        flags.push("outside_geofence");
      }
    } else if (!log.clock_in_lat || !log.clock_in_lng) {
      flags.push("no_gps_data");
    }

    // --- Late Arrival ---
    // Date-aware, cross-midnight safe: builds the scheduled instant from the
    // roster's OWN date (scheduled_date), not the clock-in's UTC day.
    if (log.scheduled_start) {
      const lateMinutes = computeLateMinutes(log.clock_in, log.scheduled_start, log.scheduled_date ?? mytDateString(log.clock_in));
      if (lateMinutes > LATE_THRESHOLD_MINUTES) {
        flags.push("late_arrival");
      }
    }

    // --- Missing Clock-out ---
    if (!log.clock_out) {
      const hoursSinceClockIn = (now.getTime() - new Date(log.clock_in).getTime()) / (1000 * 60 * 60);
      if (hoursSinceClockIn > AUTO_CLOCKOUT_AFTER_HOURS) {
        flags.push("no_clock_out");
      } else {
        continue; // Still working — leave as pending
      }
    }

    // --- Compute Hours (shared engine — the auto-close cron uses the same split) ---
    let totalHours = log.total_hours ? Number(log.total_hours) : 0;
    let regularHours = 0;
    let overtimeHours = 0;
    let overtimeType: string | null = null;

    if (log.clock_out) {
      // Day type keyed on the MYT calendar day (not the UTC slice) so a pre-08:00
      // opening shift gets the right rest-day / public-holiday OT multiplier.
      const clockDate = mytDateString(log.clock_in);
      const isPH = publicHolidaySet.has(clockDate);
      const isRestDay = rosteredRestDays.has(`${log.user_id}|${clockDate}`);

      const derived = deriveHours({
        clockIn: new Date(log.clock_in),
        clockOut: new Date(log.clock_out),
        employmentType,
        isPublicHoliday: isPH,
        isRestDay,
        // The paid window: rostered start and end (stamped at clock-in). Time
        // outside it is an OT tail needing approval, not automatic pay.
        scheduledStart: mytInstant(log.scheduled_date ?? clockDate, log.scheduled_start),
        scheduledEnd: mytInstant(log.scheduled_date ?? clockDate, log.scheduled_end),
      });
      totalHours = derived.totalHours;
      regularHours = derived.regularHours;
      overtimeHours = derived.overtimeHours;
      overtimeType = derived.overtimeType;
      flags.push(...derived.dayTypeFlags);

      // Time clocked OUTSIDE the rostered window — early in (rule 5) or late out
      // (rule 4) — pays nothing without an approved OT request, so it has to
      // reach a manager. Applies to BOTH cohorts now: the old version flagged
      // PT only, which let a full-timer's unapproved overstay pay itself.
      // deriveHours brackets the tails to 30 min (rule 6), so a few minutes at
      // either end never raises it.
      if (derived.otEligibleHours > 0) flags.push("overtime_detected");

      // System-closed logs (auto-close cron): a missed tap-out is NOT proven
      // overtime — the cron zeroed OT when it closed, and this evaluation must
      // not resurrect it from the synthetic span. The close lands at the
      // rostered end so the tails are ~0 anyway; this pins the owner rule
      // rather than relying on that arithmetic.
      if (log.clock_out_method === "system") {
        overtimeHours = 0;
        const otIdx = flags.indexOf("overtime_detected");
        if (otIdx >= 0) flags.splice(otIdx, 1);
      }

      // Clocking in late or leaving early also needs sign-off (rule 7). The
      // window already docked the pay; this puts the shortfall in front of
      // someone who can excuse it or let it stand.
      const schedDate = log.scheduled_date ?? clockDate;
      const startInstant = mytInstant(schedDate, log.scheduled_start);
      let endInstant = mytInstant(schedDate, log.scheduled_end);
      if (endInstant && startInstant && endInstant.getTime() <= startInstant.getTime()) {
        endInstant = new Date(endInstant.getTime() + 24 * 60 * 60 * 1000); // cross-midnight shift
      }
      const lateBy = startInstant
        ? (new Date(log.clock_in).getTime() - startInstant.getTime()) / 60000 : 0;
      const leftEarlyBy = endInstant
        ? (endInstant.getTime() - new Date(log.clock_out).getTime()) / 60000 : 0;
      if (lateBy > LATE_THRESHOLD_MINUTES) flags.push("late_clock_in");
      if (leftEarlyBy > LATE_THRESHOLD_MINUTES) flags.push("early_clock_out");
    } else if (flags.includes("no_clock_out")) {
      // Still open past the auto-clockout window: flag for a manager but DON'T
      // fabricate payable hours (the old code wrote a flat 12h). The auto-close
      // cron is the single authority for closing stale logs and writing real hours.
      regularHours = 0;
    }

    // --- Decision ---
    // `rest_day_work` and `public_holiday` describe how the hours are PAID (the
    // day-type multiplier), not something a manager has to adjudicate. Treating
    // them as exceptions buried the queue: Sunday 2026-08-02 was a rostered rest
    // day, the whole crew worked it, and every single log came back flagged with
    // nothing actually wrong. Keep them on the row — the multiplier and the
    // payslip breakdown both read them — but don't let them force a review.
    //
    // `overtime_detected` stays actionable ON PURPOSE: OT needs approval before
    // it is paid (hr_company_settings.overtime_requires_approval).
    const INFORMATIONAL_FLAGS = new Set(["rest_day_work", "public_holiday"]);
    const actionableFlags = flags.filter((f) => !INFORMATIONAL_FLAGS.has(f));
    const aiStatus = actionableFlags.length === 0 ? "approved" : "flagged";

    // The ai_status guard makes this a compare-and-set: a manager PATCH
    // (set_times / adjust) landing between our fetch and this write moves the
    // log out of 'pending', so we match zero rows instead of clobbering the
    // human's correction with hours recomputed from the STALE clock times —
    // which would also have flipped final_status 'adjusted' → 'approved' while
    // reviewed_by still claimed manager confirmation.
    const { error: updateError } = await hrSupabaseAdmin
      .from("hr_attendance_logs")
      .update({
        ai_status: aiStatus,
        ai_flags: flags,
        ai_processed_at: now.toISOString(),
        total_hours: totalHours,
        regular_hours: regularHours,
        overtime_hours: overtimeHours,
        overtime_type: overtimeType,
        ...(aiStatus === "approved" ? { final_status: "approved" } : {}),
      })
      .eq("id", log.id)
      .eq("ai_status", "pending");

    if (updateError) {
      result.errors.push(`Failed to update log ${log.id}: ${updateError.message}`);
      continue;
    }

    result.processed++;
    if (aiStatus === "approved") result.autoApproved++;
    if (aiStatus === "flagged") result.flagged++;
  }

  return result;
}
