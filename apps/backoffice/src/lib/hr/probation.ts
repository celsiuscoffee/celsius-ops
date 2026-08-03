// Probation, in one place, because payroll and the HR profile page were
// disagreeing about who was on it.
//
// Owner 2026-08-03, in order:
//   "if probation, should guard during payroll computation. no need to manual
//    fill reason"  →  the gate must fire in the calculator, not be applied by
//    hand, lever by lever, with a typed reason.
//   "follow HR profile"
//   "probation will end only after confirmation. it is not time base"  ←  THIS
//    IS THE RULE. Elapsed time never confirms anybody.
//
// So probation ends on an EVENT, not a date. Someone 200 days past their
// nominal probation end who has never been confirmed is still on probation and
// still earns no performance allowance. An earlier revision of this file used
// "explicit probation_end_date, else join + 90 days" — that is exactly the
// time-based rule the owner rejected, and it would have paid people nobody has
// signed off. Replaced.
//
// `confirmed_at` is the event. It is written by the probation-review flow when
// an OWNER/ADMIN approves a `decision = 'confirm'` review, and nothing else
// writes it.
//
// `probation_end_date` survives, with a NARROWER meaning: the date confirmation
// is EXPECTED, i.e. when the review is due. The extend flow pushes it out. It is
// scheduling information for the HR banner and it must never decide pay — that
// is what made the old rule wrong.

/** Nominal probation length, used only to SCHEDULE the review that confirms
 *  someone. It does not end probation; see the module comment. */
export const DEFAULT_PROBATION_DAYS = 90;

/**
 * When is this person's probation review due?
 *
 * Purely informational — for the "confirmation due in N days" banner and for
 * chasing overdue reviews. Never gate pay on this.
 */
export function probationReviewDue(
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
 * Is this person on probation for a payroll month ending `monthEnd`?
 *
 * On probation until confirmed. The only thing that ends it is `confirmed_at`,
 * and it ends it from the month the confirmation lands — compared against the
 * END of the month, so someone confirmed part-way through is paid for that whole
 * month. That is the generous side of the boundary and it is deliberate: losing
 * a month's allowance to a mid-month confirmation date is the worse error.
 *
 * A confirmation dated in the FUTURE does not apply yet, which is what stops a
 * post-dated confirmation from paying someone early.
 */
export function isOnProbation(
  monthEnd: string,
  confirmedAt: string | null | undefined,
): boolean {
  if (!confirmedAt) return true;
  return confirmedAt.slice(0, 10) > monthEnd;
}

/**
 * Is this review overdue? Used to chase HR, not to pay anybody.
 */
export function isProbationReviewOverdue(
  today: string,
  joinDate: string | null | undefined,
  probationEndDate: string | null | undefined,
  confirmedAt: string | null | undefined,
): boolean {
  if (confirmedAt) return false;
  const due = probationReviewDue(joinDate, probationEndDate);
  return !!due && due < today;
}
