import { hrSupabaseAdmin } from "../supabase";
import {
  haversineDistance,
  GEOFENCE_RADIUS_METERS,
  LATE_THRESHOLD_MINUTES,
  AUTO_CLOCKOUT_AFTER_HOURS,
} from "../constants";
import { deriveHours, mytDateString, mytDayOfWeek, computeLateMinutes } from "../hours";
import type { AttendanceLog, GeofenceZone, EmployeeProfile } from "../types";

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

  // 3. Get employee profiles (employment type for OT threshold, rest_day for OT rate)
  const userIds = [...new Set((pendingLogs as AttendanceLog[]).map((l) => l.user_id))];
  const { data: profiles } = await hrSupabaseAdmin
    .from("hr_employee_profiles")
    .select("user_id, employment_type, rest_day")
    .in("user_id", userIds);

  const profileMap = new Map<string, string>();
  const restDayByUser = new Map<string, number>();
  (profiles || []).forEach((p: { user_id: string; employment_type: string; rest_day: number | null }) => {
    profileMap.set(p.user_id, p.employment_type);
    // NULL → Sunday (0) default per MY Employment Act convention.
    restDayByUser.set(p.user_id, p.rest_day == null ? 0 : Number(p.rest_day));
  });

  // 4. Get public holidays for the date range of pending logs (MYT calendar day —
  // a pre-08:00-MYT clock-in is the previous day in UTC, so slice() would miss it).
  const logDates = [...new Set((pendingLogs as AttendanceLog[]).map((l) => mytDateString(l.clock_in)))];
  const { data: holidays } = await hrSupabaseAdmin
    .from("hr_public_holidays")
    .select("date")
    .in("date", logDates)
    .eq("declared", true);

  const publicHolidaySet = new Set((holidays || []).map((h: { date: string }) => h.date));

  // 4. Process each log
  const now = new Date();

  for (const log of pendingLogs as AttendanceLog[]) {
    const flags: string[] = [];
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
      const restDay = restDayByUser.get(log.user_id) ?? 0; // NULL → Sunday default
      const isRestDay = mytDayOfWeek(log.clock_in) === restDay;

      const derived = deriveHours({
        clockIn: new Date(log.clock_in),
        clockOut: new Date(log.clock_out),
        employmentType,
        isPublicHoliday: isPH,
        isRestDay,
      });
      totalHours = derived.totalHours;
      regularHours = derived.regularHours;
      overtimeHours = derived.overtimeHours;
      overtimeType = derived.overtimeType;
      flags.push(...derived.dayTypeFlags);
    } else if (flags.includes("no_clock_out")) {
      // Still open past the auto-clockout window: flag for a manager but DON'T
      // fabricate payable hours (the old code wrote a flat 12h). The auto-close
      // cron is the single authority for closing stale logs and writing real hours.
      regularHours = 0;
    }

    // --- Decision ---
    const aiStatus = flags.length === 0 ? "approved" : "flagged";

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
      .eq("id", log.id);

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
