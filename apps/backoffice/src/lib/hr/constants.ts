// HR Constants — Malaysia Employment Act 1955 + Celsius-specific rules

// Geofence
export const GEOFENCE_RADIUS_METERS = 100;

// Attendance rules
export const LATE_THRESHOLD_MINUTES = 15;
export const GRACE_PERIOD_MINUTES = 5;

/**
 * PAID clock-in grace (owner rule 2026-08-14): clocking in up to this many
 * minutes AFTER the rostered start is forgiven — pay still runs from the
 * rostered start, so a late tap inside the grace costs nothing.
 *
 * Distinct from GRACE_PERIOD_MINUTES above, which is display-only (the
 * on-time/late chip and the on-time % stats) and has never touched pay.
 *
 * This exists because the old 30-min pay rounding punished near-misses
 * absurdly: Naufal clocked in at 07:30:51 on 2026-08-03 — 51 seconds late —
 * and the rounding pushed his paid start to 08:00, costing him RM4.50.
 */
export const CLOCK_IN_GRACE_MINUTES = 10;
export const MAX_SHIFT_HOURS = 12;
export const AUTO_CLOCKOUT_AFTER_HOURS = 12;
export const NORMAL_WORK_HOURS = 7.5; // 45h/week ÷ 6 days = 7.5h/day

// Celsius policy: 45h/week standard, anything above = OT
export const STANDARD_HOURS_PER_WEEK = 45;

// OT rates (Malaysia Employment Act 1955)
export const OT_RATES = {
  normal: 1.5,        // Weekday overtime (>45h/week or >9h/day)
  rest_day: 2.0,      // Rest day overtime (beyond normal hours)
  rest_day_normal: 1.0, // Rest day work (within normal hours, half day)
  public_holiday: 2.0,  // Public holiday (normal pay)
  public_holiday_ot: 3.0, // Public holiday overtime
} as const;

// Hourly rate formula: monthly salary / 26 / 7.5 hours
export const WORKING_DAYS_PER_MONTH = 26;
export const NORMAL_WORKING_HOURS_PER_DAY = 7.5;

// Maximum OT per month (Employment Act)
export const MAX_OT_HOURS_PER_MONTH = 104;

// Leave types and default entitlements (Employment Act minimums)
export const LEAVE_TYPES = {
  annual: { label: "Annual Leave", defaultDays: 8, paid: true },
  sick: { label: "Sick Leave", defaultDays: 14, paid: true },
  hospitalization: { label: "Hospitalization", defaultDays: 60, paid: true },
  maternity: { label: "Maternity", defaultDays: 98, paid: true },
  paternity: { label: "Paternity", defaultDays: 7, paid: true },
  unpaid: { label: "Unpaid Leave", defaultDays: 999, paid: false },
  replacement: { label: "Replacement Leave", defaultDays: 0, paid: true },
} as const;

export type LeaveType = keyof typeof LEAVE_TYPES;

// Malaysia time offset
export const MYT_OFFSET_HOURS = 8;

/** Get current date/time in Malaysia timezone */
export function getMYTNow(): Date {
  return new Date(Date.now() + MYT_OFFSET_HOURS * 60 * 60 * 1000);
}

/** Get today's date string (YYYY-MM-DD) in MYT */
export function getMYTToday(): string {
  const myt = getMYTNow();
  return myt.toISOString().slice(0, 10);
}

/** Haversine distance between two coordinates in meters */
export function haversineDistance(
  lat1: number, lng1: number,
  lat2: number, lng2: number,
): number {
  const R = 6371000; // Earth radius in meters
  const toRad = (deg: number) => (deg * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

// The roster records a rest day as a shift row with this role_type and a
// 00:00-00:00 window. It is the ONLY source of truth for whether a given day is
// a rest day for a given person — rest days rotate, so there is no fixed weekday.
export const REST_DAY_ROLE = "Rest Day";
// Match pattern for reads. The roster is hand-entered, so tolerate "Rest day" /
// "rest day" casing. Verified against the live schedule: "Rest Day" is the only
// role_type containing "rest", so this can't over-match a real shift.
export const REST_DAY_ROLE_PATTERN = "rest%";

// Highest hourly rate a MANAGER may set for a part-timer without an owner
// signing it off (owner 2026-08-02). Anything ABOVE this is stored at `pending`
// and does not reach payroll until an OWNER/ADMIN approves it. Current PT band
// is RM9 weekday / RM10 weekend, so this clears normal adjustments and catches
// a move in the wage band. See lib/hr/pt-rate-change.ts.
export const PT_RATE_SELF_APPROVE_MAX = 11;
