// Turns clocked overtime into something payroll will actually pay.
//
// Since the paid-window rule (owner 2026-08-13) the hours engine pays only the
// time INSIDE the rostered shift. Whatever is clocked past the rostered end (or
// before the start) is an "OT tail": deriveHours reports it as otEligibleHours,
// the attendance processor flags the log `overtime_detected`, and then it is
// written NOWHERE — hr_attendance_logs.overtime_hours stays 0. The only path
// that pays it is an approved hr_overtime_requests row, which the OT sync
// stamps back onto the log.
//
// The generator that fed that queue (overtime-requests/sync) still selected
// logs by `overtime_hours >= 1`. That was the pre-window signal, and after
// 13 Aug it was ~always 0, so the queue went quiet: 20–44 auto-requests a week
// in July, 7 for the whole second half of August. Managers approved the day on
// the attendance screen — which only set final_status and paid 0 OT — and
// believed the OT was in. Shairuleen had 33 unpaid overstay hours, Firdaus 9.5.
//
// Owner 2026-09-03: "only the OT Ariff approves in attendance will be counted
// as OT on payroll." So the attendance review IS the OT approval: confirming a
// log with a tail writes an APPROVED request and stamps the log right there
// (`approved` mode, from the attendance PATCH). The cron still files PENDING
// requests for tails nobody has looked at (`pending` mode) so they show up in
// the OT queue instead of vanishing.
//
// Pure core (`otRequestCandidates`) is pinned by ot-request-generator.test.ts.

import { hrSupabaseAdmin } from "@/lib/hr/supabase";
import { paidWindowHours, mytDateString, mytInstant } from "@/lib/hr/hours";
import { applyApprovedOt } from "@/lib/hr/ot-payroll-sync";

export type TailLog = {
  id: string;
  user_id: string;
  outlet_id: string | null;
  clock_in: string;
  clock_out: string | null;
  scheduled_start: string | null;
  scheduled_end: string | null;
  scheduled_date: string | null;
  /** Threshold OT inside the window (the pre-window signal). Still counts. */
  overtime_hours: number | string | null;
  overtime_type: string | null;
  clock_in_method: string | null;
  clock_out_method: string | null;
  final_status: string | null;
  ot_approval_id: string | null;
};

export type OtRequestCandidate = {
  user_id: string;
  outlet_id: string | null;
  date: string;
  hours: number;
  ot_type: string;
  reason: string;
  attendance_log_id: string;
};

/** Reason prefix — reporting groups auto-created requests on it; keep stable. */
export const AUTO_REASON_PREFIX = "Auto-created from attendance log (OT detected)";

// The OT queue's minimum: payroll never pays a sub-hour approval
// (payroll-calculator OT_MIN_HOURS), so a request for less would only add
// noise to the manager's queue.
export const MIN_REQUEST_HOURS = 1;

/**
 * hr_attendance_logs.overtime_type → hr_overtime_requests.ot_type. The stamp
 * says what kind of day it was; the request carries the rate class the
 * approval should pay. rest_day_1x is the NORMAL-hours rest-day class — hours
 * beyond the roster on a rest day are 2× (EA s.60(3)), which the old mapping
 * ("1x") under-paid. Holiday classes (ph_2x normal / ot_3x beyond) both mean
 * the tail pays 3×.
 */
export function requestOtType(stamped: string | null | undefined): string {
  switch (stamped) {
    case "ph_2x":
    case "ot_3x":
      return "3x";
    case "ot_2x":
    case "rest_day_1x":
      return "2x";
    case "ot_1x":
      return "1x";
    default:
      return "1.5x";
  }
}

/** Half-hour brackets, matching how deriveHours brackets the tails. */
const toHalfHour = (h: number) => Math.floor((Math.round(h * 100) / 100) * 2) / 2;

/**
 * Clocked OT on one log: the bracketed tail outside the rostered window plus
 * any threshold OT already on the row. 0 for anything that must not become a
 * request — see the skip list in otRequestCandidates.
 */
