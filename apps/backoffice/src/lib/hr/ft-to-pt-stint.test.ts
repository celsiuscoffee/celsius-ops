import { describe, it, expect } from "vitest";
import { computeProrate, prorateAmount } from "./payroll/prorate";

// FT→PT converters fell out of monthly payroll entirely.
//
// employment_type is a single CURRENT value with no date range. When someone
// moves from a monthly salary to hourly, the conversion overwrites the profile
// — employment_type becomes part_time and basic_salary goes to 0 — and the
// monthly run, which selects on employment_type = 'full_time', stops seeing
// them. Including for the days they were still salaried.
//
// July 2026: Zarif (salaried to 07-07) and Danish (salaried to 07-11) were both
// absent from the run and owed money nothing would ever have paid.
//
// hr_salary_history survives the conversion, so the stint is recoverable: a
// `monthly` row that ENDS inside the cycle, followed by an `hourly` one. The fix
// feeds that end date to computeProrate as a resignation, which already knows
// how to prorate a part-month.

const JULY = { cycleStart: "2026-07-01", cycleEnd: "2026-07-31" };

const stintPay = (salary: number, lastSalariedDay: string) => {
  const prorate = computeProrate({
    ...JULY,
    joinDate: null,
    resignDate: lastSalariedDay,
    unpaidLeaveDays: 0,
    fullSalary: salary,
    basis: "calendar",
  });
  return { prorate, pay: prorateAmount(salary, prorate) };
};

describe("the two July converters", () => {
  it("pays Zarif RM451.61 for 1-7 July", () => {
    // The figure his own profile note specified: RM2,000 x 7/31.
    const { prorate, pay } = stintPay(2000, "2026-07-07");
    expect(prorate.daysWorked).toBe(7);
    expect(prorate.daysTotal).toBe(31);
    expect(pay).toBeCloseTo(451.61, 2);
  });

  it("pays Danish RM674.19 for 1-11 July", () => {
    // RM1,900 x 11/31. His salary was recorded as RM0.00 and had to be
    // recovered from the Apr/May/Jun runs, which all paid 1900.
    const { prorate, pay } = stintPay(1900, "2026-07-11");
    expect(prorate.daysWorked).toBe(11);
    expect(pay).toBeCloseTo(674.19, 2);
  });

  it("does NOT pay either of them a whole month", () => {
    expect(stintPay(2000, "2026-07-07").pay).toBeLessThan(2000);
    expect(stintPay(1900, "2026-07-11").pay).toBeLessThan(1900);
  });
});

describe("the stint boundary", () => {
  it("pays a full month when the salaried period runs to cycle end", () => {
    // Converting on the 1st of the NEXT month is not a part-month.
    const { pay } = stintPay(2000, "2026-07-31");
    expect(pay).toBe(2000);
  });

  it("pays a single day when they converted on the 1st", () => {
    const { prorate } = stintPay(2000, "2026-07-01");
    expect(prorate.daysWorked).toBe(1);
  });
});

describe("what must NOT be inferred from a conversion", () => {
  // The guard in the calculator: a monthly row with a zero or unreadable
  // amount is skipped rather than paid. Danish's row sat at RM0.00 for months
  // because the conversion backfilled it from a profile whose basic_salary had
  // already been zeroed.
  const usable = (amount: unknown) => {
    const n = Number(amount);
    return Number.isFinite(n) && n > 0;
  };

  it("treats a zero stint as a data gap, not a free month", () => {
    expect(usable(0)).toBe(false);
    expect(usable("0.00")).toBe(false);
  });

  it("treats an unreadable amount as a data gap", () => {
    expect(usable(null)).toBe(false);
    expect(usable("abc")).toBe(false);
  });

  it("accepts a real salary", () => {
    expect(usable("1900.00")).toBe(true);
  });

  it("paying RM0 would have looked settled — which is why it is skipped", () => {
    // If a zero stint were paid, the person appears on the run with a RM0 line
    // and nobody notices. Excluded, they stay visibly missing.
    expect(prorateAmount(0, stintPay(0, "2026-07-11").prorate)).toBe(0);
  });
});
