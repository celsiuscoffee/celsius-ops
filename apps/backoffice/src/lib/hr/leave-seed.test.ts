import { describe, it, expect } from "vitest";
import { proratedAnnualDays } from "./leave-seed";

// Same formula as the 2026-07-28 fleet backfill: 8 × remaining-days-of-year
// from join date ÷ days-in-year, nearest 0.5.
describe("proratedAnnualDays", () => {
  it("Jan 1 join gets the full base", () => {
    expect(proratedAnnualDays("2026-01-01")).toBe(8);
  });
  it("matches the backfill: Hafifie 16 Apr → 5.5", () => {
    expect(proratedAnnualDays("2026-04-16")).toBe(5.5);
  });
  it("matches the backfill: Auni 27 Jul → 3.5", () => {
    expect(proratedAnnualDays("2026-07-27")).toBe(3.5);
  });
  it("matches the backfill: 1 Jun → 4.5", () => {
    expect(proratedAnnualDays("2026-06-01")).toBe(4.5);
  });
  it("late-December join rounds to 0", () => {
    expect(proratedAnnualDays("2026-12-30")).toBe(0);
  });
  it("invalid date falls back to full base rather than zeroing a hire", () => {
    expect(proratedAnnualDays("not-a-date")).toBe(8);
  });
});