export function logOtHours(l: TailLog): { tail: number; threshold: number } {
  if (!l.clock_out) return { tail: 0, threshold: 0 };
  const date = mytDateString(l.clock_in);
  const schedDate = l.scheduled_date ?? date;
  const pw = paidWindowHours({
    clockIn: l.clock_in,
    clockOut: l.clock_out,
    scheduledStart: mytInstant(schedDate, l.scheduled_start),
    scheduledEnd: mytInstant(schedDate, l.scheduled_end),
    employmentType: "full_time",
  });
  return {
    tail: pw.unrostered ? 0 : pw.otEligibleHours,
    threshold: Math.max(0, Number(l.overtime_hours) || 0),
  };
}

/**
 * Which logs deserve an OT request, and for how many hours.
 *
 * A log qualifies when it is a real, closed, non-rejected full-timer log that
 * no request already covers, and its clocked OT reaches MIN_REQUEST_HOURS.
 * Split shifts on one day aggregate into one request (the OT table holds one
 * row per person per day).
 *
 * Skipped on purpose:
 *  - part-timers / interns: PT has no OT (owner 2026-08-07), extra PT hours are
 *    handled through the roster.
 *  - system auto-closes: a missed tap-out is not proven overtime.
 *  - synthetic `ot_approval` logs: they ARE an approval already.
 *  - logs with an ot_approval_id: a request already landed on them.
 *  - rejected logs: attendance review killed the day.
 *  - unrostered cover shifts: the whole span already pays as cover.
 */
export function otRequestCandidates(
  logs: TailLog[],
  opts: {
    ftUserIds: Set<string>;
    /** "user_id|YYYY-MM-DD" of (person, day) already covered by a request. */
    existingKeys: Set<string>;
  },
): OtRequestCandidate[] {
  type Acc = { cand: OtRequestCandidate; tail: number; threshold: number };
  const agg = new Map<string, Acc>();

  for (const l of logs) {
    if (!opts.ftUserIds.has(l.user_id)) continue;
    if (!l.clock_out) continue;
    if (l.clock_in_method === "ot_approval") continue;
    if (l.clock_out_method === "system") continue;
    if (l.final_status === "rejected") continue;
    if (l.ot_approval_id) continue;

    const date = mytDateString(l.clock_in);
    const key = `${l.user_id}|${date}`;
    if (opts.existingKeys.has(key)) continue;

    const { tail, threshold } = logOtHours(l);
    if (tail + threshold <= 0) continue;

    const acc = agg.get(key) ?? {
      cand: {
        user_id: l.user_id,
        outlet_id: l.outlet_id ?? null,
        date,
        hours: 0,
        ot_type: requestOtType(l.overtime_type),
        reason: AUTO_REASON_PREFIX,
        attendance_log_id: l.id,
      },
      tail: 0,
      threshold: 0,
    };
    acc.tail += tail;
    acc.threshold += threshold;
    // A holiday / rest-day class on any of the day's logs wins over weekday.
    const cls = requestOtType(l.overtime_type);
    if (cls === "3x" || (cls === "2x" && acc.cand.ot_type !== "3x")) acc.cand.ot_type = cls;
    agg.set(key, acc);
  }

  const out: OtRequestCandidate[] = [];
  for (const { cand, tail, threshold } of agg.values()) {
    const hours = toHalfHour(tail + threshold);
    if (hours < MIN_REQUEST_HOURS) continue;
    const parts: string[] = [];
    if (tail > 0) parts.push(`${toHalfHour(tail)}h clocked outside the rostered window`);
    if (threshold > 0) parts.push(`${threshold}h over the daily threshold`);
    out.push({ ...cand, hours, reason: `${AUTO_REASON_PREFIX} — ${parts.join(", ")}` });
  }
  return out;
}

export const TAIL_LOG_COLUMNS =
  "id, user_id, outlet_id, clock_in, clock_out, scheduled_start, scheduled_end, scheduled_date, overtime_hours, overtime_type, clock_in_method, clock_out_method, final_status, ot_approval_id";

