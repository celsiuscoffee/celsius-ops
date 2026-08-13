// Confirmation state of a PT attendance log for the manager sign-off screen.
//
// The distinction this file exists to protect: `final_status: "approved"` is NOT
// evidence a manager confirmed anything. Three automated paths write it —
// the AI processor auto-approves any log with no actionable flag
// (agents/attendance-processor.ts), the auto-close cron closes forgotten
// tap-outs (api/cron/attendance-auto-close), and OT sync stamps approved when
// an OT request is settled (ot-payroll-sync.ts). Reading `final_status` alone
// showed those rows as "Confirmed" on a screen whose entire purpose is the
// manager's sign-off before part-timers get paid, so managers saw shifts
// confirmed that they had never touched.
//
// `reviewed_by` is the only field exclusively written by a human action:
// the PT confirm POST and the attendance review queue both stamp
// session.id. NOTE the trap — the auto-close cron DOES write `reviewed_at`
// and `review_notes`, so neither of those can stand in for it.
export type PtLogStateInput = {
  final_status: string | null;
  ai_status: string | null;
  reviewed_by: string | null;
};

export type PtLogState = "pending" | "flagged" | "confirmed" | "rejected";

/** True only when a person signed this log off (never for an automated approval). */
export function isManagerConfirmed(log: PtLogStateInput): boolean {
  if (!log.reviewed_by) return false;
  return log.final_status === "approved" || log.final_status === "adjusted";
}

export function ptLogState(log: PtLogStateInput): PtLogState {
  if (log.final_status === "rejected") return "rejected";
  if (isManagerConfirmed(log)) return "confirmed";
  return log.ai_status === "flagged" ? "flagged" : "pending";
}
