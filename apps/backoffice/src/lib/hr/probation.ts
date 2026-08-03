// Probation, in one place, because payroll and the HR profile page were
// disagreeing about who was on it.
//
// Owner 2026-08-03: "if probation, should guard during payroll computation. no
// need to manual fill reason" / "follow HR profile".
//
// The HR profile page has always used: explicit probation_end_date if set,
// otherwise join_date + 90 days. Payroll read the raw column only — and that
// column is NULL on 61 of 62 active profiles, so the payroll gate never fired
// for anyone. The exclusion was being done by editing each lever by hand with a
// typed reason ("probation", "not yet confirm"), which is why Nur Iffa Sofea was
// paid RM120.00 in July: her seven colleagues were edited, she was missed.
//
// Same rule, one function, both callers.

/** Default probation length when the profile carries no explicit end date.
 *  90 days = the "Probation end (3 months)" onboarding stage. */
export const DEFAULT_PROBATION_DAYS = 90;

/**
 * The date probation ends for this person, or null if it cannot be determined.
 *
 * An explicit `probation_end_date` ALWAYS wins — that is what lets HR confirm
 * someone early or extend them, and it is what the probation-review flow writes.
 * Falling back to join + 90 days only fills the gap where nobody has recorded a
 * decision yet.
 */
export function effectiveProbationEnd(
  joinDate: string | null | undefined,
  probationEndDate: string | null | undefined,
): string | null {
  if (probationEndDate) return probationEndDate;
  if (!joinDate) return null;
  const t = Date.parse(`${joinDate.slice(0, 10)}T00:00:00Z`);
  if (!Number.isFinite(t)) return null;
  return new Date(t + DEFAULT_PROBATION_DAYS * 86_400_000).toISOString().slice(0, 10);
}

/**
 * Is this person on probation for the payroll month ending `monthEnd`?
 *
 * Compared against the END of the month, so someone confirmed part-way through
 * is paid for that whole month. That is the generous side of the boundary and
 * it is deliberate: losing a month's allowance to a mid-month confirmation date
 * would be the worse error.
 *
 * Returns false when neither a probation end date nor a join date is known.
 * "Unknown" must not read as "on probation" — that would silently zero the
 * allowance for anyone with an incomplete profile.
 */
export function isOnProbation(
  monthEnd: string,
  joinDate: string | null | undefined,
  probationEndDate: string | null | undefined,
): boolean {
  const end = effectiveProbationEnd(joinDate, probationEndDate);
  return !!end && monthEnd <= end;
}