/**
 * The window a sync scans, as UTC ISO bounds on clock_in. The current month,
 * plus the previous month while it is still being paid: payroll for a month
 * closes in the first days of the next, and the August 2026 gap was found on
 * 3 September — a "current month only" scan would have filed nothing for it.
 */
export function syncWindow(now: Date, explicitMonth?: string | null): { start: string; end: string; months: string[] } {
  const MYT = 8 * 3600 * 1000;
  const ym = (y: number, m0: number) => `${y}-${String(m0 + 1).padStart(2, "0")}`;
  // MYT month boundary expressed as a UTC instant (clock_in is UTC).
  const bound = (y: number, m0: number) => new Date(Date.UTC(y, m0, 1) - MYT).toISOString();
  if (explicitMonth && /^\d{4}-\d{2}$/.test(explicitMonth)) {
    const [y, m] = explicitMonth.split("-").map(Number);
    return { start: bound(y, m - 1), end: bound(y, m), months: [explicitMonth] };
  }
  const myt = new Date(now.getTime() + MYT);
  const y = myt.getUTCFullYear();
  const m0 = myt.getUTCMonth();
  const includePrev = myt.getUTCDate() <= 10;
  const first = new Date(Date.UTC(y, includePrev ? m0 - 1 : m0, 1));
  const months = includePrev ? [ym(first.getUTCFullYear(), first.getUTCMonth()), ym(y, m0)] : [ym(y, m0)];
  return { start: bound(first.getUTCFullYear(), first.getUTCMonth()), end: bound(y, m0 + 1), months };
}

export type GenerateResult = {
  /** New rows inserted. */
  created: number;
  /** Existing pending rows approved in place (approved mode only). */
  approved: number;
  /** Total hours put in front of / behind the manager. */
  hours: number;
  candidates: OtRequestCandidate[];
};

/**
 * Scan closed full-timer logs in [start, end) and file a request for every
 * (person, day) with ≥1h of clocked OT that has none.
 *
 *  - `pending`  (cron / manual sync): insert pending post_hoc requests for the
 *               manager to decide in the OT queue. Idempotent on (user, date).
 *  - `approved` (attendance review): the manager has just confirmed the day,
 *               and per the owner that confirmation IS the OT approval. Insert
 *               the request already approved — or approve the pending one that
 *               is sitting there — and stamp the log so payroll pays it. A
 *               request the manager already decided (approved / partial /
 *               rejected / cancelled) is left alone.
 */
