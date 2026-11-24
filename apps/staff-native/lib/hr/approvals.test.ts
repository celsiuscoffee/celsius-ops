import { describe, expect, it } from "vitest";
import {
  addDays,
  approvalSections,
  approvalsCount,
  approvalsSummary,
  canApprove,
  isCleanShift,
  leaveMeta,
  leaveOverBalanceMessage,
  leaveToDecide,
  mondayOf,
  otApprovedMessage,
  otMeta,
  otToApprove,
  ptHoursLine,
  ptShiftMeta,
  ptShiftsToSignOff,
  ptWeeks,
  rangeLabel,
  swapMeta,
  swapsToApprove,
  todayMyt,
  type LeaveRequest,
  type OtRequest,
  type PtLog,
} from "./approvals";

const log = (over: Partial<PtLog>): PtLog => ({
  id: "l1",
  date: "2026-11-18",
  clock_in: "2026-11-18T01:00:00Z", // 9:00 AM MYT
  clock_out: "2026-11-18T09:00:00Z", // 5:00 PM MYT
  rostered_start: "2026-11-18T01:00:00Z",
  rostered_end: "2026-11-18T09:00:00Z",
  worked_hours: 7,
  paid_hours: 7,
  state: "pending",
  ai_flags: [],
  outlet_name: "Shah Alam",
  ...over,
});

describe("who sees Approvals", () => {
  it("is the roles the approval endpoints admit", () => {
    expect(canApprove("OWNER")).toBe(true);
    expect(canApprove("ADMIN")).toBe(true);
    expect(canApprove("MANAGER")).toBe(true);
    expect(canApprove("STAFF")).toBe(false);
    expect(canApprove(undefined)).toBe(false);
  });
});

describe("pay weeks", () => {
  it("starts on Monday", () => {
    expect(mondayOf("2026-11-20")).toBe("2026-11-16"); // Friday
    expect(mondayOf("2026-11-16")).toBe("2026-11-16"); // Monday
    expect(mondayOf("2026-11-22")).toBe("2026-11-16"); // Sunday belongs to the week before
    expect(addDays("2026-12-30", 3)).toBe("2027-01-02");
  });
  it("checks last week and this week", () => {
    expect(ptWeeks("2026-11-20")).toEqual(["2026-11-09", "2026-11-16"]);
  });
  it("reads today in Malaysia time", () => {
    // 20 Nov 4:30 PM UTC is already 21 Nov in Malaysia.
    expect(todayMyt(Date.parse("2026-11-20T16:30:00Z"))).toBe("2026-11-21");
  });
});

describe("part-timer hours", () => {
  it("lists only shifts nobody has signed off, once each, by date then name", () => {
    const weeks = [
      { pts: [{ user_id: "u2", name: "Zara", logs: [log({ id: "a", date: "2026-11-12" }), log({ id: "b", state: "confirmed" })] }] },
      {
        pts: [
          { user_id: "u1", name: "Aina", logs: [log({ id: "c", date: "2026-11-18", state: "flagged" }), log({ id: "d", state: "rejected" })] },
          { user_id: "u2", name: "Zara", logs: [log({ id: "a", date: "2026-11-12" })] },
        ],
      },
      null,
    ];
    const out = ptShiftsToSignOff(weeks);
    expect(out.map((s) => s.id)).toEqual(["a", "c"]);
    expect(out[1].name).toBe("Aina");
  });
  it("calls a pending shift with no flags clean, as Office does", () => {
    expect(isCleanShift(log({}))).toBe(true);
    expect(isCleanShift(log({ ai_flags: ["late_clock_in"] }))).toBe(false);
    expect(isCleanShift(log({ state: "flagged" }))).toBe(false);
  });
  it("shows rostered against clocked, in 12-hour Malaysia time", () => {
    const s = { ...log({ clock_out: "2026-11-18T09:10:00Z" }), user_id: "u1", name: "Aina" };
    expect(ptShiftMeta(s)).toBe("Rostered 9:00 AM – 5:00 PM · Clocked 9:00 AM – 5:10 PM");
    expect(ptShiftMeta({ ...s, rostered_start: null, rostered_end: null })).toBe("Not rostered · Clocked 9:00 AM – 5:10 PM");
  });
  it("says when pay is capped to the roster", () => {
    const s = { ...log({}), user_id: "u1", name: "Aina" };
    expect(ptHoursLine(s)).toBe("7 h worked");
    expect(ptHoursLine({ ...s, worked_hours: 7.5, paid_hours: 7 })).toBe("7 h paid of 7.5 h clocked");
  });
});

