import { describe, it, expect } from "vitest";
import { ptRateForDate, isWeekendDate } from "./pt-rate";

const pt = { hourly_rate: 9, hourly_rate_weekend: 10 };

describe("ptRateForDate (weekday/weekend/PH rule, owner 2026-07-18)", () => {
  it("pays the weekday base Mon–Fri", () => {
    expect(ptRateForDate(pt, "2026-07-22")).toBe(9); // Wed
    expect(ptRateForDate(pt, "2026-07-24")).toBe(9); // Fri
  });

  it("pays the weekend rate on Sat and Sun", () => {
    expect(ptRateForDate(pt, "2026-07-25")).toBe(10); // Sat
    expect(ptRateForDate(pt, "2026-07-26")).toBe(10); // Sun
  });

  it("doubles the day's rate on a public holiday (sheet's RM18/RM20 entries)", () => {
    expect(ptRateForDate(pt, "2026-07-22", true)).toBe(18); // weekday PH
    expect(ptRateForDate(pt, "2026-07-25", true)).toBe(20); // weekend PH
  });

  it("falls back to the base when no weekend rate is set", () => {
    expect(ptRateForDate({ hourly_rate: 9, hourly_rate_weekend: null }, "2026-07-25")).toBe(9);
    expect(ptRateForDate({ hourly_rate: 9 }, "2026-07-26")).toBe(9);
  });

  it("isWeekendDate flags Sat/Sun only", () => {
    expect(isWeekendDate("2026-07-24")).toBe(false);
    expect(isWeekendDate("2026-07-25")).toBe(true);
    expect(isWeekendDate("2026-07-26")).toBe(true);
    expect(isWeekendDate("2026-07-27")).toBe(false);
  });
});
