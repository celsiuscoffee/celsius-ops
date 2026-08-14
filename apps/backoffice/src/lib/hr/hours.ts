// Shared attendance hours + MYT-date math.
//
// Every timestamp in the DB is UTC (timestamptz). Malaysia has no DST, so MYT is
// a fixed UTC+8. The bugs this file exists to kill: deriving a shift's CALENDAR
// DAY or WALL-CLOCK time in the server's timezone (UTC on Vercel) instead of MYT,
// which mislabels pre-08:00-MYT shifts a day early and computes lateness / OT /
// outlet-close against the wrong instant. Do the day/time math HERE, not inline.
import { CLOCK_GRACE_MINUTES, MYT_OFFSET_HOURS } from "./constants";

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
// every worked hour is flat-rate regular; working past the rostered shift end
// is the attendance processor's beyond-shift flag, and it only PAYS when the
// roster or an approved OT request lifts the weekly calculator's daily cap.
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

/**
 * THE PAID WINDOW — one hours basis for BOTH cohorts (owner rule 2026-08-13):
 *
 *   1. clock in BEFORE the rostered start
 *   2. clock out AFTER the rostered end
 *   3. only time INSIDE the rostered window is paid
 *   4. time past the rostered end pays only against an approved OT request
 *
 *   paid window = [ max(clockIn, schedStart) , min(clockOut, schedEnd) ]
 *
 * The roster pays, bounded by the clock. Clocking in early or staying late
 * never adds paid time on its own; arriving late or leaving early trims the
 * window from that side, so the deduction falls out of the arithmetic instead
 * of needing its own rule.
 *
 * CLOCK GRACE (owner rule 2026-08-14): a near-miss at EITHER edge is forgiven —
 * in up to CLOCK_GRACE_MINUTES late, or out up to CLOCK_GRACE_MINUTES early,
 * still pays the full rostered window. Past the grace the FULL deviation is
 * docked, not just the excess.
 *
 * This REPLACES two mechanisms that only approximated it:
 *   · the 30-min clock rounding (`ptRoundedSpanHours`, owner 2026-08-07) — with
 *     the roster bounding the span, rounding only ever deducted a SECOND time,
 *     and only from the staff who clocked closest to their shift. Punctuality
 *     cost RM5 a shift; overstaying cost nothing.
 *   · the daily "rostered net hours" CAP in the weekly calculator — a cap is not
 *     a window. It never checked WHEN the hours fell, so a late clock-in was
 *     silently offset by an unapproved overstay and paid in full.
 *
 * NO ROSTER (owner 2026-08-13): an unrostered clock-in is a COVER shift — pay
 * the clocked span minus break and set `needsSignOff` so a manager confirms it.
 * Under the old cap these paid ZERO (cap = 0 with no shift on the grid), so a
 * cover worked in full went unpaid and silently.
 */
export type PaidWindow = {
  /** Hours inside the rostered window, break already deducted. Payable. */
  paidHours: number;
  /** Raw inside-window span before the break deduction. */
  windowHours: number;
  breakHours: number;
  /** Clocked in after the rostered start (0 when on time or early). */
  lateMinutes: number;
  /** Clocked out before the rostered end (0 when on time or later). */
  earlyLeaveMinutes: number;
  /** Clocked in BEFORE the rostered start. OT candidate — needs approval (rule 5). */
  earlyInMinutes: number;
  /** Clocked out AFTER the rostered end. OT candidate — needs approval (rule 4). */
  overstayMinutes: number;
  /**
   * OT-eligible hours: the early-in and overstay tails, each floored to whole
   * 30-min brackets (rule 6). Still pays NOTHING without an approved request —
   * this is the ceiling an approval can draw against, not an entitlement.
   */
  otEligibleHours: number;
  /** No roster stamped on the log — paid as a cover shift. */
  unrostered: boolean;
  /** A manager MUST confirm this log (cover shift, OT tail, or bad timestamps). */
  needsSignOff: boolean;
};

/**
 * OT accrues in whole 30-minute brackets on either side of the rostered window
 * (owner rule 2026-08-13 #6: "OT only counts in 30min bracket before or after
 * schedule time"). 25 min early → 0; 35 min → 0.5h; 65 min → 1.0h.
 *
 * Note this rounding lives ONLY on the OT tails. The base window is paid to the
 * exact minute — rounding the whole span is what made punctuality cost RM5 a
 * shift under the old rule.
 */