export async function generateOtRequests(opts: {
  start: string;
  end: string;
  mode: "pending" | "approved";
  actorUserId: string;
  /** Restrict to these users (single-log hook); omit for everyone. */
  userIds?: string[];
}): Promise<GenerateResult> {
  const empty: GenerateResult = { created: 0, approved: 0, hours: 0, candidates: [] };

  let profQuery = hrSupabaseAdmin
    .from("hr_employee_profiles")
    .select("user_id")
    .eq("employment_type", "full_time");
  if (opts.userIds?.length) profQuery = profQuery.in("user_id", opts.userIds);
  const { data: ftProfiles } = await profQuery;
  const ftUserIds = new Set((ftProfiles || []).map((p) => p.user_id as string));
  if (ftUserIds.size === 0) return empty;

  const { data: logs } = await hrSupabaseAdmin
    .from("hr_attendance_logs")
    .select(TAIL_LOG_COLUMNS)
    .in("user_id", Array.from(ftUserIds))
    .gte("clock_in", opts.start)
    .lt("clock_in", opts.end)
    .not("clock_out", "is", null)
    .limit(5000);
  if (!logs || logs.length === 0) return empty;

  const { data: existing } = await hrSupabaseAdmin
    .from("hr_overtime_requests")
    .select("id, user_id, date, status")
    .in("user_id", Array.from(ftUserIds))
    .gte("date", mytDateString(opts.start))
    .lte("date", mytDateString(opts.end));
  const existingKeys = new Set<string>();
  const pendingByKey = new Map<string, string>();
  for (const r of (existing || []) as Array<{ id: string; user_id: string; date: string; status: string }>) {
    const key = `${r.user_id}|${r.date}`;
    if (opts.mode === "approved" && r.status === "pending") pendingByKey.set(key, r.id);
    else existingKeys.add(key);
  }

  const candidates = otRequestCandidates(logs as unknown as TailLog[], { ftUserIds, existingKeys });
  if (candidates.length === 0) return empty;

  const now = new Date().toISOString();
  if (opts.mode === "pending") {
    const { error } = await hrSupabaseAdmin.from("hr_overtime_requests").insert(
      candidates.map((c) => ({
        user_id: c.user_id,
        outlet_id: c.outlet_id,
        date: c.date,
        request_type: "post_hoc",
        hours_requested: c.hours,
        ot_type: c.ot_type,
        reason: c.reason,
        status: "pending",
        requested_by: opts.actorUserId,
        attendance_log_id: c.attendance_log_id,
      })),
    );
    if (error) throw new Error(error.message);
    return { created: candidates.length, approved: 0, hours: candidates.reduce((s, c) => s + c.hours, 0), candidates };
  }

  type ApprovedRow = {
    id: string;
    user_id: string;
    outlet_id: string | null;
    date: string;
    ot_type: string;
    hours_approved: number;
    attendance_log_id: string | null;
  };
  let created = 0;
  let approved = 0;
  let hours = 0;
  for (const c of candidates) {
    const key = `${c.user_id}|${c.date}`;
    const pendingId = pendingByKey.get(key);
    let row: ApprovedRow | null = null;
    if (pendingId) {
      const { data, error } = await hrSupabaseAdmin
        .from("hr_overtime_requests")
        .update({
          status: "approved",
          hours_approved: c.hours,
          reviewed_by: opts.actorUserId,
          reviewed_at: now,
          updated_at: now,
          manager_notes: "Approved via attendance review",
          attendance_log_id: c.attendance_log_id,
        })
        .eq("id", pendingId)
        .select("id, user_id, outlet_id, date, ot_type, hours_approved, attendance_log_id")
        .single();
      if (error) throw new Error(error.message);
      row = data as ApprovedRow;
      approved++;
    } else {
      const { data, error } = await hrSupabaseAdmin
        .from("hr_overtime_requests")
        .insert({
          user_id: c.user_id,
          outlet_id: c.outlet_id,
          date: c.date,
          request_type: "post_hoc",
          hours_requested: c.hours,
          hours_approved: c.hours,
          ot_type: c.ot_type,
          reason: c.reason,
          status: "approved",
          requested_by: opts.actorUserId,
          reviewed_by: opts.actorUserId,
          reviewed_at: now,
          manager_notes: "Approved via attendance review",
          attendance_log_id: c.attendance_log_id,
        })
        .select("id, user_id, outlet_id, date, ot_type, hours_approved, attendance_log_id")
        .single();
      if (error) throw new Error(error.message);
      row = data as ApprovedRow;
      created++;
    }
    if (row) {
      // Land it on the log so payroll reads it (same path as the OT queue).
      await applyApprovedOt(row);
      hours += c.hours;
    }
  }
  return { created, approved, hours, candidates };
}

/**
 * Attendance-review hook: the manager just confirmed one log. Approve its OT
 * tail (if ≥1h and not already decided) and stamp it. Never throws — the
 * review itself must not fail because the OT write did; returns the hours
 * approved so the UI can say so.
 */
export async function approveOtForReviewedLog(
  log: { user_id: string; clock_in: string },
  actorUserId: string,
): Promise<number> {
  try {
    const dayStart = Date.parse(`${mytDateString(log.clock_in)}T00:00:00+08:00`);
    const r = await generateOtRequests({
      start: new Date(dayStart).toISOString(),
      end: new Date(dayStart + 24 * 3600 * 1000).toISOString(),
      mode: "approved",
      actorUserId,
      userIds: [log.user_id],
    });
    return r.hours;
  } catch (e) {
    console.error("[ot-request-generator] approveOtForReviewedLog failed:", e);
    return 0;
  }
}