describe("overtime", () => {
  const ot = (over: Partial<OtRequest>): OtRequest => ({
    id: "o1",
    user_id: "u1",
    date: "2026-11-19",
    status: "pending",
    hours_requested: 2,
    ot_type: "1.5x",
    staff: { fullName: "Aina Binti Ali", name: "Aina" },
    attendance_logs: [
      { clock_in: "2026-11-19T06:00:00Z", clock_out: "2026-11-19T08:00:00Z" },
      { clock_in: "2026-11-19T01:00:00Z", clock_out: "2026-11-19T05:00:00Z" },
    ],
    ...over,
  });
  it("leaves out a manager's own requests (their manager decides those) and anything not pending", () => {
    const rows = [ot({}), ot({ id: "mine", user_id: "m1" }), ot({ id: "done", status: "approved" })];
    expect(otToApprove(rows, { id: "m1", role: "MANAGER" }, "2026-11-20").map((o) => o.id)).toEqual(["o1"]);
    expect(otToApprove(rows, { id: "m1", role: "OWNER" }, "2026-11-20").map((o) => o.id)).toEqual(["o1", "mine"]);
  });
  it("spans first clock-in to last clock-out and marks future-dated requests", () => {
    const [o] = otToApprove([ot({})], { id: "x", role: "ADMIN" }, "2026-11-20");
    expect(o.name).toBe("Aina Binti Ali");
    expect(otMeta(o)).toBe("Clocked 9:00 AM – 4:00 PM · 2 h at 1.5x");
    expect(o.future).toBe(false);
    const [f] = otToApprove([ot({ date: "2026-11-21", attendance_logs: [] })], { id: "x", role: "ADMIN" }, "2026-11-20");
    expect(f.future).toBe(true);
    expect(otMeta(f)).toBe("No clock-in that day · 2 h at 1.5x");
  });
  it("never looks settled when payroll did not pick the approval up", () => {
    expect(otApprovedMessage("Aina", { payrollSynced: true }).tone).toBe("ok");
    expect(otApprovedMessage("Aina", { payrollSynced: null }).tone).toBe("ok");
    const warn = otApprovedMessage("Aina", { payrollSynced: false });
    expect(warn.tone).toBe("warn");
    expect(warn.text).toContain("payroll did not pick it up");
  });
});

describe("leave", () => {
  const lv = (over: Partial<LeaveRequest>): LeaveRequest => ({
    id: "r1",
    user_id: "u1",
    leave_type: "annual",
    start_date: "2026-11-20",
    end_date: "2026-11-23",
    total_days: 2,
    status: "pending",
    ...over,
  });
  it("merges pending and escalated, once each, soonest first", () => {
    const out = leaveToDecide(
      [lv({ id: "a", start_date: "2026-12-01" }), lv({ id: "x", status: "approved" })],
      [lv({ id: "b", status: "ai_escalated" }), lv({ id: "a", start_date: "2026-12-01" })],
    );
    expect(out.map((r) => r.id)).toEqual(["b", "a"]);
  });
  it("words the type, the days and the range", () => {
    expect(leaveMeta(lv({}))).toBe("Annual leave · Fri, 20 – Mon, 23 Nov · 2 days");
    expect(rangeLabel("2026-11-30", "2026-12-01")).toBe("Mon, 30 Nov – Tue, 1 Dec");
    expect(leaveMeta(lv({ end_date: "2026-11-20", total_days: 1, leave_type: "sick" }))).toBe("Sick leave · Fri, 20 Nov · 1 day");
  });
  it("words an over-balance refusal without the API hint", () => {
    expect(
      leaveOverBalanceMessage(
        "Aina",
        "Approving 3 day(s) overdraws the annual balance by 1 day(s). Pass allow_negative_balance to approve anyway.",
      ),
    ).toBe("Aina's leave was not approved: Approving 3 day(s) overdraws the annual balance by 1 day(s). Open Leave in Office to decide.");
    expect(
      leaveOverBalanceMessage(
        "Aina",
        "No annual balance row exists for 2026 — approving would burn no days. Initialize leave balances first, or pass allow_negative_balance to approve anyway.",
      ),
    ).toBe(
      "Aina's leave was not approved: No annual balance row exists for 2026 — approving would burn no days. Initialize leave balances first. Open Leave in Office to decide.",
    );
  });
});

describe("shift swaps", () => {
  it("only lists swaps both people agreed to", () => {
    const rows = [
      { id: "a", status: "pending_approval" },
      { id: "b", status: "pending_consent" },
    ];
    expect(swapsToApprove(rows).map((r) => r.id)).toEqual(["a"]);
  });
  it("says whose shift goes where", () => {
    expect(
      swapMeta({
        id: "a",
        status: "pending_approval",
        requester_name: "Aina",
        target_name: "Farid",
        requester_shift: { shift_date: "2026-11-21", start_time: "07:00:00", end_time: "15:00:00" },
        target_shift: { shift_date: "2026-11-22", start_time: "15:00:00", end_time: "23:00:00" },
      }),
    ).toBe("Aina's Sat, 21 Nov 7:00 AM – 3:00 PM for Farid's Sun, 22 Nov 3:00 PM – 11:00 PM");
  });
});

describe("sections and the count", () => {
  it("shows only non-empty sections, and the count is their total", () => {
    const input = {
      pt: [{ ...log({}), user_id: "u1", name: "Aina" }, { ...log({ id: "l2" }), user_id: "u1", name: "Aina" }],
      ot: [],
      leave: [],
      swaps: [{ id: "s", status: "pending_approval" }],
    };
    expect(approvalSections(input).map((s) => [s.key, s.count])).toEqual([
      ["pt", 2],
      ["swap", 1],
    ]);
    expect(approvalsCount(input)).toBe(3);
    expect(approvalsSummary(input)).toBe("2 part-timer shifts, 1 shift swap");
    expect(approvalsSummary({ pt: [], ot: [], leave: [], swaps: [] })).toBe("Nothing waiting on you");
  });
});
