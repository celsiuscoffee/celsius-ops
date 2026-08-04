import { describe, it, expect } from "vitest";
import { splitOtHours, effectiveOtType } from "./ot-policy";

// Imports the REAL module — the probation gate stayed "green" for weeks because
// its test exercised a local copy. Never again.

describe("splitOtHours — the request budget decides the RATE, never the pay", () => {
  it("caps premium at the approved budget and pays the rest plain", () => {
    // Razley 18 Jul: 3h worked OT against a 2h approval — 2h premium, 1h plain.
    expect(splitOtHours(3, 2)).toEqual({ premium: 2, plain: 1 });
  });

  it("never zeroes worked hours when nothing was approved", () => {
    // The owner's ruling: unapproved OT pays at plain hourly, not RM0.
    expect(splitOtHours(2.5, 0)).toEqual({ premium: 0, plain: 2.5 });
  });

  it("pays everything premium when the budget covers it, with no phantom plain", () => {
    expect(splitOtHours(2, 4)).toEqual({ premium: 2, plain: 0 });
  });

  it("an exact match consumes the whole budget", () => {
    expect(splitOtHours(2, 2)).toEqual({ premium: 2, plain: 0 });
  });

  it("no OT means nothing in either bucket", () => {
    expect(splitOtHours(0, 8)).toEqual({ premium: 0, plain: 0 });
  });

  it("garbage inputs degrade to zero, not NaN in a payslip", () => {
    expect(splitOtHours(NaN, 2)).toEqual({ premium: 0, plain: 0 });
    expect(splitOtHours(3, NaN)).toEqual({ premium: 0, plain: 3 });
    expect(splitOtHours(-1, 2)).toEqual({ premium: 0, plain: 0 });
    expect(splitOtHours(3, -2)).toEqual({ premium: 0, plain: 3 });
  });

  it("premium + plain always equals hours worked — money is conserved", () => {
    for (const ot of [0, 0.25, 1, 3.75, 12]) {
      for (const budget of [0, 0.5, 2, 100]) {
        const { premium, plain } = splitOtHours(ot, budget);
        expect(premium + plain).toBeCloseTo(ot, 10);
        expect(premium).toBeGreaterThanOrEqual(0);
        expect(plain).toBeGreaterThanOrEqual(0);
        expect(premium).toBeLessThanOrEqual(budget);
      }
    }
  });
});

describe("effectiveOtType — the roster as it finally stands, not the stamp", () => {
  it("downgrades a stale Sunday ot_2x to weekday 1.5× when no rest day is rostered", () => {
    // The 2 Aug poison: whole crew stamped off a roster re-published later.
    expect(effectiveOtType("ot_2x", false)).toBe("ot_1_5x");
  });

  it("downgrades a stale rest_day_1x stamp the same way", () => {
    expect(effectiveOtType("rest_day_1x", false)).toBe("ot_1_5x");
  });

  it("upgrades weekday stamps to 2× on a rostered rest day", () => {
    // EA s.60(3): work beyond the threshold on the rostered rest day is 2×.
    expect(effectiveOtType("ot_1_5x", true)).toBe("ot_2x");
    expect(effectiveOtType("ot_1x", true)).toBe("ot_2x");
    expect(effectiveOtType("ot_2x", true)).toBe("ot_2x");
  });

  it("keeps rest_day_1x on a genuinely rostered rest day", () => {
    expect(effectiveOtType("rest_day_1x", true)).toBe("rest_day_1x");
  });

  it("passes holiday classes through untouched — they key on the holiday table", () => {
    expect(effectiveOtType("ot_3x", false)).toBe("ot_3x");
    expect(effectiveOtType("ot_3x", true)).toBe("ot_3x");
    expect(effectiveOtType("ph_2x", false)).toBe("ph_2x");
    expect(effectiveOtType("ph_2x", true)).toBe("ph_2x");
  });

  it("defaults a missing stamp to weekday 1.5×, or 2× if rostered rest", () => {
    expect(effectiveOtType(null, false)).toBe("ot_1_5x");
    expect(effectiveOtType(undefined, false)).toBe("ot_1_5x");
    expect(effectiveOtType(null, true)).toBe("ot_2x");
  });

  it("leaves plain and default weekday stamps alone off rest days", () => {
    expect(effectiveOtType("ot_1x", false)).toBe("ot_1x");
    expect(effectiveOtType("ot_1_5x", false)).toBe("ot_1_5x");
  });
});
