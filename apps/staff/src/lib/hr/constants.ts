// HR Constants — Malaysia Employment Act 1955 + Celsius-specific rules

// Geofence
export const GEOFENCE_RADIUS_METERS = 100;

// Attendance rules
export const LATE_THRESHOLD_MINUTES = 15;
export const GRACE_PERIOD_MINUTES = 5;

/**
 * PAID clock grace (owner rule 2026-08-14, extended same day to both ends):
 * clocking in up to this many minutes AFTER the rostered start, or out up to
 * this many minutes BEFORE the rostered end, is forgiven — pay still runs the
 * full rostered window, so a near-miss at either edge costs nothing.
 *
 * Past the grace the FULL deviation is docked, not just the excess: it is a
 * threshold, not an allowance to subtract.
 *
 * Distinct from GRACE_PERIOD_MINUTES above, which is display-only (the
 * on-time/late chip and the on-time % stats) and has never touched pay.
 *
 * This exists because the old 30-min pay rounding punished near-misses
 * absurdly: Naufal clocked in at 07:30:51 on 2026-08-03 — 51 seconds late —
 * and the rounding pushed his paid start to 08:00, costing him RM4.50.
 */
export const CLOCK_GRACE_MINUTES = 10;
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

// Feature flag: is Payroll (payslips) exposed to staff? ON since 2026-08-03 —
// the owner asked for payslips to be openable in this app and the manager app.
//
// The comment here used to say "mirror of the backoffice PAYROLL_UI_ENABLED".
// There is no such constant in the backoffice — it was removed at some point and
// this reference went stale. There is nothing to keep in step; this flag governs
// the staff PWA alone. The manager app (staff-native) never had a flag: its
// payslips screen has always fetched straight from /api/hr/payslips.
//
// The API is the real boundary either way: it scopes to the caller's own
// user_id, returns only `confirmed`/`paid` runs, and excludes the
// `opening_balance` import.
export const PAYROLL_UI_ENABLED = true;

// The roster records a rest day as a shift row with this role_type and a
// 00:00-00:00 window. It is the ONLY source of truth for whether a given day is
// a rest day for a given person — rest days rotate, so there is no fixed
// weekday. Mirror of the backoffice constant; keep the two in step.
export const REST_DAY_ROLE = "Rest Day";
// Match pattern for reads — the roster is hand-entered, so tolerate casing.
export const REST_DAY_ROLE_PATTERN = "rest%";

/**
 * Round a leave-day figure for display and comparison.
 *
 * Leave is tracked in half-days, and the balance is a subtraction:
 * entitled + carried_forward − used − pending. Those are decimals, so binary
 * floating point leaks — 8 − 0.7 is 7.300000000000001, and the staff app
 * rendered exactly that under "Annual Leave".
 *
 * Two decimals is well past the half-day granularity the business actually
 * uses, so this cannot hide a real value. Returns a NUMBER, so 7.3 prints as
 * "7.3" and 8 prints as "8" without trailing zeros.
 */
export function leaveDays(n: number): number {
  return Math.round((Number(n) || 0) * 100) / 100;
}

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
