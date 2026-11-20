// Manager approvals on the phone (owner, 20 Nov 2026): part-timer hours to
// sign off, overtime, leave and shift swaps, decided during the shift instead
// of waiting for Office. Pure: the Approvals screen, the Me row and the Today
// row all build from these, so every count matches what the screen shows.
//
// The data comes from the SAME back-office endpoints Office uses (see
// approvals-api.ts); nothing here decides who may approve or what approving
// does. It only picks which rows wait on the person and words them.
import { clock12, hm12, sentence } from "../celsius-ui/format";
import { calendarDayParts, mytDate } from "./myt";

/* ---------- Who sees Approvals -------------------------------------------- */

/**
 * The roles every approval endpoint admits (OWNER / ADMIN / MANAGER), the
 * same list the back office checks. UX only: the server re-checks the role
 * from the user row and scopes managers to their own outlets / team.
 */
export function canApprove(role: string | null | undefined): boolean {
  return role === "OWNER" || role === "ADMIN" || role === "MANAGER";
}

/* ---------- What the endpoints return (as far as the phone reads it) ----- */

export type PtLog = {
  id: string;
  date: string;
  clock_in: string;
  clock_out: string | null;
  rostered_start?: string | null;
  rostered_end?: string | null;
  worked_hours: number;
  paid_hours: number;
  capped?: boolean;
  unrostered?: boolean;
  state: "pending" | "flagged" | "confirmed" | "rejected" | (string & {});
  ai_flags?: string[] | null;
  outlet_name?: string | null;
};
export type PtPerson = { user_id: string; name: string; logs: PtLog[] };
export type PtHoursResponse = { pts: PtPerson[]; week_start?: string; week_end?: string };

export type OtAttendance = { clock_in: string; clock_out: string | null };
export type OtRequest = {
  id: string;
  user_id: string;
  date: string;
  status: string;
  hours_requested: number | string | null;
  ot_type?: string | null;
  reason?: string | null;
  staff?: { name?: string | null; fullName?: string | null } | null;
  attendance_logs?: OtAttendance[] | null;
};

export type LeaveRequest = {
  id: string;
  user_id: string;
  leave_type: string;
  start_date: string;
  end_date: string;
  total_days: number | string;
  reason?: string | null;
  status: string;
  user_name?: string | null;
  outlet_name?: string | null;
  created_at?: string;
};

export type SwapShift = { shift_date: string; start_time: string; end_time: string } | null;
export type SwapRequest = {
  id: string;
  status: string;
  requester_name?: string | null;
  target_name?: string | null;
  requester_shift?: SwapShift;
  target_shift?: SwapShift;
  reason?: string | null;
};

/* ---------- Dates ---------------------------------------------------------- */

/** YYYY-MM-DD plus n days (a calendar date, no time zone involved). */
export function addDays(ymd: string, n: number): string {
  const [y, m, d] = ymd.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10);
}

/** The Monday of the week holding this calendar date (pay weeks start Monday). */
export function mondayOf(ymd: string): string {
  const [y, m, d] = ymd.split("-").map(Number);
  const day = new Date(Date.UTC(y, m - 1, d)).getUTCDay(); // 0 = Sunday
  return addDays(ymd, day === 0 ? -6 : 1 - day);
}

/** The pay weeks the phone checks for part-timer hours: last week and this week. */
export function ptWeeks(todayMyt: string): string[] {
  const thisWeek = mondayOf(todayMyt);
  return [addDays(thisWeek, -7), thisWeek];
}

/** "Fri, 20 Nov" for a calendar date. */
export function dayLabel(ymd: string): string {
  return calendarDayParts(ymd).label;
}

/** "Fri, 20 Nov" or "Fri, 20 – Mon, 23 Nov" for a leave range. */
export function rangeLabel(start: string, end: string): string {
  if (!end || end === start) return dayLabel(start);
  const a = calendarDayParts(start);
  const b = calendarDayParts(end);
  const left = a.monthName === b.monthName ? `${a.dayName}, ${a.dayNum}` : a.label;
  return `${left} – ${b.label}`;
}

/** "7:40 PM – 11:05 PM", or "7:40 PM – still in" with no clock-out. */
export function spanLabel(from: string | null | undefined, to: string | null | undefined): string {
  if (!from) return "-";
  return `${clock12(from)} – ${to ? clock12(to) : "still in"}`;
}

/** "7.5 h", "1 h". Hours are paid in half-hour steps; never more decimals than 2. */
export function hoursLabel(n: number | string | null | undefined): string {
  const v = Math.round((Number(n) || 0) * 100) / 100;
  return `${v} h`;
}

/** "1 day", "2.5 days". */
export function daysLabel(n: number | string | null | undefined): string {
  const v = Number(n) || 0;
  return `${v} ${v === 1 ? "day" : "days"}`;
}

/* ---------- Part-timer hours ---------------------------------------------- */

export type PtShift = PtLog & { user_id: string; name: string };

