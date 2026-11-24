// Manager approvals: the SAME back-office endpoints Office's own pages call,
// reached with the app's Bearer token. Nothing here changes what approving
// does or who may do it: each endpoint keeps its own checks (OWNER / ADMIN
// everything; MANAGER only their outlets or their team), and the back office
// re-reads the person's role from the user row on every call.
//
//   Part-timer hours  GET/POST /api/hr/payroll/weekly/pt-hours   (Office: HR › Confirm PT hours)
//   Overtime          GET/PATCH /api/hr/overtime-requests        (Office: HR › Overtime)
//   Leave             GET/PATCH /api/hr/leave                    (Office: HR › Leave)
//   Shift swaps       GET/PATCH /api/hr/shift-swaps              (Office: HR › Shift swaps)
import { api, ApiError } from "../api";
import { BACKOFFICE_URL } from "../env";
import {
  leaveToDecide,
  otToApprove,
  ptShiftsToSignOff,
  ptWeeks,
  swapsToApprove,
  todayMyt,
  type ApprovalsInput,
  type LeaveRequest,
  type OtRequest,
  type PtHoursResponse,
  type SectionKey,
  type SwapRequest,
} from "./approvals";

// The back office answers 401 for "not a manager" as well as a bad token, so
// a refusal here must never sign the person out of the app.
const office = <T>(path: string, init: RequestInit = {}) =>
  api<T>(path, { ...init, baseUrl: BACKOFFICE_URL, signOutOn401: false });

export type ApprovalsData = ApprovalsInput & {
  /** A section whose list could not be loaded, with the reason to show. */
  errors: Partial<Record<SectionKey, string>>;
};

function reason(e: unknown): string {
  if (e instanceof ApiError) {
    if (e.status === 401 || e.status === 403) return "Office did not let this account load it.";
    return e.message;
  }
  return e instanceof Error ? e.message : "Could not load.";
}

/** Everything waiting on this person, each list loaded on its own so one failure never hides the rest. */
export async function fetchApprovals(me: { id: string; role: string }): Promise<ApprovalsData> {
  const today = todayMyt();
  const weeks = ptWeeks(today);
  const [ptRes, otRes, leaveRes, swapRes] = await Promise.allSettled([
    Promise.all(
      weeks.map((w) => office<PtHoursResponse>(`/api/hr/payroll/weekly/pt-hours?week_start=${w}`)),
    ),
    office<{ requests: OtRequest[] }>("/api/hr/overtime-requests?status=pending"),
    Promise.all([
      office<{ requests: LeaveRequest[] }>("/api/hr/leave?status=pending"),
      office<{ requests: LeaveRequest[] }>("/api/hr/leave?status=ai_escalated"),
    ]),
    office<{ requests: SwapRequest[] }>("/api/hr/shift-swaps?status=pending_approval"),
  ]);

  const errors: ApprovalsData["errors"] = {};
  if (ptRes.status === "rejected") errors.pt = reason(ptRes.reason);
  if (otRes.status === "rejected") errors.ot = reason(otRes.reason);
  if (leaveRes.status === "rejected") errors.leave = reason(leaveRes.reason);
  if (swapRes.status === "rejected") errors.swap = reason(swapRes.reason);

  return {
    pt: ptRes.status === "fulfilled" ? ptShiftsToSignOff(ptRes.value) : [],
    ot: otRes.status === "fulfilled" ? otToApprove(otRes.value.requests, me, today) : [],
    leave: leaveRes.status === "fulfilled" ? leaveToDecide(...leaveRes.value.map((r) => r.requests)) : [],
    swaps: swapRes.status === "fulfilled" ? swapsToApprove(swapRes.value.requests) : [],
    errors,
  };
}

/* ---------- Actions: one call each, the body Office sends ----------------- */

/** Sign off part-timer shifts for weekly pay (Office's Confirm / Confirm all clean). */
export function confirmPtShifts(logIds: string[]) {
  return office<{ confirmed: number; skipped: number }>("/api/hr/payroll/weekly/pt-hours", {
    method: "POST",
    body: JSON.stringify({ action: "confirm", log_ids: logIds }),
  });
}

/**
 * Approve the full requested hours. No hours are sent: the back office then
 * approves exactly hours_requested, as Office's Approve does. Partial hours
 * stay in Office.
 */
export function approveOvertime(id: string) {
  return office<{ payrollSynced?: boolean | null; syncAction?: string | null }>("/api/hr/overtime-requests", {
    method: "PATCH",
    body: JSON.stringify({ id, status: "approved" }),
  });
}

export function rejectOvertime(id: string, rejectionReason: string) {
  return office<{ payrollSynced?: boolean | null }>("/api/hr/overtime-requests", {
    method: "PATCH",
    body: JSON.stringify({ id, status: "rejected", rejection_reason: rejectionReason }),
  });
}

/** Approve leave. Never sends allow_negative_balance: an overdraw is decided in Office. */
export function approveLeave(id: string) {
  return office<{ success: boolean }>("/api/hr/leave", {
    method: "PATCH",
    body: JSON.stringify({ id, action: "approve" }),
  });
}

export function rejectLeave(id: string, rejectionReason: string) {
  return office<{ success: boolean }>("/api/hr/leave", {
    method: "PATCH",
    body: JSON.stringify({ id, action: "reject", reason: rejectionReason }),
  });
}

export function approveSwap(id: string) {
  return office<{ swap: unknown }>("/api/hr/shift-swaps", {
    method: "PATCH",
    body: JSON.stringify({ swap_id: id, action: "approve" }),
  });
}

export function rejectSwap(id: string, rejectionReason: string) {
  return office<{ swap: unknown }>("/api/hr/shift-swaps", {
    method: "PATCH",
    body: JSON.stringify({ swap_id: id, action: "reject", rejection_reason: rejectionReason }),
  });
}

/** Office page URL, for "Open in Office". */
export function officeUrl(path: string): string {
  return `${BACKOFFICE_URL}${path}`;
}
