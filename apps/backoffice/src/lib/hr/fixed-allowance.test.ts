import { describe, it, expect } from "vitest";
import { parseFixedAllowance, buildFixedAllowanceBreakdown } from "./allowances";

const PERIOD = { year: 2026, month: 8, daysElapsed: 31, daysRemaining: 0 };
const build = (amount: number) =>
  buildFixedAllowanceBreakdown({
    userId: "ariff", employmentType: "full_time", isFullTime: true, amount, period: PERIOD,
  });

describe("parseFixedAllowance — who is on a flat allowance", () => {
  it("treats NULL / undefined / blank as 'score me normally'", () => {
    expect(parseFixedAllowance(null)).toBeNull();
    expect(parseFixedAllowance(undefined)).toBeNull();
    expect(parseFixedAllowance("")).toBeNull();
  });

  it("accepts a number or a numeric string (Postgres numeric arrives as text)", () => {
    expect(parseFixedAllowance(100)).toBe(100);
    expect(parseFixedAllowance("100")).toBe(100);
    expect(parseFixedAllowance("100.00")).toBe(100);
  });

  it("accepts an explicit zero — 'flat, and the flat amount is nothing'", () => {
    // Distinct from NULL: zero means deliberately no allowance, not 'score me'.
    expect(parseFixedAllowance(0)).toBe(0);
    expect(parseFixedAllowance("0")).toBe(0);
  });

  it("falls back to scoring on junk rather than paying something arbitrary", () => {
    expect(parseFixedAllowance("abc")).toBeNull();
    expect(parseFixedAllowance(-50)).toBeNull();
    expect(parseFixedAllowance(NaN)).toBeNull();
  });
});

describe("buildFixedAllowanceBreakdown — Ariff's RM100", () => {
  it("pays the full amount", () => {
    const b = build(100);
    expect(b.totalEarned).toBe(100);
    expect(b.performanceEarned).toBe(100);
    expect(b.pool).toBe(100);
    expect(b.totalMax).toBe(100);
  });

  it("is eligible even though the lever engine would have gated him out", () => {
    // Head of Department: schedule_required is false, so the scored path forces
    // RM0. The flat path must bypass that gate — that is the whole point.
    expect(build(100).eligible).toBe(true);
  });

  it("applies no attendance or review deductions", () => {
    const b = build(100);
    expect(b.attendance.total).toBe(0);
    expect(b.attendance.deductions).toEqual([]);
    expect(b.attendance.lateCount).toBe(0);
    expect(b.attendance.absentCount).toBe(0);
    expect(b.reviewPenalty.total).toBe(0);
    expect(b.reviewPenalty.entries).toEqual([]);
  });

  it("marks every lever not-applicable and earning nothing", () => {
    const b = build(100);
    expect(b.levers).toHaveLength(4);
    for (const lever of b.levers) {
      expect(lever.applicable).toBe(false);
      expect(lever.earned).toBe(0);
      expect(lever.slice).toBe(0);
      expect(lever.detail).toContain("fixed allowance");
    }
    // The levers must not sum to the payout — the amount is flat, not scored.
    expect(b.levers.reduce((s, l) => s + l.earned, 0)).toBe(0);
    expect(b.totalEarned).toBe(100);
  });

  it("says on the payslip why it wasn't scored", () => {
    expect(build(100).tip).toBe(
      "Fixed allowance of RM100.00 — not scored against the performance levers.",
    );
  });

  it("handles a zero flat allowance without claiming a pool", () => {
    const b = build(0);
    expect(b.totalEarned).toBe(0);
    expect(b.totalMax).toBe(0);
  });
});
