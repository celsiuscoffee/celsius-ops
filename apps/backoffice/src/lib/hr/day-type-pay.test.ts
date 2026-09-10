import { describe, it, expect } from "vitest";
import { dayTypePay } from "./day-type-pay";

// EA 1955 s.60D(3)(a) / s.60(3)(b) for a monthly-rated employee. ORP is
// monthly wages / 26 — Shairuleen RM2,200 → RM84.62 a day.
const ORP = 2200 / 26;

describe("dayTypePay — public holiday", () => {
  it("pays ONE ORP per holiday worked regardless of hours (31 Aug 2026, 7.0h shift)", () => {
    const r = dayTypePay({
      orp: ORP, normalHoursPerDay: 7.5,
      publicHolidayHours: new Map([["2026-08-31", 7]]),
      restDayHours: new Map(),
    });
    expect(r.publicHolidayDays).toBe(1);
    expect(r.publicHolidayHours).toBe(7);
    expect(r.publicHolidayAmount).toBeCloseTo(84.62, 2); // not 7 × 11.28 = 78.97
  });

  it("a short holiday shift (Syafiq 5.77h) still earns the full second day's wage", () => {
    const r = dayTypePay({
      orp: 3500 / 26, normalHoursPerDay: 7.5,
      publicHolidayHours: new Map([["2026-08-31", 5.77]]),
      restDayHours: new Map(),
    });
    expect(r.publicHolidayAmount).toBeCloseTo(134.62, 2);
  });

  it("split shifts on one holiday are one premium, not two", () => {
    const r = dayTypePay({
      orp: ORP, normalHoursPerDay: 7.5,
      publicHolidayHours: new Map([["2026-08-31", 3 + 4]]),
      restDayHours: new Map(),
    });
    expect(r.publicHolidayDays).toBe(1);
  });

  it("a holiday that is also a rostered rest day is paid once, as a holiday", () => {
    const r = dayTypePay({
      orp: ORP, normalHoursPerDay: 7.5,
      publicHolidayHours: new Map([["2026-08-31", 7]]),
      restDayHours: new Map([["2026-08-31", 7]]),
    });
    expect(r.publicHolidayAmount).toBeCloseTo(84.62, 2);
    expect(r.restDayAmount).toBe(0);
  });
});

describe("dayTypePay — rostered rest day", () => {
  it("more than half the normal hours → one day's wages", () => {
    const r = dayTypePay({
      orp: ORP, normalHoursPerDay: 7.5,
      publicHolidayHours: new Map(),
      restDayHours: new Map([["2026-08-09", 7]]),
    });
    expect(r.restDayDays).toBe(1);
    expect(r.restDayAmount).toBeCloseTo(84.62, 2);
  });

  it("up to half the normal hours → half a day's wages", () => {
    const r = dayTypePay({
      orp: ORP, normalHoursPerDay: 7.5,
      publicHolidayHours: new Map(),
      restDayHours: new Map([["2026-08-09", 3.5]]),
    });
    expect(r.restDayAmount).toBeCloseTo(42.31, 2);
  });

  it("zero-hour entries pay nothing", () => {
    const r = dayTypePay({
      orp: ORP, normalHoursPerDay: 7.5,
      publicHolidayHours: new Map([["2026-08-31", 0]]),
      restDayHours: new Map([["2026-08-09", 0]]),
    });
    expect(r.publicHolidayAmount).toBe(0);
    expect(r.restDayAmount).toBe(0);
  });
});
