import { describe, it, expect } from "vitest";
import {
  roundToCents,
  epfBracket,
  epfContribution,
  perkesoAssumedWage,
  socsoContribution,
  eisContribution,
} from "./formulas";

// Rate config mirrors the live hr_stat_* reference rows (verified against the
// DB): EPF cat A 11% / 13% (≤5k) / 12% (>5k); SOCSO 0.5% + 1.75% (cat1), 1.25%
// (cat2), RM100 bands, RM6,000 ceiling; EIS 0.2% + 0.2%, same bands/ceiling.
const EPF_A = { employeeRate: 11, employerRateBelow5000: 13, employerRateAbove5000: 12 };
const SOCSO = {
  wageCeiling: 6000, roundTo: 100,
  cat1EmployeeRate: 0.5, cat1EmployerRate: 1.75, cat2EmployerRate: 1.25,
};
const EIS = { wageCeiling: 6000, roundTo: 100, employeeRate: 0.2, employerRate: 0.2 };

describe("roundToCents (nearest RM0.05)", () => {
  it("rounds half up to 5 sen", () => {
    expect(roundToCents(51.625)).toBe(51.65);
    expect(roundToCents(16.625)).toBe(16.65);
    expect(roundToCents(36.875)).toBe(36.9);
    expect(roundToCents(14.75)).toBe(14.75);
  });
});

describe("epfBracket — RM20 bands ≤ RM5,000, RM100 bands above", () => {
  it("uses RM20 steps up to and including RM5,000", () => {
    expect(epfBracket(3000)).toBe(3000);
    expect(epfBracket(4999)).toBe(5000);
    expect(epfBracket(5000)).toBe(5000);
  });
  it("switches to RM100 steps above RM5,000 (the H7 fix)", () => {
    expect(epfBracket(5001)).toBe(5100);
    expect(epfBracket(5010)).toBe(5100);
    expect(epfBracket(5100)).toBe(5100);
    expect(epfBracket(5101)).toBe(5200);
  });
});

describe("epfContribution (KWSP Third Schedule, category A)", () => {
  it("RM3,000 → employee RM330, employer RM390", () => {
    const r = epfContribution({ wage: 3000, ...EPF_A });
    expect(r.bracket).toBe(3000);
    expect(r.employee).toBe(330);
    expect(r.employer).toBe(390);
  });
  it("RM5,000 boundary still uses the ≤5k employer rate (13%)", () => {
    const r = epfContribution({ wage: 5000, ...EPF_A });
    expect(r.employee).toBe(550);   // ceil(5000 × 11%)
    expect(r.employer).toBe(650);   // ceil(5000 × 13%)
  });
  it("RM5,010 → RM100 band + above-5k employer rate: employee RM561, employer RM612 (was RM553 before the fix)", () => {
    const r = epfContribution({ wage: 5010, ...EPF_A });
    expect(r.bracket).toBe(5100);
    expect(r.employee).toBe(561);   // ceil(5100 × 11%)
    expect(r.employer).toBe(612);   // ceil(5100 × 12%)
  });
  it("honours voluntary rate overrides", () => {
    const r = epfContribution({ wage: 3000, ...EPF_A, employeeRateOverride: 9 });
    expect(r.employee).toBe(270);   // ceil(3000 × 9%)
    expect(r.employer).toBe(390);   // employer unchanged
  });
  it("is nil for trivially small wages", () => {
    expect(epfContribution({ wage: 10, ...EPF_A })).toEqual({ employee: 0, employer: 0, bracket: 0 });
  });
});

describe("perkesoAssumedWage — band midpoint, not ceiling", () => {
  it("returns ceiling − half a band", () => {
    expect(perkesoAssumedWage(2950, 100)).toBe(2950); // band 2900.01–3000 → 2950
    expect(perkesoAssumedWage(3000, 100)).toBe(2950); // same band
    expect(perkesoAssumedWage(1000, 100)).toBe(950);
    expect(perkesoAssumedWage(6000, 100)).toBe(5950); // top band
  });
});

describe("socsoContribution (PERKESO published schedule)", () => {
  it("Category 1, RM2,950 → employee RM14.75, employer RM51.65 (was RM15.00 on the ceiling before the fix)", () => {
    const r = socsoContribution({ wage: 2950, category: 1, ...SOCSO });
    expect(r.employee).toBe(14.75);
    expect(r.employer).toBe(51.65);
  });
  it("Category 1 is band-stable across the band (RM3,000 same as RM2,950)", () => {
    const r = socsoContribution({ wage: 3000, category: 1, ...SOCSO });
    expect(r.employee).toBe(14.75);
    expect(r.employer).toBe(51.65);
  });
  it("Category 1 caps at the RM6,000 ceiling (assumed wage RM5,950): employee RM29.75, employer RM104.15", () => {
    const r = socsoContribution({ wage: 7000, category: 1, ...SOCSO });
    expect(r.employee).toBe(29.75);
    expect(r.employer).toBe(104.15);
  });
  it("Category 2 is employer-only (RM3,000 → RM36.90)", () => {
    const r = socsoContribution({ wage: 3000, category: 2, ...SOCSO });
    expect(r.employee).toBe(0);
    expect(r.employer).toBe(36.9);
  });
  it("is nil at/below the RM30 floor", () => {
    expect(socsoContribution({ wage: 30, category: 1, ...SOCSO })).toEqual({ employee: 0, employer: 0, assumedWage: 0 });
  });
});

describe("eisContribution (0.2% + 0.2%)", () => {
  it("RM2,950 → RM5.90 each side", () => {
    const r = eisContribution({ wage: 2950, ...EIS });
    expect(r.employee).toBe(5.9);
    expect(r.employer).toBe(5.9);
  });
  it("caps at RM6,000 ceiling → RM11.90 each side", () => {
    const r = eisContribution({ wage: 7000, ...EIS });
    expect(r.employee).toBe(11.9);
    expect(r.employer).toBe(11.9);
  });
});
