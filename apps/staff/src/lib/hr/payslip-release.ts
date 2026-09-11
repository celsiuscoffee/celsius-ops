/**
 * When does a payslip become visible to the employee?
 *
 * Until 2026-09-11 the answer was "the instant HR confirms the run". The July
 * monthly run was confirmed on 7 August, so staff saw that payslip on the 7th —
 * before the money necessarily landed. Owner asked to open monthly payslips on a
 * fixed day instead ("can we open payslip after 15th?").
 *
 * THE RULE. `payslip_release_day` (hr_company_settings, 1..28, NULL = off) is a
 * day of the FOLLOWING month: August payroll opens on 15 September when set to
 * 15. NULL keeps the old behaviour exactly, so the feature is inert until HR
 * sets a day.
 *
 * WEEKLY RUNS ARE NEVER GATED. A part-timer is paid weekly; holding their slip
 * until a monthly date would hide it for up to three weeks. Only `monthly` runs
 * are held back — and only when we can actually date them (a monthly run with no
 * period_month/period_year is released rather than hidden forever, because a run
 * we cannot date is not a run we should silently bury).
 *
 * Pure — the list endpoint, the PDF endpoint and the tests all price visibility
 * through this one function so a payslip can never be hidden from the list yet
 * still downloadable by URL.
 */

export type ReleasableRun = {
  cycle_type?: string | null;
  period_month?: number | null;
  period_year?: number | null;
};

/** Last calendar day of a 1-based month. */
function lastDayOfMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

function pad(n: number): string {
  return String(n).padStart(2, "0");
}

/**
 * The MYT date (YYYY-MM-DD) this payslip opens on, or null when it is not
 * gated at all (no release day configured, non-monthly cycle, or undatable).
 */
export function payslipReleaseDate(
  run: ReleasableRun,
  releaseDay: number | null | undefined,
): string | null {
  const day = Number(releaseDay);
  if (!Number.isFinite(day) || day < 1) return null;
  if (run.cycle_type !== "monthly") return null;

  // Guard the RAW values before coercing: Number(null) is 0, which is finite,
  // so a null period_year would otherwise sail through as year 0 and produce
  // "0-09-15" — a date string that compares as already released.
  if (run.period_month == null || run.period_year == null) return null;
  const month = Number(run.period_month);
  const year = Number(run.period_year);
  if (!Number.isInteger(month) || !Number.isInteger(year)) return null;
  if (month < 1 || month > 12 || year < 2000) return null;

  // Released in the month AFTER the period the payslip covers.
  const relMonth = month === 12 ? 1 : month + 1;
  const relYear = month === 12 ? year + 1 : year;
  // Clamp so a day past the end of a short month still resolves (the column is
  // capped at 28, but the reader must not depend on that constraint holding).
  const relDay = Math.min(Math.floor(day), lastDayOfMonth(relYear, relMonth));
  return `${relYear}-${pad(relMonth)}-${pad(relDay)}`;
}

/**
 * Is this payslip open to the employee yet? `todayMyt` is a YYYY-MM-DD MYT date
 * (getMYTToday()); string comparison is safe on that zero-padded shape.
 */
export function isPayslipReleased(
  run: ReleasableRun,
  releaseDay: number | null | undefined,
  todayMyt: string,
): boolean {
  const releaseOn = payslipReleaseDate(run, releaseDay);
  return releaseOn === null || todayMyt >= releaseOn;
}
