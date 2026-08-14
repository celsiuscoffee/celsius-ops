// Shared attendance hours + MYT-date math.
//
// Every timestamp in the DB is UTC (timestamptz). Malaysia has no DST, so MYT is
// a fixed UTC+8. The bugs this file exists to kill: deriving a shift's CALENDAR
// DAY or WALL-CLOCK time in the server's timezone (UTC on Vercel) instead of MYT,
// which mislabels pre-08:00-MYT shifts a day early and computes lateness / OT /
// outlet-close against the wrong instant. Do the day/time math HERE, not inline.
import { CLOCK_IN_GRACE_MINUTES, MYT_OFFSET_HOURS } from "./constants";

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
// part_time/intern have NO threshold OT (owner rule 2026-08-07: "PT no
// overtime — they can only be paid extra if they work more than their shift"):
// every worked hour is flat-rate regular; beyond-shift work is flagged by the
// backoffice attendance processor and only pays when the roster or an
// approved OT request lifts the weekly calculator's daily cap.
export const OT_THRESHOLD_HOURS: Record<string, number> = {
  full_time: 7.5,
  contract: 7.5,
  part_time: Number.POSITIVE_INFINITY,
  intern: Number.POSITIVE_INFINITY,
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
  /** Bracketed time clocked OUTSIDE the rostered window. Pays only if approved. */
  otEligibleHours: number;
};

/**
 * OT accrues in whole 30-minute brackets on either side of the rostered window
 * (owner rule 2026-08-13 #6). Mirrors apps/backoffice/src/lib/hr/hours.ts — the
 * staff clock-out writes regular_hours/overtime_hours straight to the log, so
 * the two copies MUST agree or a tap-out and the backoffice processor disagree
 * about the same shift.
 */
export const OT_BRACKET_MINUTES = 30;

export function otBracketHours(minutes: number): number {
  if (minutes <= 0) return 0;
  return (Math.floor(minutes / OT_BRACKET_MINUTES) * OT_BRACKET_MINUTES) / 60;
}

/**
 * Split a CLOSED shift into paid regular/OT hours with the Malaysian day-type
 * multipliers. OT is always floored to whole hours (company policy). This is the
 * single source of truth for pay-hours — the AI processor AND the auto-close cron
 * both call it, so an auto-closed log carries the same regular/OT a normal
 * clock-out would (previously the cron wrote total_hours only → 0 paid hours).
 *
 * THE PAID WINDOW (owner rules 2026-08-13): pay runs from the LATER of clock-in
 * and the rostered start to the EARLIER of clock-out and the rostered end.
 * Waiting around before shift never accrues hours (the 2026-07-28 early
 * clock-in policy, now symmetric), and staying past the rostered end no longer
 * silently becomes payable OT — it is a tail needing approval, counted in
 * 30-min brackets. totalHours still records the actual clocked span.
 */
export function deriveHours(opts: {
  clockIn: Date;
  clockOut: Date;
  employmentType: string;
  isPublicHoliday: boolean;
  isRestDay: boolean;
  /** Rostered shift-start instant (null/undefined = no roster → pay from clock-in). */
  scheduledStart?: Date | null;
  /** Rostered shift-end instant (null/undefined = no roster → pay to clock-out). */
  scheduledEnd?: Date | null;
}): DerivedHours {
  const { clockIn, clockOut, employmentType, isPublicHoliday, isRestDay, scheduledStart, scheduledEnd } = opts;
  const otThreshold = OT_THRESHOLD_HOURS[employmentType] ?? 8;
  const totalHours = Math.round(((clockOut.getTime() - clockIn.getTime()) / (1000 * 60 * 60)) * 100) / 100;
  // Pay-hours start: the later of clock-in and rostered start (never past
  // clock-out) — except inside the clock-in grace, where a late tap still pays
  // from the rostered start (owner rule 2026-08-14). Same rule as
  // paidWindowHours, so both cohorts forgive a near-miss identically.
  const graceMs = CLOCK_IN_GRACE_MINUTES * 60000;
  const schedStartMs = scheduledStart?.getTime() ?? clockIn.getTime();
  const lateBy = clockIn.getTime() - schedStartMs;
  const gracedStart = scheduledStart && lateBy > 0 && lateBy <= graceMs
    ? schedStartMs
    : Math.max(clockIn.getTime(), schedStartMs);
  const payStartMs = Math.min(gracedStart, clockOut.getTime());
  // Pay-hours end: the earlier of clock-out and rostered end (never before the
  // pay start — a shift ended early still can't run backwards).
  let schedEndMs = scheduledEnd?.getTime() ?? clockOut.getTime();
  if (scheduledStart && scheduledEnd && schedEndMs <= scheduledStart.getTime()) {
    schedEndMs += 24 * 60 * 60 * 1000; // cross-midnight closing shift
  }
  const payEndMs = Math.max(payStartMs, Math.min(clockOut.getTime(), schedEndMs));
  const payableHours = Math.round(((payEndMs - payStartMs) / (1000 * 60 * 60)) * 100) / 100;
  // Tails outside the roster, bracketed — reported so the processor can flag
  // them for approval. Never added to regular or overtime hours here.
  const otEligibleHours = scheduledStart && scheduledEnd
    ? Math.round((
        otBracketHours(Math.max(0, Math.round((scheduledStart.getTime() - clockIn.getTime()) / 60000)))
        + otBracketHours(Math.max(0, Math.round((clockOut.getTime() - schedEndMs) / 60000)))
      ) * 100) / 100
    : 0;
  const workedHours = payableHours - breakHoursFor(employmentType, payableHours);

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

  return { totalHours, regularHours, overtimeHours, overtimeType, dayTypeFlags, otEligibleHours };
}
