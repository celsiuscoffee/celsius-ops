/**
 * Deterministic anomaly detection for payroll cycles.
 *
 * Flags issues HR should review before approving. Not LLM-based — all rules
 * are explicit. Severity determines whether flag blocks approval.
 *
 * Flags stored on `hr_payroll_items.anomaly_flags` as jsonb array.
 */

export type AnomalySeverity = "block" | "warn" | "info";

export type AnomalyFlag = {
  code:
    | "mom_spike"
    | "missing_bank"
    | "missing_ot_history"
    | "resignation_not_prorated"
    | "statutory_deviation"
    | "negative_net"
    | "low_hours_part_time"
    | "excessive_ot";
  severity: AnomalySeverity;
  message: string;           // shown inline in review UI
  fixUrl?: string;            // optional deep-link for one-click fix
  dismissible: boolean;       // can HR dismiss with a note?
  context?: Record<string, unknown>; // extra data for debugging
};

type ItemLike = {
  user_id: string;
  total_gross: number;
  net_pay: number;
  epf_employee: number;
  total_regular_hours: number;
  total_ot_hours: number;
  prorate_reason?: string | null;
};

type ProfileLike = {
  user_id: string;
  name?: string;
  employment_type?: string | null;
  payroll_cadence?: string | null;
  resigned_at?: string | null;
  end_date?: string | null;
  // User record joined in
  bankAccountNumber?: string | null;
};

type PriorItemLike = {
  user_id: string;
  total_gross: number;
  total_ot_hours: number;
  total_regular_hours: number;
};

const MOM_SPIKE_THRESHOLD = 0.2;              // ±20%
const OT_HISTORY_LOOKBACK_CYCLES = 3;         // flag if 3 prior cycles had OT but this one doesn't
const EXCESSIVE_OT_HOURS = 100;                // per cycle
const LOW_HOURS_PART_TIME_RATIO = 0.5;         // < 50% of prior avg

export function detectAnomalies(
  item: ItemLike,
  profile: ProfileLike,
  priorItems: PriorItemLike[] = [], // same user, prior cycles (newest first)
): AnomalyFlag[] {
  const flags: AnomalyFlag[] = [];
  const name = profile.name ?? profile.user_id.slice(0, 8);

  // ── BLOCKING FLAGS ──────────────────────────────────────────────────────

  // Missing bank details — can't pay the staff
  if (!profile.bankAccountNumber) {
    flags.push({
      code: "missing_bank",
      severity: "block",
      message: `${name} has no bank account on file. Add it before approving.`,
      fixUrl: `/hr/employees?userId=${profile.user_id}`,
      dismissible: false,
    });
  }

  // Resignation not reflected — if end_date or resigned_at is set but not prorated
  const resigned = profile.resigned_at ?? profile.end_date ?? null;
  if (resigned && !item.prorate_reason) {
    flags.push({
      code: "resignation_not_prorated",
      severity: "block",
      message: `${name} has resignation date ${resigned} but salary is not prorated. Recompute.`,
      dismissible: false,
      context: { resigned },
    });
  }

  // Negative net pay — deductions exceed gross
  if (item.net_pay < 0) {
    flags.push({
      code: "negative_net",
      severity: "block",
      message: `${name}: net pay is negative (RM ${item.net_pay.toFixed(2)}). Deductions exceed gross.`,
      dismissible: false,
    });
  }

  // ── WARNING FLAGS ───────────────────────────────────────────────────────

  // Month-over-month spike on gross
  const prior = priorItems[0];
  if (prior && prior.total_gross > 0) {
    const delta = (item.total_gross - prior.total_gross) / prior.total_gross;
    if (Math.abs(delta) > MOM_SPIKE_THRESHOLD) {
      const pct = (delta * 100).toFixed(0);
      const direction = delta > 0 ? "+" : "";
      flags.push({
        code: "mom_spike",
        severity: "warn",
        message: `${name}: gross pay ${direction}${pct}% vs last cycle (RM ${prior.total_gross.toFixed(2)} → RM ${item.total_gross.toFixed(2)}). Verify.`,
        dismissible: true,
        context: { priorGross: prior.total_gross, thisGross: item.total_gross, deltaPct: delta },
      });
    }
  }

  // Zero OT but staff historically had OT
  const priorOtCycles = priorItems
    .slice(0, OT_HISTORY_LOOKBACK_CYCLES)
    .filter((p) => p.total_ot_hours > 0).length;
  if (item.total_ot_hours === 0 && priorOtCycles === OT_HISTORY_LOOKBACK_CYCLES) {
    flags.push({
      code: "missing_ot_history",
      severity: "warn",
      message: `${name}: no OT this cycle but worked OT every prior cycle. Check for missed clock-ins.`,
      dismissible: true,
    });
  }

  // Excessive OT — possible data error or policy issue
  if (item.total_ot_hours > EXCESSIVE_OT_HOURS) {
    flags.push({
      code: "excessive_ot",
      severity: "warn",
      message: `${name}: ${item.total_ot_hours.toFixed(0)} OT hours this cycle (threshold ${EXCESSIVE_OT_HOURS}). Sanity check.`,
      dismissible: true,
    });
  }

  // Part-timer low hours — may indicate no-show or schedule issue
  if (profile.payroll_cadence === "WEEKLY" || profile.employment_type === "part_time") {
    const recent = priorItems.slice(0, 3).filter((p) => p.total_regular_hours > 0);
    if (recent.length >= 2) {
      const avgHours = recent.reduce((s, p) => s + p.total_regular_hours, 0) / recent.length;
      if (avgHours > 0 && item.total_regular_hours / avgHours < LOW_HOURS_PART_TIME_RATIO) {
        flags.push({
          code: "low_hours_part_time",
          severity: "warn",
          message: `${name}: ${item.total_regular_hours.toFixed(0)} hrs this cycle vs ${avgHours.toFixed(0)} avg. Confirm shifts with manager.`,
          dismissible: true,
        });
      }
    }
  }

  // ── INFO FLAGS ──────────────────────────────────────────────────────────

  // Statutory deviation — EPF employee share doesn't match expected 11% of wage
  // (allow RM 2 rounding slack). Only flags as info — the statutory engine is
  // the source of truth; this catches data drift.
  if (item.total_gross > 0 && item.epf_employee > 0) {
    const expectedEpf = item.total_gross * 0.11;
    const diff = Math.abs(item.epf_employee - expectedEpf);
    if (diff > 2 && diff / expectedEpf > 0.1) {
      flags.push({
        code: "statutory_deviation",
        severity: "info",
        message: `${name}: EPF employee share RM ${item.epf_employee.toFixed(2)} differs from 11% of gross (~RM ${expectedEpf.toFixed(2)}). Normal if staff is 60+ or custom rate.`,
        dismissible: true,
      });
    }
  }

  return flags;
}

/**
 * Compute whether a cycle can be approved — fails if any flag has severity=block
 * and is not dismissed.
 */
export function canApproveCycle(flagsByItem: Map<string, AnomalyFlag[]>): {
  canApprove: boolean;
  blockingCount: number;
  blockingFlags: AnomalyFlag[];
} {
  const blockingFlags: AnomalyFlag[] = [];
  for (const flags of flagsByItem.values()) {
    for (const f of flags) {
      if (f.severity === "block") blockingFlags.push(f);
    }
  }
  return {
    canApprove: blockingFlags.length === 0,
    blockingCount: blockingFlags.length,
    blockingFlags,
  };
}
