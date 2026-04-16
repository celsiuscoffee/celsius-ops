// HR Constants — Malaysia Employment Act 1955 + Celsius-specific rules

// Geofence
export const GEOFENCE_RADIUS_METERS = 100;

// Attendance rules
export const LATE_THRESHOLD_MINUTES = 15;
export const GRACE_PERIOD_MINUTES = 5;
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
  emergency: { label: "Emergency Leave", defaultDays: 2, paid: true },
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
