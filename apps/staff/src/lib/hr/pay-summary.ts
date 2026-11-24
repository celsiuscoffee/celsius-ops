// Pay tab (owner, 20 Nov 2026: "Pay tab for every staff member — pay for the
// month so far, payday, overtime still waiting, the allowance and the latest
// payslip, so staff stop asking 'is my pay ready?'"). Modelled on Gosamē's
// Staff app Pay tab.
//
// READ-ONLY. Nothing here prices anything payroll does not already price: the
// rules below are payroll's own, restated as pure functions so the Pay view and
// its tests read the same thing payroll reads.
//   - Monthly OT approval: apps/backoffice/src/lib/hr/agents/payroll-calculator.ts
//     (isOtApproved, OT_MIN_HOURS, 2dp hours).
//   - Manager sign-off of a part-timer's shift: apps/backoffice/src/lib/hr/pt-log-state.ts
//     (isManagerConfirmed: reviewed_by set AND final_status approved/adjusted).
//   - Weeks are Monday to Sunday, Malaysia time (payroll-calculator-weekly.ts).
// There is NO money formula here beyond adding payroll's own components
// (basic salary on the profile, the allowance engine's total, recurring
// additions). Overtime is shown in hours, never ringgit: payroll prices it at
// month end against the approved budget, and a second formula would drift.
//
// Pure: no I/O, no `@/` imports (the root vitest run maps `@/` to backoffice).

export type PayLog = {
  clock_in: string;
  clock_out: string | null;
  total_hours: number | string | null;
  overtime_hours: number | string | null;
  ai_status: string | null;
  final_status: string | null;
  reviewed_by: string | null;
  clock_in_method: string | null;
};

export type PendingOt = { date: string; hours_requested: number | string | null };

export type RunStatus = "preparing" | "confirmed" | "paid";

/** One payroll line of this person's, with its run (hr_payroll_items ⋈ hr_payroll_runs). */
export type PayItemRow = {
  id: string;
  net_pay: number | string | null;
  run: {
    status: string | null;
    cycle_type: string | null;
    period_month: number | null;
    period_year: number | null;
    period_start: string | null;
    period_end: string | null;
    payday?: string | null;
  };
};

export type PayResponse = {
  today: string;
  cycle: "monthly" | "weekly";
  monthly: null | {
    month: string; // YYYY-MM
    basicSalary: number | null;
    additions: { label: string; amount: number }[];
    allowance:
      | { state: "counted"; earned: number; max: number; daysRemaining: number }
      | { state: "probation"; earned: number; max: number }
      | { state: "not_eligible" }
      | { state: "unavailable" };
    /** Basic + allowance so far + fixed additions. An estimate before deductions and before overtime. */
    soFar: number | null;
    overtime: { approvedHours: number; waitingHours: number; waiting: { date: string; hours: number }[] };
    /** Payday for this month's pay: a run's own payday, else null (the page says "by the 7th"). */
    payday: string | null;
  };
  weekly: null | {
    thisWeek: WeekSummary;
    lastWeek: WeekSummary & { run: { status: RunStatus; payday: string | null } | null };
  };
  /** Last month's pay (full-timers): is it ready? */
  lastMonth: null | {
    month: string; // YYYY-MM
    status: RunStatus | "not_started";
    payday: string | null;
    /** The day the payslip opens, when HR holds payslips to a release day. */
    opensOn: string | null;
  };
  latestPayslip: null | { id: string; label: string; netPay: number; weekly: boolean };
};

export type WeekSummary = {
  start: string; // Monday, YYYY-MM-DD
  end: string; // Sunday
  shifts: number;
  /** Hours on the clock-ins (the log's total_hours). Payroll pays the part inside the rostered shift. */
  clockedHours: number;
  signedOff: number;
  /** A shift still clocked in (no clock-out yet). */
  onShift: boolean;
  otApprovedHours: number;
  otWaitingHours: number;
};

const r2 = (n: number) => Math.round(n * 100) / 100;
const num = (v: unknown) => Number(v ?? 0) || 0;

/** A UTC instant as its Malaysia calendar date (YYYY-MM-DD). */
export function mytDate(iso: string): string {
  return new Date(new Date(iso).getTime() + 8 * 3600 * 1000).toISOString().slice(0, 10);
}

