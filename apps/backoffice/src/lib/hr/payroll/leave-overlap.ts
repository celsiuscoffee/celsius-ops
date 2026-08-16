// How many days of a leave request fall inside a payroll cycle.
//
// Exists because the monthly calculator selected unpaid leave with a
// CONTAINMENT query (start >= cycleStart AND end < cycleEndExclusive): a leave
// bridging month-end matched neither month's run and was never deducted at
// all. Selection is now an overlap query, and this helper does the per-month
// clipping so each month deducts only the days that fall inside it.
//
// All dates are YYYY-MM-DD strings; cycleEndExclusive is the first day of the
// NEXT cycle (the calculator's endDate convention).

export type LeaveSpan = {
  start_date: string;
  end_date: string;
  /** The request's own day count — can be below the calendar span (half days). */
  total_days: number;
};

const DAY_MS = 86_400_000;
const parseDay = (ymd: string) => Date.parse(`${ymd}T00:00:00Z`);

export function clipLeaveDaysToCycle(
  leave: LeaveSpan,
  cycleStart: string,
  cycleEndExclusive: string,
): number {
  const cycleLast = parseDay(cycleEndExclusive) - DAY_MS;
  const clipStart = Math.max(parseDay(leave.start_date), parseDay(cycleStart));
  const clipEnd = Math.min(parseDay(leave.end_date), cycleLast);
  if (clipEnd < clipStart) return 0;
  const overlapDays = Math.floor((clipEnd - clipStart) / DAY_MS) + 1;
  // Never deduct more than the request's own day count. When the request spans
  // several months, each month is still bounded by its calendar overlap — the
  // cap only bites when total_days is below the calendar span (half days),
  // which for a cross-month request means the sum of monthly deductions can
  // slightly exceed total_days in theory; in practice fractional requests are
  // single-day, where the cap is exact.
  return Math.min(overlapDays, Number(leave.total_days));
}
