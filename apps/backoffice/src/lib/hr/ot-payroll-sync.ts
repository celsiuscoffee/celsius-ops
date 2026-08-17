// The missing link between OT approval and pay.
//
// Payroll (lib/hr/agents/payroll-calculator.ts) reads overtime ONLY from
// hr_attendance_logs — a log in the pay month, final_status != 'rejected',
// OT-approved (final_status approved/adjusted OR ai_status approved), and
// overtime_hours >= 1. It never reads hr_overtime_requests. So approving an OT
// request (which only writes hours_approved on the request row) was paying
// nobody. This pushes an approved request onto an attendance log so payroll
// sees it.
//
// Because clock-in adoption is low (~15%), most approved OT has NO attendance
// log for that day — so when none exists we CREATE an OT-only payable log
// (regular_hours 0, clock_in_method 'ot_approval', marked approved). De-duped
// per (user, date) so re-approval updates rather than double-pays, and we never
// stack a synthetic OT log on top of a real clock-in log for the same day.
//
// OT approval NEVER overrides attendance review on a real log. final_status is
// the calculator's payability gate for the WHOLE day, so blindly stamping
// 'approved' here used to (a) resurrect full-day pay on a log attendance
// review had REJECTED, and (b) clobber 'adjusted' — erasing the manager's
// stated hours as the weekly pay basis. Both now preserve the review verdict:
// rejected logs are skipped (surfaced to the route), adjusted logs take the OT
// hours but keep their status.

import { hrSupabaseAdmin } from "@/lib/hr/supabase";

// hr_overtime_requests.ot_type → hr_attendance_logs.overtime_type (the enum
// payroll-calculator switches on). ⚠ rest_day / public_holiday are policy-laden:
// rest_day_1x pays ×1 and ph_2x pays the public-holiday OT rate in the
// calculator — confirm these match Celsius's intended multipliers before relying
// on them for those OT types. The common case (1.5x) is unambiguous.
const OT_TYPE_MAP: Record<string, string> = {
  "1x": "ot_1x",
  "1.5x": "ot_1_5x",
  "2x": "ot_2x",
  "3x": "ot_3x",
  rest_day: "rest_day_1x",
  public_holiday: "ph_2x",
};
function mapOtType(t: string | null | undefined): string {
  return OT_TYPE_MAP[t ?? ""] ?? "ot_1_5x";
}

// clock_in is UTC timestamptz; the request.date is an MYT calendar date.
const toMytDate = (iso: string) =>
  new Date(new Date(iso).getTime() + 8 * 3600 * 1000).toISOString().slice(0, 10);

// 09:00 MYT on the request date, as the synthetic log's clock_in (keeps it
// inside the pay month and gives a stable de-dupe key per day).
const syntheticClockIn = (date: string) => `${date}T01:00:00.000Z`;

export interface ApprovedOtRequest {
  id: string;
  user_id: string;
  outlet_id?: string | null;
  date: string; // YYYY-MM-DD (MYT)
  ot_type?: string | null;
  hours_approved?: number | null;
  attendance_log_id?: string | null;
}

export type OtSyncAction =
  | "updated_log"
  | "updated_ot_log"
  | "created_ot_log"
  | "skipped_zero"
  | "skipped_rejected_log";

/**
 * What an OT approval may write onto a REAL attendance log, given the log's
 * current review verdict. Pure — pinned by ot-payroll-sync.test.ts.
 *
 * - rejected  → nothing. Attendance review killed the day; approving OT on top
 *               would resurrect the ENTIRE day's pay (regular hours included).
 *               The manager must clear the rejection first.
 * - adjusted  → OT fields only, status preserved. 'adjusted' means a human
 *               stated the hours and the weekly calculator pays those stated
 *               hours verbatim; overwriting to 'approved' would silently revert
 *               to window math.
 * - anything else (null / pending / approved) → OT fields + final_status
 *               'approved', the original behavior: the OT approval is a human
 *               sign-off that the day should pay.
 */
export function decideRealLogPatch(
  currentFinalStatus: string | null | undefined,
): { apply: false } | { apply: true; setFinalStatus: string | null } {
  if (currentFinalStatus === "rejected") return { apply: false };
  if (currentFinalStatus === "adjusted") return { apply: true, setFinalStatus: null };
  return { apply: true, setFinalStatus: "approved" };
}

