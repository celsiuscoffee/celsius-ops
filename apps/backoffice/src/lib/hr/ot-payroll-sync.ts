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

export type OtSyncAction = "updated_log" | "updated_ot_log" | "created_ot_log" | "skipped_zero";

// Push an approved/partial OT request onto an attendance log payroll will pay.
// Idempotent per (user, date). Returns the action taken. Never throws to the
// caller's happy path — the OT route wraps this and surfaces payroll_synced.
export async function applyApprovedOt(req: ApprovedOtRequest): Promise<OtSyncAction> {
  // Payroll floors OT to whole hours; mirror it so the synced value matches pay.
  const hours = Math.floor(Number(req.hours_approved) || 0);
  if (hours < 1) return "skipped_zero"; // <1h floored OT is never paid anyway
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
    // Honour the manager's approved hours on the existing log + ensure it pays.
    await hrSupabaseAdmin
      .from("hr_attendance_logs")
      .update({ overtime_hours: hours, overtime_type: otType, final_status: "approved" })
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
      .update({ overtime_hours: hours, overtime_type: otType, final_status: "approved" })
      .eq("id", existing.id as string);
    return "updated_ot_log";
  }
  await hrSupabaseAdmin.from("hr_attendance_logs").insert({
    user_id: req.user_id,
    outlet_id: req.outlet_id ?? null,
    clock_in: clockIn,
    clock_out: null,
    regular_hours: 0,
    overtime_hours: hours,
    overtime_type: otType,
    ai_status: "approved",
    final_status: "approved",
    clock_in_method: "ot_approval",
  });
  return "created_ot_log";
}

// Retract OT we previously pushed, when an approval is reversed (rejected/cancelled).
// Only touches the SYNTHETIC OT-only log — a real clock-in log's OT is governed by
// attendance review, so we never silently zero a genuine log here.
export async function reverseApprovedOt(req: ApprovedOtRequest): Promise<void> {
  const clockIn = syntheticClockIn(req.date);
  await hrSupabaseAdmin
    .from("hr_attendance_logs")
    .update({ overtime_hours: 0, final_status: "rejected" })
    .eq("user_id", req.user_id)
    .eq("clock_in_method", "ot_approval")
    .eq("clock_in", clockIn);
}