/**
 * Every shift still waiting on a person's sign-off (pending or flagged) across
 * the weeks fetched. A shift already confirmed, or rejected, waits on nobody.
 * Sorted by date, then name, so the list does not reshuffle as rows clear.
 */
export function ptShiftsToSignOff(weeks: (PtHoursResponse | null | undefined)[]): PtShift[] {
  const seen = new Set<string>();
  const out: PtShift[] = [];
  for (const w of weeks) {
    for (const p of w?.pts ?? []) {
      for (const l of p.logs ?? []) {
        if (l.state !== "pending" && l.state !== "flagged") continue;
        if (seen.has(l.id)) continue;
        seen.add(l.id);
        out.push({ ...l, user_id: p.user_id, name: p.name });
      }
    }
  }
  return out.sort((a, b) => a.date.localeCompare(b.date) || a.name.localeCompare(b.name) || a.clock_in.localeCompare(b.clock_in));
}

/** Office's "clean": pending with no AI flags, safe to confirm together. */
export function isCleanShift(s: PtLog): boolean {
  return s.state === "pending" && (s.ai_flags ?? []).length === 0;
}

/** "Rostered 9:00 AM – 5:00 PM · Clocked 8:55 AM – 5:10 PM" */
export function ptShiftMeta(s: PtShift): string {
  const rostered =
    s.rostered_start && s.rostered_end ? `Rostered ${spanLabel(s.rostered_start, s.rostered_end)}` : "Not rostered";
  return `${rostered} · Clocked ${spanLabel(s.clock_in, s.clock_out)}`;
}

/** "7.5 h paid" or "7 h paid of 7.5 h clocked" when pay is capped to the roster. */
export function ptHoursLine(s: PtShift): string {
  if (Number(s.paid_hours) < Number(s.worked_hours)) {
    return `${hoursLabel(s.paid_hours)} paid of ${hoursLabel(s.worked_hours)} clocked`;
  }
  return `${hoursLabel(s.worked_hours)} worked`;
}

/** "Late clock-in, Outside geofence" from raw AI flags. */
export function flagsLabel(flags: string[] | null | undefined): string {
  return (flags ?? []).map((f) => sentence(f)).filter(Boolean).join(", ");
}

/* ---------- Overtime ------------------------------------------------------- */

export type OtItem = OtRequest & {
  name: string;
  /** First clock-in to last clock-out that day, if the person clocked. */
  clockIn: string | null;
  clockOut: string | null;
  /** Dated after today: the server only lets it be approved on or after the day. */
  future: boolean;
};

/**
 * Pending OT the person can decide. The back office lists a manager's own
 * requests too (their team plus themselves), but only lets them decide their
 * team's; their own wait for their manager, so they are left out here.
 */
export function otToApprove(
  rows: OtRequest[] | null | undefined,
  me: { id: string; role: string },
  todayMyt: string,
): OtItem[] {
  return (rows ?? [])
    .filter((r) => r.status === "pending")
    .filter((r) => !(me.role === "MANAGER" && r.user_id === me.id))
    .map((r) => {
      const logs = [...(r.attendance_logs ?? [])].sort((a, b) => a.clock_in.localeCompare(b.clock_in));
      const outs = logs.map((l) => l.clock_out).filter((x): x is string => !!x).sort();
      return {
        ...r,
        name: r.staff?.fullName || r.staff?.name || "Someone",
        clockIn: logs[0]?.clock_in ?? null,
        clockOut: outs.length ? outs[outs.length - 1] : null,
        future: r.date > todayMyt,
      };
    })
    .sort((a, b) => a.date.localeCompare(b.date) || a.name.localeCompare(b.name));
}

/** "Clocked 9:00 AM – 7:30 PM · 2 h at 1.5x" */
export function otMeta(o: OtItem): string {
  const clocked = o.clockIn ? `Clocked ${spanLabel(o.clockIn, o.clockOut)}` : "No clock-in that day";
  const rate = o.ot_type ? ` at ${o.ot_type}` : "";
  return `${clocked} · ${hoursLabel(o.hours_requested)}${rate}`;
}

/* ---------- Leave ---------------------------------------------------------- */

/** Leave still waiting on a person: pending, or escalated by the leave agent. */
export function leaveToDecide(...lists: (LeaveRequest[] | null | undefined)[]): LeaveRequest[] {
  const seen = new Set<string>();
  const out: LeaveRequest[] = [];
  for (const list of lists) {
    for (const r of list ?? []) {
      if (r.status !== "pending" && r.status !== "ai_escalated") continue;
      if (seen.has(r.id)) continue;
      seen.add(r.id);
      out.push(r);
    }
  }
  return out.sort((a, b) => a.start_date.localeCompare(b.start_date));
}

/** "Annual leave · Fri, 20 – Mon, 23 Nov · 2 days" */
export function leaveMeta(r: LeaveRequest): string {
  const type = sentence(r.leave_type);
  return `${type} leave · ${rangeLabel(r.start_date, r.end_date)} · ${daysLabel(r.total_days)}`;
}

