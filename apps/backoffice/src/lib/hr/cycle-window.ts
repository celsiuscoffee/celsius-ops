// When a payroll cycle ends, in MYT — the one place that decides whether a
// cycle may be computed or confirmed yet.
//
// Owner 2026-09-15: "for payroll computation, please block the future cycle.
// it can be miss compute."
//
// CONFIRM already refused an unfinished cycle (the Aug 2026 run was computed on
// 1 August with 0 regular hours and 0 OT across all 28 lines, and nothing
// stopped it being paid). COMPUTE never did: the month picker offered all
// twelve months, so picking December in September produced a full month's
// BASIC SALARY for a month that has not happened, with no attendance behind it.
// Basic salary does not depend on attendance, so such a run looks entirely
// normal — that is what makes it dangerous.
//
// MYT (UTC+8), not UTC: a UTC comparison keeps a finished month blocked until
// 08:00 local on the 1st.

/** Last instant of monthly cycle `month`/`year` in MYT, as epoch ms. */
export function monthlyCycleEndMs(year: number, month: number): number | null {
  if (!Number.isInteger(year) || !Number.isInteger(month)) return null;
  if (month < 1 || month > 12 || year < 2000 || year > 2200) return null;
  // Day 0 of the NEXT month is the last day of this one. Computed in UTC so the
  // server's own timezone cannot shift it.
  const lastDay = new Date(Date.UTC(year, month, 0)).getUTCDate();
  const ms = Date.parse(
    `${year}-${String(month).padStart(2, "0")}-${String(lastDay).padStart(2, "0")}T23:59:59+08:00`,
  );
  return Number.isNaN(ms) ? null : ms;
}

/** Cycle end for a stored run: explicit period_end (weekly) else month/year. */
export function cycleEndMsFor(cycle: {
  period_end?: string | null;
  period_year?: number | null;
  period_month?: number | null;
}): number | null {
  if (cycle.period_end) {
    const ms = Date.parse(`${cycle.period_end}T23:59:59+08:00`);
    return Number.isNaN(ms) ? null : ms;
  }
  if (cycle.period_year && cycle.period_month) {
    return monthlyCycleEndMs(cycle.period_year, cycle.period_month);
  }
  return null;
}

/** Whole days from `nowMs` to the cycle end, rounded up. At least 1 while open. */
export function daysRemaining(endMs: number, nowMs: number): number {
  return Math.max(1, Math.ceil((endMs - nowMs) / 86_400_000));
}

/**
 * True when the cycle is still running at `nowMs` — computing or confirming it
 * would price a month that has not finished. An unknown end (null) is NOT
 * treated as open: a cycle we cannot date must not be blocked forever.
 */
export function cycleStillOpen(endMs: number | null, nowMs: number): boolean {
  return endMs != null && nowMs < endMs;
}

/**
 * The most recent monthly cycle that has ENDED, in MYT — the right default for
 * a payroll screen. Defaulting to the CURRENT month put the picker on a cycle
 * that cannot be computed, so the page opened on a disabled option.
 */
export function lastEndedCycle(nowMs: number): { year: number; month: number } {
  // MYT calendar date for "now", so the default flips on the 1st local, not at
  // 08:00 local the way a UTC month would.
  const myt = new Date(nowMs + 8 * 3600 * 1000);
  let year = myt.getUTCFullYear();
  let month = myt.getUTCMonth() + 1; // current month, which has not ended
  month -= 1;
  if (month < 1) {
    month = 12;
    year -= 1;
  }
  return { year, month };
}
