import { describe, it, expect } from "vitest";
import { proratedAnnualDays } from "./leave-seed";

// Employment Act 1955 s.60E: proportion by COMPLETED MONTHS of service (a
// month counts only when worked in full — join on the 1st counts it), rounded
// to whole days with a half-day-or-more going UP.
describe("proratedAnnualDays", () => {
  it("Jan 1 join gets the full base (12 completed months)", () => {
    expect(proratedAnnualDays("2026-01-01")).toBe(8);
  });
  it("1 Jun → 7 months → 8×7/12 = 4.67 → 5", () => {
    expect(proratedAnnualDays("2026-06-01")).toBe(5);
  });
  it("16 Apr → 8 months (join month not full) → 8×8/12 = 5.33 → 5", () => {
    expect(proratedAnnualDays("2026-04-16")).toBe(5);
  });
  it("27 Jul → 5 months → 8×5/12 = 3.33 → 3", () => {
    expect(proratedAnnualDays("2026-07-27")).toBe(3);
  });
  it("1 Sep → 4 months → 8×4/12 = 2.67 → 3 (the act, vs the old 2.5)", () => {
    expect(proratedAnnualDays("2026-09-01")).toBe(3);
  });
  it("mid-month join in the join month is not a completed month: 21 Aug → 4 months → 3", () => {
    expect(proratedAnnualDays("2026-08-21")).toBe(3);
  });
  it("a 2–5 year band (base 12): 1 Sep → 12×4/12 = 4", () => {
    expect(proratedAnnualDays("2026-09-01", 12)).toBe(4);
  });
  it("late-December join rounds to 0", () => {
    expect(proratedAnnualDays("2026-12-30")).toBe(0);
  });
  it("invalid date falls back to full base rather than zeroing a hire", () => {
    expect(proratedAnnualDays("not-a-date")).toBe(8);
  });
});