/** YYYY-MM-DD plus n days (pure date maths, no time zone). */
export function addDays(date: string, n: number): string {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

/** The Monday of the Monday-to-Sunday week holding `date`. */
export function weekStartOf(date: string): string {
  const dow = new Date(`${date}T00:00:00Z`).getUTCDay(); // 0 Sun … 6 Sat
  return addDays(date, dow === 0 ? -6 : 1 - dow);
}

/** "2026-11" → "2026-10". */
export function monthBefore(ym: string): string {
  const [y, m] = ym.split("-").map(Number);
  return m === 1 ? `${y - 1}-12` : `${y}-${String(m - 1).padStart(2, "0")}`;
}

/** Payroll's rule: the manager's decision wins; the AI's approval counts only while no manager has decided. */
export function isOtApproved(log: { ai_status: string | null; final_status: string | null }): boolean {
  return log.final_status === "approved" || log.final_status === "adjusted" || (log.ai_status === "approved" && !log.final_status);
}

/** Payroll's floor: one 30-minute bracket (owner 2026-09-03: "pay the 0.5h"). */
export const OT_MIN_HOURS = 0.5;

/** A log's payable overtime as payroll counts it: 2dp, nothing below one bracket, only when approved. */
export function approvedOtHours(log: Pick<PayLog, "overtime_hours" | "ai_status" | "final_status">): number {
  const h = r2(num(log.overtime_hours));
  return isOtApproved(log) && h >= OT_MIN_HOURS ? h : 0;
}

/** True only when a person signed the shift off — never an automated approval (pt-log-state.ts). */
export function isManagerConfirmed(log: Pick<PayLog, "reviewed_by" | "final_status">): boolean {
  if (!log.reviewed_by) return false;
  return log.final_status === "approved" || log.final_status === "adjusted";
}

/** Pending OT requests, per date, in whole 30-minute brackets (as the attendance view counts them). */
export function waitingOt(reqs: PendingOt[]): { date: string; hours: number }[] {
  const byDate = new Map<string, number>();
  for (const r of reqs) {
    const h = Math.floor(num(r.hours_requested) * 2) / 2;
    if (h >= OT_MIN_HOURS) byDate.set(r.date, (byDate.get(r.date) ?? 0) + h);
  }
  return [...byDate.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([date, hours]) => ({ date, hours }));
}

const isRealShift = (l: PayLog) => l.clock_in_method !== "ot_approval" && l.final_status !== "rejected";

/**
 * One Monday-to-Sunday week of a part-timer's shifts: how many, the clocked
 * hours, how many a manager signed off, and the OT approved or still waiting.
 * `approvedOt` is hr_overtime_requests approved/partial hours_approved by date,
 * the budget the weekly run pays against.
 */
export function summarizeWeek(
  start: string,
  logs: PayLog[],
  approvedOt: { date: string; hours: number | string | null }[],
  pending: PendingOt[],
): WeekSummary {
  const end = addDays(start, 6);
  const inWeek = (d: string) => d >= start && d <= end;
  const shifts = logs.filter((l) => isRealShift(l) && inWeek(mytDate(l.clock_in)));
  return {
    start,
    end,
    shifts: shifts.length,
    clockedHours: r2(shifts.reduce((t, l) => t + (l.clock_out ? num(l.total_hours) : 0), 0)),
    signedOff: shifts.filter((l) => l.clock_out && isManagerConfirmed(l)).length,
    onShift: shifts.some((l) => !l.clock_out),
    otApprovedHours: r2(approvedOt.filter((o) => inWeek(o.date)).reduce((t, o) => t + num(o.hours), 0)),
    otWaitingHours: r2(waitingOt(pending.filter((p) => inWeek(p.date))).reduce((t, o) => t + o.hours, 0)),
  };
}

/** A month's approved OT hours from the logs payroll reads (OT-approval rows included, rejections out). */
export function monthApprovedOt(logs: PayLog[], ym: string): number {
  return r2(
    logs
      .filter((l) => l.final_status !== "rejected" && mytDate(l.clock_in).slice(0, 7) === ym)
      .reduce((t, l) => t + approvedOtHours(l), 0),
  );
}

/** A run's status in the words staff need: being prepared, confirmed (ready), paid. */
export function runStatus(status: string | null | undefined): RunStatus | null {
  if (status === "paid") return "paid";
  if (status === "confirmed") return "confirmed";
  if (status === "draft" || status === "ai_computed") return "preparing";
  return null; // void, opening_balance imports, anything unknown
}

/** Payroll's own components added up: basic + allowance (when payroll will pay it) + fixed additions. */
export function soFarEstimate(basic: number | null, allowance: number | null, additions: { amount: number }[]): number | null {
  if (basic == null) return null;
  return r2(basic + (allowance ?? 0) + additions.reduce((t, a) => t + a.amount, 0));
}

const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
const MON = MONTHS.map((m) => m.slice(0, 3));
const DOW = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

/** "2026-11" → "November". */
export function monthName(ym: string): string {
  return MONTHS[Number(ym.slice(5, 7)) - 1] ?? ym;
}

/** "2026-12-03" → "3 Dec". */
export function dayMonth(date: string): string {
  const [, m, d] = date.slice(0, 10).split("-").map(Number);
  return `${d} ${MON[m - 1] ?? ""}`.trim();
}

/** "2026-12-03" → "Thu 3 Dec". */
export function dayLabel(date: string): string {
  return `${DOW[new Date(`${date.slice(0, 10)}T00:00:00Z`).getUTCDay()]} ${dayMonth(date)}`;
}

/** "RM 1,234.50": two decimals, always. */
export function rm(n: number | null | undefined): string {
  return `RM ${(Number(n) || 0).toLocaleString("en-MY", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

/** "1 hr", "2.5 hrs", "0 hrs". */
export function hoursWords(h: number): string {
  const v = r2(h);
  return `${v} ${v === 1 ? "hr" : "hrs"}`;
}

/** The latest payslip's label: "October" or "Week of 10 Nov". */
export function payslipLabel(run: PayItemRow["run"]): { label: string; weekly: boolean } {
  const weekly = run.cycle_type === "weekly" || run.period_month == null;
  if (weekly) return { label: run.period_start ? `Week of ${dayMonth(run.period_start)}` : "Weekly pay", weekly };
  return { label: `${MONTHS[(run.period_month as number) - 1]} ${run.period_year ?? ""}`.trim(), weekly };
}