export const OT_BRACKET_MINUTES = 30;

export function otBracketHours(minutes: number): number {
  if (minutes <= 0) return 0;
  return (Math.floor(minutes / OT_BRACKET_MINUTES) * OT_BRACKET_MINUTES) / 60;
}

export type ShiftWindow = {
  start: Date;
  end: Date;
  /**
   * The roster's OWN unpaid break for this shift (hr_schedule_shifts.break_minutes).
   * Authoritative when present — the grid is where a manager expresses "this
   * shift has no break" or "this one has an hour". Falls back to the cohort
   * policy only for cover shifts, which have no roster row to read.
   */
  breakMinutes?: number | null;
};

/**
 * Pick which rostered shift a clock log belongs to: the one its clocked span
 * OVERLAPS most. A day can hold split shifts (07:30–11:30 and 17:00–21:00), and
 * matching by day alone would price an evening log against the morning window.
 * Returns null when the day has no roster (→ cover shift).
 */
export function pickShiftWindow(
  windows: ShiftWindow[],
  clockIn: string | Date,
  clockOut: string | Date,
): ShiftWindow | null {
  if (windows.length === 0) return null;
  if (windows.length === 1) return windows[0];
  const inMs = (clockIn instanceof Date ? clockIn : new Date(clockIn)).getTime();
  const outMs = (clockOut instanceof Date ? clockOut : new Date(clockOut)).getTime();
  let best: ShiftWindow | null = null;
  let bestOverlap = -1;
  for (const w of windows) {
    let endMs = w.end.getTime();
    if (endMs <= w.start.getTime()) endMs += 24 * 60 * 60 * 1000;
    const overlap = Math.min(outMs, endMs) - Math.max(inMs, w.start.getTime());
    if (overlap > bestOverlap) {
      bestOverlap = overlap;
      best = w;
    }
  }
  return best;
}

