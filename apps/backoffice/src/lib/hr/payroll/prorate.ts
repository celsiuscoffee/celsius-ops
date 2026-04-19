/**
 * Calendar-day proration for payroll.
 *
 * Matches BrioHR's formula: `salary × days_worked / days_in_cycle`.
 * Aligned with Malaysian Employment Act — uses calendar days, not working days.
 *
 * Triggers (first match wins):
 *   1. Joined within the cycle → prorate from join date to cycle end
 *   2. Resigned within the cycle → prorate from cycle start to resignation date
 *   3. Approved unpaid leave during cycle → reduces effective days_worked
 */

export type ProrateReason = "joiner" | "resigner" | "unpaid_leave" | null;

export type ProrateResult = {
  reason: ProrateReason;
  daysWorked: number;
  daysTotal: number;
  factor: number;           // 0..1, applied to prorateable components
  explanation: string | null; // human-readable, shown on payslip
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

export function computeProrate(params: {
  cycleStart: string | Date;
  cycleEnd: string | Date;
  joinDate?: string | null;
  resignDate?: string | null;
  unpaidLeaveDays?: number;  // total approved unpaid days overlapping this cycle
  fullSalary: number;         // used for explanation text only
}): ProrateResult {
  const start = dateOnly(params.cycleStart);
  const end = dateOnly(params.cycleEnd);
  const daysTotal = daysBetween(start, end);

  // Priority 1: joined mid-cycle
  if (params.joinDate) {
    const j = dateOnly(params.joinDate);
    if (j > start && j <= end) {
      const worked = daysBetween(j, end);
      return {
        reason: "joiner",
        daysWorked: worked,
        daysTotal,
        factor: worked / daysTotal,
        explanation: `Salary prorated: RM ${params.fullSalary.toFixed(2)} × ${worked}/${daysTotal} days based on join date ${j.toISOString().slice(0, 10)}`,
      };
    }
  }

  // Priority 2: resigned mid-cycle
  if (params.resignDate) {
    const r = dateOnly(params.resignDate);
    if (r >= start && r < end) {
      const worked = daysBetween(start, r);
      return {
        reason: "resigner",
        daysWorked: worked,
        daysTotal,
        factor: worked / daysTotal,
        explanation: `Salary prorated: RM ${params.fullSalary.toFixed(2)} × ${worked}/${daysTotal} days based on resignation date ${r.toISOString().slice(0, 10)}`,
      };
    }
  }

  // Priority 3: unpaid leave
  const unpaid = Math.floor(params.unpaidLeaveDays ?? 0);
  if (unpaid > 0) {
    const worked = Math.max(0, daysTotal - unpaid);
    return {
      reason: "unpaid_leave",
      daysWorked: worked,
      daysTotal,
      factor: worked / daysTotal,
      explanation: `Salary adjusted: ${unpaid} unpaid leave day${unpaid === 1 ? "" : "s"} deducted from ${daysTotal} days`,
    };
  }

  // Full cycle, no prorate
  return {
    reason: null,
    daysWorked: daysTotal,
    daysTotal,
    factor: 1,
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
