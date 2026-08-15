import { describe, it, expect } from "vitest";
import { clipLeaveDaysToCycle } from "./leave-overlap";

// Cross-month unpaid leave was deducted in NEITHER month: the calculator's
// containment query (start >= cycleStart AND end < cycleEnd) missed any leave
// bridging month-end, so full salary was paid across it. The query is now an
// overlap; this helper clips each request to the days inside one cycle.
//
// The live shape when this was found: approved unpaid leave 2026-10-31 →
// 2026-11-07 — 1 day belongs to October's run, 7 to November's.

const OCT = { start: "2026-10-01", endExclusive: "2026-11-01" };
const NOV = { start: "2026-11-01", endExclusive: "2026-12-01" };

describe("clipLeaveDaysToCycle", () => {
  it("splits the real Oct 31 → Nov 7 leave across both months", () => {
    const leave = { start_date: "2026-10-31", end_date: "2026-11-07", total_days: 8 };
    expect(clipLeaveDaysToCycle(leave, OCT.start, OCT.endExclusive)).toBe(1);
    expect(clipLeaveDaysToCycle(leave, NOV.start, NOV.endExclusive)).toBe(7);
  });

  it("a leave fully inside the cycle deducts its full span", () => {
    const leave = { start_date: "2026-10-05", end_date: "2026-10-09", total_days: 5 };
    expect(clipLeaveDaysToCycle(leave, OCT.start, OCT.endExclusive)).toBe(5);
  });

  it("a leave fully outside the cycle deducts nothing", () => {
    const leave = { start_date: "2026-09-20", end_date: "2026-09-25", total_days: 6 };
    expect(clipLeaveDaysToCycle(leave, OCT.start, OCT.endExclusive)).toBe(0);
  });

  it("caps at the request's own total_days (half-day request)", () => {
    const leave = { start_date: "2026-10-12", end_date: "2026-10-12", total_days: 0.5 };
    expect(clipLeaveDaysToCycle(leave, OCT.start, OCT.endExclusive)).toBe(0.5);
  });

  it("single-day leave on the cycle's last day", () => {
    const leave = { start_date: "2026-10-31", end_date: "2026-10-31", total_days: 1 };
    expect(clipLeaveDaysToCycle(leave, OCT.start, OCT.endExclusive)).toBe(1);
    expect(clipLeaveDaysToCycle(leave, NOV.start, NOV.endExclusive)).toBe(0);
  });

  it("December cycle rolls the year for the exclusive bound", () => {
    const leave = { start_date: "2026-12-29", end_date: "2027-01-02", total_days: 5 };
    expect(clipLeaveDaysToCycle(leave, "2026-12-01", "2027-01-01")).toBe(3);
    expect(clipLeaveDaysToCycle(leave, "2027-01-01", "2027-02-01")).toBe(2);
  });

  it("a whole month of unpaid leave clips to the month's own length", () => {
    const leave = { start_date: "2026-09-15", end_date: "2026-11-15", total_days: 62 };
    expect(clipLeaveDaysToCycle(leave, OCT.start, OCT.endExclusive)).toBe(31);
  });
});
