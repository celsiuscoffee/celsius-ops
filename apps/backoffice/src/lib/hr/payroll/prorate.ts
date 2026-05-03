/**
 * Proration for payroll. Matches BrioHR's per-employee setup, which itself
 * follows the Malaysian Employment Act 1955 Section 60I.
 *
 * Two formulas supported (per `basis`):
 *   - calendar     : monthly_wage × days_worked / N_days_in_cycle
 *                    (statutory default, Section 60I(1B), post-2023)
 *   - working_5day : monthly_wage × weekdays_worked / N_weekdays_in_cycle
 *                    (Mon-Fri only, Section 60I(1C) with contractual
 *                     denominator — what Brio uses for HQ staff)
 *   - working_6day : monthly_wage × workdays_worked / N_workdays_in_cycle
 *                    (Mon-Sat, for staff with Sun-only rest days)
 *   - fixed_26     : monthly_wage × days_worked / 26
 *                    (legacy convention, useful for rate-of-pay calc)
 *
 * Triggers (first match wins):
 *   1. Joined within the cycle → prorate from join date to cycle end
 *   2. Resigned within the cycle → prorate from cycle start to resignation date
 *   3. Approved unpaid leave during cycle → reduces effective days_worked
 *
 * Per-employee `basis` lives on hr_employee_profiles.proration_basis. HQ staff
 * default to working_5day, outlet staff default to calendar.
 */

import { formatRM } from "@celsius/shared";

export type ProrateBasis = "calendar" | "working_5day" | "working_6day" | "fixed_26";
export type ProrateReason = "joiner" | "resigner" | "joiner_and_resigner" | "unpaid_leave" | null;

export type ProrateResult = {
  reason: ProrateReason;
  daysWorked: number;
  daysTotal: number;
  factor: number;           // 0..1, applied to prorateable components
  explanation: string | null; // human-readable, shown on payslip
  basis: ProrateBasis;
};

function dateOnly(d: string | Date): Date {
  const dt = typeof d === "string" ? new Date(d) : d;
  return new Date(Date.UTC(dt.getUTCFullYear(), dt.getUTCMonth(), dt.getUTCDate()));
}

function daysBetween(start: Date, end: Date): number {
  // Inclusive on both ends for calendar-day proration.
  const ms = dateOnly(end).getTime() - dateOnly(start).getTime();
  return Math.floor(ms / 86_400_000) + 1;
}

// Count Mon-Fri (working_5day) or Mon-Sat (working_6day) days in [start, end] inclusive.
// 0=Sun, 1=Mon, ..., 6=Sat.
function workingDaysBetween(start: Date, end: Date, basis: "working_5day" | "working_6day"): number {
  const max = basis === "working_5day" ? 5 : 6; // Mon=1..Fri=5 or Mon=1..Sat=6
  let count = 0;
  const cursor = new Date(start.getTime());
  while (cursor.getTime() <= end.getTime()) {
    const dow = cursor.getUTCDay();
    if (dow >= 1 && dow <= max) count++;
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }
  return count;
}

export function computeProrate(params: {
  cycleStart: string | Date;
  cycleEnd: string | Date;
  joinDate?: string | null;
  resignDate?: string | null;
  unpaidLeaveDays?: number;  // total approved unpaid days overlapping this cycle
  fullSalary: number;         // used for explanation text only
  basis?: ProrateBasis;       // defaults to 'calendar' if omitted
}): ProrateResult {
  const basis: ProrateBasis = params.basis ?? "calendar";
  const start = dateOnly(params.cycleStart);
  const end = dateOnly(params.cycleEnd);

  // Helper: count days in [s, e] using the active basis.
  const countDays = (s: Date, e: Date): number => {
    if (basis === "calendar") return daysBetween(s, e);
    if (basis === "fixed_26") return daysBetween(s, e); // numerator only — denominator is hard-coded 26 below
    return workingDaysBetween(s, e, basis);
  };
  // Denominator: total reference days for the wage period.
  const daysTotal = basis === "fixed_26" ? 26 : countDays(start, end);

  // Detect both joiner and resigner windows upfront so the rare case of
  // joining and resigning within the same cycle is prorated on the
  // intersection — not just the joiner slice.
  const j = params.joinDate && dateOnly(params.joinDate);
  const r = params.resignDate && dateOnly(params.resignDate);
  const joiner = j && j > start && j <= end ? j : null;
  const resigner = r && r >= start && r < end ? r : null;

  const basisLabel = basis === "calendar" ? "calendar days"
                   : basis === "working_5day" ? "Mon-Fri days"
                   : basis === "working_6day" ? "Mon-Sat days"
                   : "days (fixed /26)";

  if (joiner && resigner) {
    // Work from the later of (start, joinDate) to the earlier of (end, resignDate).
    const windowStart = joiner;
    const windowEnd = resigner;
    const worked = Math.max(0, countDays(windowStart, windowEnd));
    return {
      reason: "joiner_and_resigner",
      daysWorked: worked,
      daysTotal,
      factor: daysTotal === 0 ? 0 : worked / daysTotal,
      basis,
      explanation: `Salary prorated: ${formatRM(params.fullSalary)} × ${worked}/${daysTotal} ${basisLabel} (joined ${joiner.toISOString().slice(0, 10)}, resigned ${resigner.toISOString().slice(0, 10)})`,
    };
  }

  // Priority 1: joined mid-cycle
  if (joiner) {
    const worked = countDays(joiner, end);
    return {
      reason: "joiner",
      daysWorked: worked,
      daysTotal,
      factor: daysTotal === 0 ? 0 : worked / daysTotal,
      basis,
      explanation: `Salary prorated: ${formatRM(params.fullSalary)} × ${worked}/${daysTotal} ${basisLabel} based on join date ${joiner.toISOString().slice(0, 10)}`,
    };
  }

  // Priority 2: resigned mid-cycle
  if (resigner) {
    const worked = countDays(start, resigner);
    return {
      reason: "resigner",
      daysWorked: worked,
      daysTotal,
      factor: daysTotal === 0 ? 0 : worked / daysTotal,
      basis,
      explanation: `Salary prorated: ${formatRM(params.fullSalary)} × ${worked}/${daysTotal} ${basisLabel} based on resignation date ${resigner.toISOString().slice(0, 10)}`,
    };
  }

  // Priority 3: unpaid leave (always counted in calendar days regardless of
  // basis — that's how leave policies are recorded).
  const unpaid = Math.floor(params.unpaidLeaveDays ?? 0);
  if (unpaid > 0) {
    const worked = Math.max(0, daysTotal - unpaid);
    return {
      reason: "unpaid_leave",
      daysWorked: worked,
      daysTotal,
      factor: daysTotal === 0 ? 0 : worked / daysTotal,
      basis,
      explanation: `Salary adjusted: ${unpaid} unpaid leave day${unpaid === 1 ? "" : "s"} deducted from ${daysTotal} ${basisLabel}`,
    };
  }

  // Full cycle, no prorate
  return {
    reason: null,
    daysWorked: daysTotal,
    daysTotal,
    factor: 1,
    basis,
    explanation: null,
  };
}

/**
 * Apply prorate factor to a component. Returns cents-rounded amount.
 * Variable components (OT, bonus, commission) should NOT use this — they're
 * paid on actuals regardless of cycle coverage.
 */
export function prorateAmount(fullAmount: number, result: ProrateResult): number {
  return Math.round(fullAmount * result.factor * 100) / 100;
}
