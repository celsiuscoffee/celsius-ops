import { describe, it, expect } from "vitest";
import { computeProrate, prorateAmount } from "./prorate";

// Real July 2026 payroll figures — these are the numbers that shipped, so a
// change in behaviour here changes what someone is actually paid.
describe("computeProrate — joiners", () => {
  it("prorates a mid-month joiner on calendar days", () => {
    // Muhammad Akmal Aiman Amir, joined 2026-07-06, basic RM2,300.
    const p = computeProrate({
      cycleStart: "2026-07-01",
      cycleEnd: "2026-07-31",
      joinDate: "2026-07-06",
      fullSalary: 2300,
      basis: "calendar",
    });
    expect(p.reason).toBe("joiner");
    expect(p.daysWorked).toBe(26); // 6th..31st inclusive
    expect(p.daysTotal).toBe(31);
    expect(prorateAmount(2300, p)).toBeCloseTo(1929.03, 2);
  });

  it("does NOT prorate someone who joined on day 1", () => {
    const p = computeProrate({
      cycleStart: "2026-07-01",
      cycleEnd: "2026-07-31",
      joinDate: "2026-07-01",
      fullSalary: 2000,
      basis: "calendar",
    });
    expect(p.reason).toBeNull();
    expect(p.factor).toBe(1);
  });

  it("does NOT prorate someone who joined in an earlier cycle", () => {
    const p = computeProrate({
      cycleStart: "2026-08-01",
      cycleEnd: "2026-08-31",
      joinDate: "2026-07-27",
      fullSalary: 2200,
      basis: "calendar",
    });
    expect(p.reason).toBeNull();
    expect(prorateAmount(2200, p)).toBe(2200);
  });
});

describe("allowance proration for a partial month", () => {
  // Auni Sefhia joined 2026-07-27 — 5 of 31 days. Her basic was correctly
  // prorated to RM354.84, but the RM180 performance allowance was paid IN FULL,
  // so she drew a whole month's incentive pool for five days of work. The pool
  // scores rates (serving time, audit %, checklist completion), not volume, so
  // nothing else in the pipeline scales it down.
  const auni = computeProrate({
    cycleStart: "2026-07-01",
    cycleEnd: "2026-07-31",
    joinDate: "2026-07-27",
    fullSalary: 2200,
    basis: "calendar",
  });

  it("prorates the basic to the shipped figure", () => {
    expect(auni.reason).toBe("joiner");
    expect(auni.daysWorked).toBe(5);
    expect(prorateAmount(2200, auni)).toBeCloseTo(354.84, 2);
  });

  it("scales the allowance by the same factor", () => {
    // Was 180.00 unprorated → gross 534.84. Now 29.03 → gross 383.87.
    expect(prorateAmount(180, auni)).toBeCloseTo(29.03, 2);
  });
});

describe("computeProrate — resigners and unpaid leave", () => {
  it("prorates a mid-month resigner", () => {
    const p = computeProrate({
      cycleStart: "2026-07-01",
      cycleEnd: "2026-07-31",
      resignDate: "2026-07-10",
      fullSalary: 3100,
      basis: "calendar",
    });
    expect(p.reason).toBe("resigner");
    expect(p.daysWorked).toBe(10);
  });

  it("does NOT prorate someone whose last day is the final day of the cycle", () => {
    // Afique: end_date 2026-07-31 — he worked the whole month, full pay.
    const p = computeProrate({
      cycleStart: "2026-07-01",
      cycleEnd: "2026-07-31",
      resignDate: "2026-07-31",
      fullSalary: 1900,
      basis: "calendar",
    });
    expect(p.reason).toBeNull();
    expect(prorateAmount(1900, p)).toBe(1900);
  });

  it("uses the intersection when someone joins and resigns in one cycle", () => {
    const p = computeProrate({
      cycleStart: "2026-06-01",
      cycleEnd: "2026-06-30",
      joinDate: "2026-06-10",
      resignDate: "2026-06-10",
      fullSalary: 2100,
      basis: "calendar",
    });
    expect(p.reason).toBe("joiner_and_resigner");
    expect(p.daysWorked).toBe(1);
  });

  it("reports unpaid leave separately from joiner/resigner proration", () => {
    const p = computeProrate({
      cycleStart: "2026-07-01",
      cycleEnd: "2026-07-31",
      unpaidLeaveDays: 3,
      fullSalary: 2000,
      basis: "calendar",
    });
    // Allowances must NOT be prorated on this reason — the allowance engine
    // already nets absence deductions off the pool.
    expect(p.reason).toBe("unpaid_leave");
    expect(p.daysWorked).toBe(28);
  });
});