export function paidWindowHours(opts: {
  clockIn: string | Date;
  clockOut: string | Date;
  /** Rostered start instant. Null/undefined = unrostered cover shift. */
  scheduledStart?: Date | null;
  /** Rostered end instant. Null/undefined = unrostered cover shift. */
  scheduledEnd?: Date | null;
  employmentType: string;
  /**
   * The rostered shift's own unpaid break, in minutes. Null/undefined = no
   * roster row (cover shift) → fall back to the cohort policy. Removing the
   * daily cap took away the only consumer of this field; without it a shift
   * rostered with a 0-min or 60-min break was silently paid as if it were 30.
   */
  breakMinutes?: number | null;
}): PaidWindow {
  const toMs = (v: string | Date) => (v instanceof Date ? v : new Date(v)).getTime();
  const inMs = toMs(opts.clockIn);
  const outMs = toMs(opts.clockOut);
  const { scheduledStart, scheduledEnd, employmentType } = opts;

  const span = (ms: number) => Math.round((ms / (1000 * 60 * 60)) * 100) / 100;
  const mins = (ms: number) => Math.max(0, Math.round(ms / 60000));

  // Corrupt timestamps (clock-out at or before clock-in) pay nothing and go to a
  // manager. The cap used to pay these out of the roster — Alea 2026-08-10 has a
  // clock-out 4h45m BEFORE its clock-in and drew 4.5h.
  if (!(outMs > inMs)) {
    return {
      paidHours: 0, windowHours: 0, breakHours: 0,
      lateMinutes: 0, earlyLeaveMinutes: 0, earlyInMinutes: 0, overstayMinutes: 0,
      otEligibleHours: 0,
      unrostered: !scheduledStart || !scheduledEnd, needsSignOff: true,
    };
  }

  if (!scheduledStart || !scheduledEnd) {
    const windowHours = span(outMs - inMs);
    const breakHours = breakHoursFor(employmentType, windowHours);
    return {
      paidHours: Math.round((windowHours - breakHours) * 100) / 100,
      windowHours, breakHours,
      lateMinutes: 0, earlyLeaveMinutes: 0, earlyInMinutes: 0, overstayMinutes: 0,
      otEligibleHours: 0,
      unrostered: true, needsSignOff: true,
    };
  }

  const startMs = scheduledStart.getTime();
  // A shift whose end is at or before its start crosses midnight (22:00→02:00).
  let endMs = scheduledEnd.getTime();
  if (endMs <= startMs) endMs += 24 * 60 * 60 * 1000;

  // Clock grace (owner rule 2026-08-14), applied at BOTH edges: a tap-in up to
  // CLOCK_GRACE_MINUTES late, or a tap-out up to CLOCK_GRACE_MINUTES early,
  // still pays the full rostered window. Without it the window docks to the
  // second — a staffer 51 seconds late loses 51 seconds of pay, the same
  // near-miss cruelty the old 30-min rounding had, just smaller.
  //
  // Past the grace the FULL deviation is docked (a threshold, not an allowance
  // to subtract): 11 min late pays from 07:41, not 07:40.
  const graceMs = CLOCK_GRACE_MINUTES * 60000;
  const lateMs = inMs - startMs;
  const earlyOutMs = endMs - outMs;
  const payStart = lateMs > 0 && lateMs <= graceMs ? startMs : Math.max(inMs, startMs);
  const payEnd = earlyOutMs > 0 && earlyOutMs <= graceMs ? endMs : Math.min(outMs, endMs);
  const windowHours = span(Math.max(0, payEnd - payStart));
  const breakHours = opts.breakMinutes == null
    ? breakHoursFor(employmentType, windowHours)
    : Math.max(0, Math.min(opts.breakMinutes / 60, windowHours));
  const earlyInMinutes = mins(startMs - inMs);
  const overstayMinutes = mins(outMs - endMs);
  // Each tail brackets on its own — 20 min early plus 20 min late is two
  // part-brackets, not one 40-min bracket.
  const otEligibleHours =
    Math.round((otBracketHours(earlyInMinutes) + otBracketHours(overstayMinutes)) * 100) / 100;
  const lateMinutes = mins(inMs - startMs);
  const earlyLeaveMinutes = mins(endMs - outMs);

  return {
    paidHours: Math.max(0, Math.round((windowHours - breakHours) * 100) / 100),
    windowHours,
    breakHours,
    lateMinutes,
    earlyLeaveMinutes,
    earlyInMinutes,
    overstayMinutes,
    otEligibleHours,
    unrostered: false,
    // Any deviation from the rostered window goes to a manager: an OT tail to
    // approve (rules 4/5), or a shortfall to excuse or let stand (rule 7).
    // Both edges gate on the PAY grace — a staffer the grace already paid in
    // full has nothing for a manager to adjudicate, and queueing them anyway is
    // what buried the confirm screen.
    needsSignOff:
      otEligibleHours > 0 ||
      lateMinutes > CLOCK_GRACE_MINUTES ||
      earlyLeaveMinutes > CLOCK_GRACE_MINUTES,
  };
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
 * Split a CLOSED shift into paid regular/OT hours with the Malaysian day-type
 * multipliers. OT is always floored to whole hours (company policy). This is the
 * single source of truth for pay-hours — the AI processor AND the auto-close cron
 * both call it, so an auto-closed log carries the same regular/OT a normal
 * clock-out would (previously the cron wrote total_hours only → 0 paid hours).
 *
 * THE PAID WINDOW (owner rules 2026-08-13) applies to FT exactly as it does to
 * PT — same basis, both cohorts. Pay runs from the LATER of clock-in and the
 * rostered start to the EARLIER of clock-out and the rostered end. Waiting
 * around before shift never accrues hours (this was the 2026-07-28 early
 * clock-in policy, now symmetric), and staying past the rostered end no longer
 * silently becomes payable OT — it is an OT tail that needs approval (rule 4),
 * counted in 30-min brackets (rule 6). totalHours still records the actual
 * clocked span, and hours INSIDE the window still split at the OT threshold.
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
  const graceMs = CLOCK_GRACE_MINUTES * 60000;
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
  const earlyOutBy = schedEndMs - clockOut.getTime();
  const gracedEnd = scheduledEnd && earlyOutBy > 0 && earlyOutBy <= graceMs
    ? schedEndMs
    : Math.min(clockOut.getTime(), schedEndMs);
  const payEndMs = Math.max(payStartMs, gracedEnd);
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
