import { hrSupabaseAdmin } from "../supabase";
import {
  haversineDistance,
  GEOFENCE_RADIUS_METERS,
  LATE_THRESHOLD_MINUTES,
  AUTO_CLOCKOUT_AFTER_HOURS,
} from "../constants";
import type { AttendanceLog, GeofenceZone, EmployeeProfile } from "../types";

type ProcessResult = {
  processed: number;
  autoApproved: number;
  flagged: number;
  errors: string[];
};

// OT thresholds per employment type
const OT_THRESHOLD_HOURS: Record<string, number> = {
  full_time: 7.5,  // 45h/week ÷ 6 days = 7.5h/day (break excluded)
  contract: 7.5,
  part_time: 5,    // 5.5h shift - 30min break = 5h working
  intern: 6,       // 6.5h shift - 30min break = 6h working
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

  // 4. Get public holidays for the date range of pending logs
  const logDates = [...new Set((pendingLogs as AttendanceLog[]).map((l) => l.clock_in.slice(0, 10)))];
  const { data: holidays } = await hrSupabaseAdmin
    .from("hr_public_holidays")
    .select("date")
    .in("date", logDates);

  const publicHolidaySet = new Set((holidays || []).map((h: { date: string }) => h.date));

  // 4. Process each log
  const now = new Date();

  for (const log of pendingLogs as AttendanceLog[]) {
    const flags: string[] = [];
    const employmentType = profileMap.get(log.user_id) || "full_time";
    const otThreshold = OT_THRESHOLD_HOURS[employmentType] || 8;

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
    if (log.scheduled_start) {
      const scheduled = parseTimeToMinutes(log.scheduled_start);
      const clockInDate = new Date(log.clock_in);
      const clockInMinutes = clockInDate.getUTCHours() * 60 + clockInDate.getUTCMinutes() + 8 * 60;
      const normalizedClockIn = clockInMinutes % (24 * 60);
      const lateMinutes = normalizedClockIn - scheduled;
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

    // --- Compute Hours ---
    let totalHours = log.total_hours ? Number(log.total_hours) : 0;
    let regularHours = 0;
    let overtimeHours = 0;
    let overtimeType: string | null = null;

    if (log.clock_out) {
      const clockIn = new Date(log.clock_in);
      const clockOut = new Date(log.clock_out);
      totalHours = (clockOut.getTime() - clockIn.getTime()) / (1000 * 60 * 60);
      totalHours = Math.round(totalHours * 100) / 100;

      // Break deduction: break is NOT working time
      // Full-time/contract: 1h break if shift > 5h
      // Part-time/intern: 30min break if shift > 4h
      let breakHours = 0;
      if (employmentType === "part_time" || employmentType === "intern") {
        breakHours = totalHours > 4 ? 0.5 : 0;
      } else {
        breakHours = totalHours > 5 ? 1 : 0;
      }
      const workedHours = totalHours - breakHours;

      // Determine day type for OT rate
      const clockDate = log.clock_in.slice(0, 10);
      const isPH = publicHolidaySet.has(clockDate);
      const dayOfWeek = new Date(clockDate).getDay(); // 0=Sun
      const isRestDay = dayOfWeek === 0; // Sunday = default rest day

      if (isPH) {
        // Public holiday: all hours at 2x, OT at 3x
        if (workedHours > otThreshold) {
          regularHours = otThreshold;
          overtimeHours = Math.round((workedHours - otThreshold) * 100) / 100;
          overtimeType = "ot_3x"; // PH overtime = 3x
        } else {
          regularHours = Math.round(workedHours * 100) / 100;
          overtimeType = "ph_2x"; // PH normal = 2x rate
        }
        flags.push("public_holiday");
      } else if (isRestDay) {
        // Rest day: normal hours at 1x, OT at 2x
        if (workedHours > otThreshold) {
          regularHours = otThreshold;
          overtimeHours = Math.round((workedHours - otThreshold) * 100) / 100;
          overtimeType = "ot_2x"; // rest day OT = 2x
        } else {
          regularHours = Math.round(workedHours * 100) / 100;
          overtimeType = "rest_day_1x";
        }
        flags.push("rest_day_work");
      } else if (workedHours > otThreshold) {
        // Normal weekday OT
        regularHours = otThreshold;
        overtimeHours = Math.round((workedHours - otThreshold) * 100) / 100;
        overtimeType = "ot_1_5x"; // weekday OT = 1.5x
        flags.push("overtime_detected");
      } else {
        regularHours = Math.round(workedHours * 100) / 100;
      }
    } else if (flags.includes("no_clock_out")) {
      totalHours = AUTO_CLOCKOUT_AFTER_HOURS;
      regularHours = otThreshold;
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

function parseTimeToMinutes(time: string): number {
  const [h, m] = time.split(":").map(Number);
  return h * 60 + m;
}