/* ---------- Shift swaps ---------------------------------------------------- */

/**
 * Swaps waiting on a manager: both people agreed (pending_approval). A swap
 * still waiting for the coworker's yes waits on them, not on the manager.
 */
export function swapsToApprove(rows: SwapRequest[] | null | undefined): SwapRequest[] {
  return (rows ?? []).filter((r) => r.status === "pending_approval");
}

const shiftWords = (s: SwapShift) =>
  s ? `${dayLabel(s.shift_date)} ${hm12(s.start_time)} – ${hm12(s.end_time)}` : "a shift";

/** "Aina and Farid" */
export function swapTitle(s: SwapRequest): string {
  return `${s.requester_name || "Someone"} and ${s.target_name || "someone"}`;
}

/** "Aina's Fri, 20 Nov 7:00 AM – 3:00 PM for Farid's Sat, 21 Nov 3:00 PM – 11:00 PM" */
export function swapMeta(s: SwapRequest): string {
  return `${s.requester_name || "Their"}'s ${shiftWords(s.requester_shift ?? null)} for ${
    s.target_name || "the other"
  }'s ${shiftWords(s.target_shift ?? null)}`;
}

/* ---------- Sections and the count ---------------------------------------- */

export type SectionKey = "pt" | "ot" | "leave" | "swap";

export type ApprovalsInput = {
  pt: PtShift[];
  ot: OtItem[];
  leave: LeaveRequest[];
  swaps: SwapRequest[];
};

export const SECTION_TITLES: Record<SectionKey, string> = {
  pt: "Part-timer hours to sign off",
  ot: "Overtime to approve",
  leave: "Leave requests",
  swap: "Shift swaps",
};

/** Office page for anything the phone does not rebuild (editing clock times, partial OT). */
export const OFFICE_PATHS: Record<SectionKey, string> = {
  pt: "/hr/pt-hours",
  ot: "/hr/overtime",
  leave: "/hr/leave",
  swap: "/hr/shift-swaps",
};

/** Only the sections with something in them, in the order the screen shows them. */
export function approvalSections(input: ApprovalsInput): { key: SectionKey; title: string; count: number }[] {
  const counts: Record<SectionKey, number> = {
    pt: input.pt.length,
    ot: input.ot.length,
    leave: input.leave.length,
    swap: input.swaps.length,
  };
  return (Object.keys(counts) as SectionKey[])
    .filter((k) => counts[k] > 0)
    .map((k) => ({ key: k, title: SECTION_TITLES[k], count: counts[k] }));
}

export function approvalsCount(input: ApprovalsInput): number {
  return input.pt.length + input.ot.length + input.leave.length + input.swaps.length;
}

/** One line for the Me and Today rows: "3 part-timer shifts, 1 overtime". */
export function approvalsSummary(input: ApprovalsInput): string {
  const parts: string[] = [];
  const n = (count: number, one: string, many: string) => `${count} ${count === 1 ? one : many}`;
  if (input.pt.length) parts.push(n(input.pt.length, "part-timer shift", "part-timer shifts"));
  if (input.ot.length) parts.push(n(input.ot.length, "overtime", "overtime"));
  if (input.leave.length) parts.push(n(input.leave.length, "leave request", "leave requests"));
  if (input.swaps.length) parts.push(n(input.swaps.length, "shift swap", "shift swaps"));
  return parts.length ? parts.join(", ") : "Nothing waiting on you";
}

/* ---------- Messages after an action -------------------------------------- */

/**
 * What the person reads after approving overtime. The back office settles the
 * request, then lands the hours on the day's attendance for payroll; when that
 * second step did not happen it says so, and the phone must not look settled.
 */
export function otApprovedMessage(name: string, res: { payrollSynced?: boolean | null } | null | undefined): {
  tone: "ok" | "warn";
  text: string;
} {
  if (res?.payrollSynced === false) {
    return {
      tone: "warn",
      text: `Approved ${name}'s overtime, but payroll did not pick it up. Open it in Office to check the day's attendance.`,
    };
  }
  return { tone: "ok", text: `Approved ${name}'s overtime.` };
}

/**
 * The leave endpoint refuses an approval that overdraws the balance (or has
 * no balance row) unless the operator overrides it. The phone never sends the
 * override, so it words the refusal without the API hint and points to Office.
 */
export function leaveOverBalanceMessage(name: string, serverMessage: string): string {
  const core = serverMessage
    .replace(/[,.]?\s*(or\s+)?pass allow_negative_balance.*$/i, "")
    .trim()
    .replace(/[.,]$/, "");
  return `${name}'s leave was not approved: ${core}. Open Leave in Office to decide.`;
}

/** Today's date in Malaysia, for the pay weeks and future-dated OT. */
export function todayMyt(now: number = Date.now()): string {
  return mytDate(now);
}
