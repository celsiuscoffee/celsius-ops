// Who may change a part-timer's hourly rate, and when that change needs a
// second pair of eyes (owner 2026-08-02).
//
// Ariff (MANAGER) runs PT staffing, so he sets PT rates himself — but only up
// to a ceiling. Above it the change is RECORDED and held at `pending`: it does
// not touch the live profile and payroll never sees it until an OWNER/ADMIN
// approves. OWNER/ADMIN writes are self-approving at any amount — an owner
// setting the rate *is* the approval.
//
// Current PT rates are RM9 weekday / RM10 weekend across all 27 active
// part-timers, so the RM11 ceiling leaves normal adjustments unblocked and
// catches anything that would move the wage band.
//
// Pure — no I/O — so the API route, the UI hint and the tests all agree.

import { PT_RATE_SELF_APPROVE_MAX } from "./constants";

/** salary_type values that describe a part-timer's hourly pay. */
export const PT_RATE_TYPES = ["hourly", "hourly_weekend"] as const;
export type PtRateType = (typeof PT_RATE_TYPES)[number];

export function isPtRateType(t: string): t is PtRateType {
  return (PT_RATE_TYPES as readonly string[]).includes(t);
}

export type RateChangeActor = {
  role: string;
  /** user_ids in this actor's HR subtree; null means unrestricted (OWNER/ADMIN). */
  visibleUserIds: string[] | null;
};

export type RateChangeTarget = {
  user_id: string;
  employment_type: string | null;
};

export type RateChangeDecision =
  | { allowed: false; reason: string }
  | { allowed: true; status: "approved" | "pending"; reason: string };

/**
 * Decide whether `actor` may log `amount` as `salaryType` for `target`, and
 * whether the resulting row takes effect immediately or waits for approval.
 */
export function decideRateChange(
  actor: RateChangeActor,
  target: RateChangeTarget,
  salaryType: string,
  amount: number,
): RateChangeDecision {
  if (!Number.isFinite(amount) || amount < 0) {
    return { allowed: false, reason: "Amount must be a number ≥ 0." };
  }

  const isOwnerAdmin = actor.role === "OWNER" || actor.role === "ADMIN";
  if (isOwnerAdmin) {
    // Unrestricted, and self-approving at any amount.
    return { allowed: true, status: "approved", reason: "Logged by OWNER/ADMIN." };
  }

  if (actor.role !== "MANAGER") {
    return { allowed: false, reason: "Only OWNER, ADMIN or MANAGER can change pay." };
  }

  // A manager's delegation is narrow on purpose: PART-TIMERS ONLY, HOURLY ONLY,
  // and only people inside their own org. Monthly salary stays owner-only.
  if (!isPtRateType(salaryType)) {
    return {
      allowed: false,
      reason: "Managers can only change a part-timer's hourly rate, not monthly salary.",
    };
  }
  if (target.employment_type !== "part_time") {
    return { allowed: false, reason: "This employee is not a part-timer." };
  }
  const visible = actor.visibleUserIds;
  if (visible !== null && !visible.includes(target.user_id)) {
    return { allowed: false, reason: "This employee is not in your team." };
  }

  if (amount > PT_RATE_SELF_APPROVE_MAX) {
    return {
      allowed: true,
      status: "pending",
      reason:
        `RM${amount.toFixed(2)}/hr is above the RM${PT_RATE_SELF_APPROVE_MAX.toFixed(2)} ` +
        `manager limit — saved and sent for owner approval. It does not affect pay until approved.`,
    };
  }

  return { allowed: true, status: "approved", reason: "Within the manager limit — applied." };
}

/** The profile column a PT rate type writes through to. */
export function profileColumnFor(salaryType: PtRateType): "hourly_rate" | "hourly_rate_weekend" {
  return salaryType === "hourly_weekend" ? "hourly_rate_weekend" : "hourly_rate";
}
