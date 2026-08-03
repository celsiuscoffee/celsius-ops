import { describe, it, expect } from "vitest";
import { buildFixedAllowanceBreakdown, parseFixedAllowance } from "./allowances";

const PERIOD = { year: 2026, month: 7, daysElapsed: 31, daysRemaining: 0 };
const build = (amount: number, override?: { reason: string; computedAmount: number | null }) =>
  buildFixedAllowanceBreakdown({
    userId: "u1", employmentType: "full_time", isFullTime: true, amount, period: PERIOD, override,
  });

describe("manual performance override", () => {
  it("pays the overridden amount, not the computed one", () => {
    const b = build(200, { reason: "absence was approved leave", computedAmount: 120 });
    expect(b.totalEarned).toBe(200);
    expect(b.performanceEarned).toBe(200);
  });

  it("clears the deductions — otherwise waiving one still subtracts it", () => {
    // The whole point of overriding to RM200 is that RM200 is what gets paid.
    // If attendance deductions survived, the payslip would show RM200 less RM160.
    const b = build(200, { reason: "waived", computedAmount: 40 });
    expect(b.attendance.total).toBe(0);
    expect(b.attendance.deductions).toEqual([]);
    expect(b.reviewPenalty.total).toBe(0);
    expect(b.totalEarned).toBe(200);
  });

  it("records both figures and the reason on the tip, for the payslip trail", () => {
    const b = build(200, { reason: "absence on 12 Jul was approved leave", computedAmount: 120 });
    expect(b.tip).toContain("RM200.00");
    expect(b.tip).toContain("RM120.00");
    expect(b.tip).toContain("absence on 12 Jul was approved leave");
  });

  it("can override DOWN to zero as well as up", () => {
    const b = build(0, { reason: "no longer eligible this month", computedAmount: 150 });
    expect(b.totalEarned).toBe(0);
    expect(b.eligible).toBe(true); // eligible, just earning nothing
  });

  it("marks every lever not-applicable so the UI can't imply it was scored", () => {
    const b = build(200, { reason: "manual", computedAmount: 0 });
    for (const lever of b.levers) {
      expect(lever.applicable).toBe(false);
      expect(lever.detail).toContain("manually overridden");
    }
  });

  it("reads differently from a flat all-months allowance", () => {
    const flat = build(100);
    const overridden = build(100, { reason: "one-off", computedAmount: 40 });
    expect(flat.tip).toContain("Fixed allowance");
    expect(flat.levers[0].detail).toContain("fixed allowance");
    expect(overridden.tip).toContain("Manually set");
    expect(overridden.levers[0].detail).toContain("manually overridden");
  });

  it("handles a missing computed figure without printing 'undefined'", () => {
    const b = build(200, { reason: "backfilled", computedAmount: null });
    expect(b.tip).toContain("RM200.00");
    expect(b.tip).not.toContain("undefined");
    expect(b.tip).not.toContain("NaN");
  });
});

describe("override amount parsing (shared with the flat path)", () => {
  it("accepts zero — 'pay nothing' is a real decision", () => {
    expect(parseFixedAllowance(0)).toBe(0);
    expect(parseFixedAllowance("0")).toBe(0);
  });

  it("accepts the numeric strings Postgres returns", () => {
    expect(parseFixedAllowance("200.00")).toBe(200);
  });

  it("rejects negatives and junk, so a bad row falls back to scoring", () => {
    expect(parseFixedAllowance(-1)).toBeNull();
    expect(parseFixedAllowance("abc")).toBeNull();
    expect(parseFixedAllowance(null)).toBeNull();
  });
});
