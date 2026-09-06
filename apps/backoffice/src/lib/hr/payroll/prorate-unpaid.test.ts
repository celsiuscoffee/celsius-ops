import { describe, it, expect } from "vitest";
import { computeProrate, prorateAmount } from "./prorate";

// Unpaid leave must be counted on the SAME basis as the denominator. The old
// code subtracted calendar days from a weekday denominator — Syafiq Kaberi,
// August 2026, basic RM3,500, working_5day, unpaid 21–24 Aug (Fri–Mon).
describe("computeProrate — unpaid leave on a working-day basis", () => {
  it("Fri–Mon unpaid on Mon–Fri basis is 2 days, not 4 (Syafiq, Aug 2026)", () => {
    const p = computeProrate({
      cycleStart: "2026-08-01",
      cycleEnd: "2026-08-31",
      unpaidLeaveDays: 4,
      unpaidLeaveRanges: [{ start: "2026-08-21", end: "2026-08-24" }],
      fullSalary: 3500,
      basis: "working_5day",
    });
    expect(p.reason).toBe("unpaid_leave");
    expect(p.daysTotal).toBe(21);
    expect(p.daysWorked).toBe(19);
    expect(prorateAmount(3500, p)).toBeCloseTo(3166.67, 2); // was 2,833.33
  });

  it("calendar basis still counts every day of the range", () => {
    const p = computeProrate({
      cycleStart: "2026-08-01",
      cycleEnd: "2026-08-31",
      unpaidLeaveRanges: [{ start: "2026-08-21", end: "2026-08-24" }],
      fullSalary: 3100,
      basis: "calendar",
    });
    expect(p.daysWorked).toBe(27);
    expect(prorateAmount(3100, p)).toBeCloseTo(2700, 2);
  });

  it("a range bridging month-end is clipped to this cycle", () => {
    const p = computeProrate({
      cycleStart: "2026-08-01",
      cycleEnd: "2026-08-31",
      unpaidLeaveRanges: [{ start: "2026-08-28", end: "2026-09-03" }],
      fullSalary: 3100,
      basis: "calendar",
    });
    expect(p.daysWorked).toBe(27); // 28,29,30,31 → 4 days
  });

  it("without ranges the calendar-day count is used as before", () => {
    const p = computeProrate({
      cycleStart: "2026-08-01",
      cycleEnd: "2026-08-31",
      unpaidLeaveDays: 4,
      fullSalary: 3500,
      basis: "working_5day",
    });
    expect(p.daysWorked).toBe(17);
  });
});
