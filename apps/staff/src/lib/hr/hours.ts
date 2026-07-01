// Shared attendance hours + MYT-date math.
//
// Every timestamp in the DB is UTC (timestamptz). Malaysia has no DST, so MYT is
// a fixed UTC+8. The bugs this file exists to kill: deriving a shift's CALENDAR
// DAY or WALL-CLOCK time in the server's timezone (UTC on Vercel) instead of MYT,
// which mislabels pre-08:00-MYT shifts a day early and computes lateness / OT /
// outlet-close against the wrong instant. Do the day/time math HERE, not inline.
import { MYT_OFFSET_HOURS } from "./constants";

const MYT_MS = MYT_OFFSET_HOURS * 60 * 60 * 1000;

/** MYT calendar date (YYYY-MM-DD) for a UTC instant. */
export function mytDateString(iso: string | Date): string {
  const ms = (iso instanceof Date ? iso : new Date(iso)).getTime();
  return new Date(ms + MYT_MS).toISOString().slice(0, 10);
}

/** MYT day-of-week (0=Sun … 6=Sat) for a UTC instant. */
export function mytDayOfWeek(iso: string | Date): number {
  const ms = (iso instanceof Date ? iso : new Date(iso)).getTime();
  return new Date(ms + MYT_MS).getUTCDay();
}

/**
 * Build the UTC instant for a MYT wall time on a MYT calendar date.
 * dateStr = "YYYY-MM-DD" (MYT), time = "HH:MM[:SS]" (MYT). Returns null if either
 * is missing/unparseable — callers treat null as "no scheduled time" (no penalty).
 */
export function mytInstant(dateStr: string | null | undefined, time: string | null | undefined): Date | null {
  if (!dateStr || !time) return null;
  const [h, m] = time.split(":").map(Number);
  if (Number.isNaN(h)) return null;
  const hh = String(h).padStart(2, "0");
  const mm = String(m || 0).padStart(2, "0");
  const ms = Date.parse(`${dateStr}T${hh}:${mm}:00+08:00`);
  return Number.isNaN(ms) ? null : new Date(ms);
}

/**
 * Late minutes = clock-in minus the scheduled-start instant. Positive = late.
 * Cross-midnight safe because the scheduled instant is built from the roster's
 * OWN date (shiftDateMyt), not the clock-in's date. Returns 0 when no schedule.
 */
export function computeLateMinutes(
  clockIn: string | Date,
  scheduledStart: string | null | undefined,
  shiftDateMyt: string | null | undefined,
): number {
  const scheduled = mytInstant(shiftDateMyt, scheduledStart);
  if (!scheduled) return 0;
  const clockMs = (clockIn instanceof Date ? clockIn : new Date(clockIn)).getTime();
  return Math.round((clockMs - scheduled.getTime()) / 60000);
}

// OT threshold (paid working hours/day before OT kicks in), per employment type.
// full_time/contract: 45h week ÷ 6 days = 7.5h/day (break excluded).
export const OT_THRESHOLD_HOURS: Record<string, number> = {
  full_time: 7.5,
  contract: 7.5,
  part_time: 5, // 5.5h shift − 30min break
  intern: 6, // 6.5h shift − 30min break
};

/** Unpaid break hours to deduct from a shift's gross duration. */
export function breakHoursFor(employmentType: string, totalHours: number): number {
  if (employmentType === "part_time" || employmentType === "intern") return totalHours > 4 ? 0.5 : 0;
  return totalHours > 5 ? 1 : 0; // full_time / contract: 1h break if shift > 5h
}

export type DerivedHours = {
  totalHours: number;
  regularHours: number;
  overtimeHours: number;
  overtimeType: string | null;
  dayTypeFlags: string[];
};

/**
 * Split a CLOSED shift into paid regular/OT hours with the Malaysian day-type
 * multipliers. OT is always floored to whole hours (company policy). This is the
 * single source of truth for pay-hours — the AI processor AND the auto-close cron
 * both call it, so an auto-closed log carries the same regular/OT a normal
 * clock-out would (previously the cron wrote total_hours only → 0 paid hours).
 */
export function deriveHours(opts: {
  clockIn: Date;
  clockOut: Date;
  employmentType: string;
  isPublicHoliday: boolean;
  isRestDay: boolean;
}): DerivedHours {
  const { clockIn, clockOut, employmentType, isPublicHoliday, isRestDay } = opts;
  const otThreshold = OT_THRESHOLD_HOURS[employmentType] ?? 8;
  const totalHours = Math.round(((clockOut.getTime() - clockIn.getTime()) / (1000 * 60 * 60)) * 100) / 100;
  const workedHours = totalHours - breakHoursFor(employmentType, totalHours);

  let regularHours = 0;
  let overtimeHours = 0;
  let overtimeType: string | null = null;
  const dayTypeFlags: string[] = [];

  if (isPublicHoliday) {
    if (workedHours > otThreshold) {
      regularHours = otThreshold;
      overtimeHours = Math.floor(workedHours - otThreshold);
      overtimeType = "ot_3x"; // PH overtime = 3x
    } else {
      regularHours = Math.round(workedHours * 100) / 100;
      overtimeType = "ph_2x"; // PH normal = 2x
    }
    dayTypeFlags.push("public_holiday");
  } else if (isRestDay) {
    if (workedHours > otThreshold) {
      regularHours = otThreshold;
      overtimeHours = Math.floor(workedHours - otThreshold);
      overtimeType = "ot_2x"; // rest-day OT = 2x
    } else {
      regularHours = Math.round(workedHours * 100) / 100;
      overtimeType = "rest_day_1x";
    }
    dayTypeFlags.push("rest_day_work");
  } else if (workedHours > otThreshold) {
    regularHours = otThreshold;
    overtimeHours = Math.floor(workedHours - otThreshold);
    overtimeType = "ot_1_5x"; // weekday OT = 1.5x
    dayTypeFlags.push("overtime_detected");
  } else {
    regularHours = Math.round(workedHours * 100) / 100;
  }

  return { totalHours, regularHours, overtimeHours, overtimeType, dayTypeFlags };
}