// Push an approved/partial OT request onto an attendance log payroll will pay.
// Idempotent per (user, date). Returns the action taken. Never throws to the
// caller's happy path — the OT route wraps this and surfaces payroll_synced.
export async function applyApprovedOt(req: ApprovedOtRequest): Promise<OtSyncAction> {
  // OT pays to the half-hour as approved (owner 2026-08-04); payroll no longer
  // floors, so the synced value carries the fraction. Sub-hour approvals are
  // still skipped — payroll's ≥1h minimum would never pay them.
  const hours = Math.round((Number(req.hours_approved) || 0) * 100) / 100;
  if (hours < 1) return "skipped_zero";
  const otType = mapOtType(req.ot_type);

  // 1. Find the attendance log for that day: explicit link, else any log whose
  //    MYT clock-in date matches. Updating the real log (not creating a second
  //    one) is what prevents double-counting when a clock-in DOES exist.
  let targetId = req.attendance_log_id ?? null;
  if (!targetId) {
    const lo = new Date(`${req.date}T00:00:00Z`);
    lo.setUTCDate(lo.getUTCDate() - 1);
    const hi = new Date(`${req.date}T00:00:00Z`);
    hi.setUTCDate(hi.getUTCDate() + 2);
    const { data: logs } = await hrSupabaseAdmin
      .from("hr_attendance_logs")
      .select("id, clock_in")
      .eq("user_id", req.user_id)
      .gte("clock_in", lo.toISOString())
      .lt("clock_in", hi.toISOString());
    const match = (logs || []).find((l) => l.clock_in && toMytDate(l.clock_in as string) === req.date);
    if (match) targetId = match.id as string;
  }

  if (targetId) {
    // Honour the manager's approved hours on the existing log — but only as far
    // as the log's own review verdict allows (see decideRealLogPatch).
    const { data: log } = await hrSupabaseAdmin
      .from("hr_attendance_logs")
      .select("final_status")
      .eq("id", targetId)
      .maybeSingle();
    const verdict = decideRealLogPatch(log?.final_status as string | null | undefined);
    if (!verdict.apply) return "skipped_rejected_log";
    await hrSupabaseAdmin
      .from("hr_attendance_logs")
      .update({
        overtime_hours: hours,
        overtime_type: otType,
        // Stamped so a later rejection/cancellation of THIS request can retract
        // exactly the OT it pushed (see reverseApprovedOt).
        ot_approval_id: req.id,
        ...(verdict.setFinalStatus ? { final_status: verdict.setFinalStatus } : {}),
      })
      .eq("id", targetId);
    return "updated_log";
  }

  // 2. No log that day → create an OT-only payable log. De-dupe on the synthetic
  //    clock_in so re-approving the same day updates instead of inserting.
  const clockIn = syntheticClockIn(req.date);
  const { data: existing } = await hrSupabaseAdmin
    .from("hr_attendance_logs")
    .select("id")
    .eq("user_id", req.user_id)
    .eq("clock_in_method", "ot_approval")
    .eq("clock_in", clockIn)
    .maybeSingle();
  if (existing?.id) {
    await hrSupabaseAdmin
      .from("hr_attendance_logs")
      .update({ overtime_hours: hours, overtime_type: otType, ot_approval_id: req.id, final_status: "approved" })
      .eq("id", existing.id as string);
    return "updated_ot_log";
  }
  // clock_out MUST be set: the unique index hr_attendance_logs_one_open_per_user
  // allows one open (NULL clock_out) log per user, so a second synthetic
  // approval for the same person used to throw 23505 here. Pay reads the
  // regular_hours/overtime_hours columns, not the clock span, so a span equal
  // to the approved hours is presentation only.
  const clockOut = new Date(Date.parse(clockIn) + hours * 3600 * 1000).toISOString();
  await hrSupabaseAdmin.from("hr_attendance_logs").insert({
    user_id: req.user_id,
    outlet_id: req.outlet_id ?? null,
    clock_in: clockIn,
    clock_out: clockOut,
    regular_hours: 0,
    overtime_hours: hours,
    overtime_type: otType,
    ai_status: "approved",
    final_status: "approved",
    clock_in_method: "ot_approval",
    clock_out_method: "ot_approval",
    ot_approval_id: req.id,
  });
  return "created_ot_log";
}

// Retract OT we previously pushed, when an approval is reversed
// (rejected/cancelled).
//
// Synthetic OT-only logs are killed outright (the whole log exists only
// because of the request). A REAL clock-in log gets its OT fields zeroed —
// matched via the ot_approval_id stamp so we only ever retract OT this
// specific request pushed — but its final_status is left alone: the day's
// payability belongs to attendance review, we only take back the premium.
// (Real logs synced before the ot_approval_id stamp existed carry no marker
// and can't be safely retracted — surfaced by the route as before.)
export async function reverseApprovedOt(req: ApprovedOtRequest): Promise<void> {
  const clockIn = syntheticClockIn(req.date);
  await hrSupabaseAdmin
    .from("hr_attendance_logs")
    .update({ overtime_hours: 0, final_status: "rejected" })
    .eq("user_id", req.user_id)
    .eq("clock_in_method", "ot_approval")
    .eq("clock_in", clockIn);
  await hrSupabaseAdmin
    .from("hr_attendance_logs")
    .update({ overtime_hours: 0, overtime_type: null, ot_approval_id: null })
    .eq("user_id", req.user_id)
    .eq("ot_approval_id", req.id)
    .neq("clock_in_method", "ot_approval");
}
