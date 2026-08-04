// What an hour of overtime is WORTH is decided by hr_overtime_requests, not by
// the attendance log.
//
// Owner ruling 2026-08-03, made on the July data: "the 30h of approved requests
// is the truth, and unapproved hours are paid at PLAIN hourly rather than
// zeroed." July was brought in line by hand — 40 logs got their overtime_type
// stamped to ot_1x — because the monthly calculator only ever looked at the
// attendance log's own approval. A manager confirming a clock-in was correct
// thereby authorised its overtime at the premium rate, and the table that
// records an actual OT decision was never consulted. The weekly (PT)
// calculator has read hr_overtime_requests all along; this closes the same
// loop for the monthly run so August does not need log surgery.
//
// The attendance log still decides WHETHER hours are payable at all (a
// rejected or pending log pays nothing). This split decides only the RATE.

/**
 * Split a log's OT hours into premium-rate and plain-rate portions against the
 * approved hours remaining for that person on that day.
 *
 * Approved hours are a per-day budget shared across a day's logs (split shifts)
 * — the caller decrements what this consumes. Hours beyond the approval are
 * WORKED and PAYABLE, just at 1.0×: zeroing them would leave real worked hours
 * unpaid, which is the error the owner ruled against.
 */
export function splitOtHours(
  otHours: number,
  approvedRemaining: number,
): { premium: number; plain: number } {
  const ot = Math.max(0, Number(otHours) || 0);
  const approved = Math.max(0, Number(approvedRemaining) || 0);
  const premium = Math.min(ot, approved);
  return { premium, plain: ot - premium };
}

/**
 * The OT rate class a log's hours actually deserve, re-derived from the
 * roster AS IT FINALLY STANDS — not from the stamp frozen on the log.
 *
 * Owner 2026-08-03: "rest-day is only when we schedule. it is not fixed on
 * weekends" / "they are entitled to one restday per week." A rest day is a
 * roster row, placed anywhere in the week, and the roster gets edited: on
 * Sunday 2 Aug the whole crew was stamped `rest_day_work` off a roster that
 * was re-published later the same day, and none of them is on a rest day in
 * the schedule as it now stands. The stamp is a snapshot; the schedule is the
 * truth. Payroll therefore re-checks the roster at compute time.
 *
 * Safe to relabel because both branches of deriveHours split hours over the
 * SAME threshold — a wrong rest-day verdict changed only the multiplier,
 * never the regular/OT split. Public-holiday classes are keyed on the holiday
 * table, not the roster, and pass through untouched.
 */
export function effectiveOtType(
  stamped: string | null | undefined,
  isRosteredRestDay: boolean,
): string {
  const t = stamped || "ot_1_5x";
  if (t === "ot_3x" || t === "ph_2x") return t; // holiday classes: roster-independent
  if (isRosteredRestDay) {
    // Rest-day work beyond the threshold is 2× under EA s.60(3). ot_1x is the
    // plain-rate stamp; the request budget decides premium vs plain anyway, so
    // classing it 2× only affects hours inside an approved budget.
    return t === "rest_day_1x" ? t : "ot_2x";
  }
  // Not a rest day in the final roster: rest-day classes are stale Sunday
  // stamps — weekday OT is 1.5×.
  if (t === "ot_2x" || t === "rest_day_1x") return "ot_1_5x";
  return t;
}
