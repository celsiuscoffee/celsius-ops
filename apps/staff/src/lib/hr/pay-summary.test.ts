import { describe, expect, it } from "vitest";
import {
  addDays,
  approvedOtHours,
  dayLabel,
  dayMonth,
  hoursWords,
  isManagerConfirmed,
  monthApprovedOt,
  monthBefore,
  mytDate,
  payslipLabel,
  rm,
  runStatus,
  soFarEstimate,
  summarizeWeek,
  waitingOt,
  weekStartOf,
  type PayLog,
} from "./pay-summary";

const log = (over: Partial<PayLog> = {}): PayLog => ({
  clock_in: "2026-11-17T01:00:00Z", // Tue 17 Nov, 9:00 AM MYT
  clock_out: "2026-11-17T09:00:00Z",
  total_hours: 7.5,
  overtime_hours: 0,
  ai_status: "approved",
  final_status: null,
  reviewed_by: null,
  clock_in_method: "selfie",
  ...over,
});

describe("dates", () => {
  it("dates a UTC instant in Malaysia time", () => {
    expect(mytDate("2026-11-16T23:30:00Z")).toBe("2026-11-17"); // 7:30 AM MYT on the 17th
  });
  it("finds the Monday of the week, Sunday included", () => {
    expect(weekStartOf("2026-11-20")).toBe("2026-11-16"); // Friday
    expect(weekStartOf("2026-11-16")).toBe("2026-11-16"); // Monday
    expect(weekStartOf("2026-11-22")).toBe("2026-11-16"); // Sunday belongs to the week before it
  });
  it("adds days across a month end and steps back a month across a year", () => {
    expect(addDays("2026-11-30", 1)).toBe("2026-12-01");
    expect(monthBefore("2026-01")).toBe("2025-12");
    expect(monthBefore("2026-11")).toBe("2026-10");
  });
});

describe("payroll's rules", () => {
  it("approves OT as payroll does: manager wins, AI only while no manager decided", () => {
    expect(approvedOtHours(log({ overtime_hours: 1.5, final_status: "approved" }))).toBe(1.5);
    expect(approvedOtHours(log({ overtime_hours: 1.5, final_status: null, ai_status: "approved" }))).toBe(1.5);
    expect(approvedOtHours(log({ overtime_hours: 1.5, final_status: "rejected", ai_status: "approved" }))).toBe(0);
    expect(approvedOtHours(log({ overtime_hours: 1.5, final_status: null, ai_status: "flagged" }))).toBe(0);
  });
  it("pays nothing below one 30-minute bracket", () => {
    expect(approvedOtHours(log({ overtime_hours: 0.4, final_status: "approved" }))).toBe(0);
    expect(approvedOtHours(log({ overtime_hours: 0.5, final_status: "approved" }))).toBe(0.5);
  });
  it("counts a month's OT including OT-approval rows, in that Malaysian month only", () => {
    const logs = [
      log({ overtime_hours: 2, final_status: "approved" }),
      log({ clock_in_method: "ot_approval", overtime_hours: 1, final_status: "approved" }),
      log({ clock_in: "2026-10-31T17:00:00Z", overtime_hours: 3, final_status: "approved" }), // 1 Nov 1:00 AM MYT
      log({ clock_in: "2026-10-31T15:00:00Z", overtime_hours: 5, final_status: "approved" }), // 31 Oct 11:00 PM MYT
    ];
    expect(monthApprovedOt(logs, "2026-11")).toBe(6);
  });
  it("counts a shift as signed off only when a person did it", () => {
    expect(isManagerConfirmed({ reviewed_by: "mgr", final_status: "approved" })).toBe(true);
    expect(isManagerConfirmed({ reviewed_by: "mgr", final_status: "adjusted" })).toBe(true);
    expect(isManagerConfirmed({ reviewed_by: null, final_status: "approved" })).toBe(false); // AI or auto-close
    expect(isManagerConfirmed({ reviewed_by: "mgr", final_status: null })).toBe(false);
  });
  it("adds pending OT per date in whole brackets", () => {
    expect(waitingOt([
      { date: "2026-11-18", hours_requested: 1.2 },
      { date: "2026-11-17", hours_requested: 0.3 },
      { date: "2026-11-18", hours_requested: "0.5" },
    ])).toEqual([{ date: "2026-11-18", hours: 1.5 }]);
  });
  it("maps run statuses and hides anything else", () => {
    expect(runStatus("draft")).toBe("preparing");
    expect(runStatus("ai_computed")).toBe("preparing");
    expect(runStatus("confirmed")).toBe("confirmed");
    expect(runStatus("paid")).toBe("paid");
    expect(runStatus("void")).toBeNull();
  });
});

describe("summarizeWeek", () => {
  const start = "2026-11-16";
  it("counts real shifts, clocked hours and sign-offs in the week only", () => {
    const logs = [
      log({ reviewed_by: "mgr", final_status: "approved", total_hours: 6 }),
      log({ clock_in: "2026-11-18T01:00:00Z", total_hours: 4.25 }),
      log({ clock_in: "2026-11-19T01:00:00Z", clock_out: null, total_hours: null }), // on shift now
      log({ clock_in: "2026-11-18T01:00:00Z", final_status: "rejected", total_hours: 9 }),
      log({ clock_in: "2026-11-18T01:00:00Z", clock_in_method: "ot_approval", total_hours: 0 }),
      log({ clock_in: "2026-11-15T01:00:00Z", total_hours: 8 }), // last week
    ];
    const w = summarizeWeek(start, logs, [{ date: "2026-11-17", hours: 1 }, { date: "2026-11-10", hours: 3 }], [{ date: "2026-11-18", hours_requested: 1 }]);
    expect(w).toEqual({
      start,
      end: "2026-11-22",
      shifts: 3,
      clockedHours: 10.25,
      signedOff: 1,
      onShift: true,
      otApprovedHours: 1,
      otWaitingHours: 1,
    });
  });
});

describe("words and money", () => {
  it("adds payroll's own components and nothing when basic is unknown", () => {
    expect(soFarEstimate(2000, 150.5, [{ amount: 100 }])).toBe(2250.5);
    expect(soFarEstimate(2000, null, [])).toBe(2000);
    expect(soFarEstimate(null, 100, [])).toBeNull();
  });
  it("formats RM with two decimals and hours plainly", () => {
    expect(rm(1234.5)).toBe("RM 1,234.50");
    expect(rm(0)).toBe("RM 0.00");
    expect(hoursWords(1)).toBe("1 hr");
    expect(hoursWords(2.5)).toBe("2.5 hrs");
  });
  it("labels days and payslips", () => {
    expect(dayMonth("2026-12-03")).toBe("3 Dec");
    expect(dayLabel("2026-12-03")).toBe("Thu 3 Dec");
    expect(payslipLabel({ status: "paid", cycle_type: "monthly", period_month: 10, period_year: 2026, period_start: null, period_end: null })).toEqual({ label: "October 2026", weekly: false });
    expect(payslipLabel({ status: "paid", cycle_type: "weekly", period_month: null, period_year: null, period_start: "2026-11-09", period_end: "2026-11-15" })).toEqual({ label: "Week of 9 Nov", weekly: true });
  });
});
