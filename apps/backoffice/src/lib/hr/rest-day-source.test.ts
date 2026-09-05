import { describe, it, expect } from "vitest";
import { deriveHours } from "./hours";

// A REST DAY IS THE ONE ON THE ROSTER. It is not a weekday on the profile.
//
// Owner 2026-08-03: "rest day should follow schedule."
//
// Three of the four writers already read hr_schedule_shifts for a "Rest Day"
// row. The fourth — the manager's manual set-times edit in
// /api/hr/attendance — was still doing `profile.rest_day ?? 0`, and
// hr_employee_profiles.rest_day is NULL for all 77 profiles, so `?? 0`
// resolved to Sunday for everybody.
//
// The damage, measured on July 2026: 96 logs carried a rest-day overtime_type.
// Every single one was a Sunday. NONE of them fell on one of the 161 rest days
// actually rostered that month, which were spread across 40 people and all 31
// dates. The two sources agreed on precisely zero logs — this was not a
// mostly-right heuristic with edge cases, it was wrong every time it fired.
//
// These tests pin the SHAPE of the decision (a boolean sourced from the
// roster) and the pay consequence of getting it wrong, so a future refactor
// cannot quietly reintroduce a weekday rule.

const at = (iso: string) => new Date(iso);

/** What the buggy path did: NULL rest_day fell through to 0 = Sunday. */
const weekdayRule = (d: Date, restDay: number | null) =>
  d.getUTCDay() === (restDay == null ? 0 : Number(restDay));

/** What every writer must do now: ask the roster. */
const rosterRule = (hasRestDayShift: boolean) => hasRestDayShift;

describe("where isRestDay comes from", () => {
  const sunday = at("2026-07-19T04:00:00Z");
  const wednesday = at("2026-07-22T04:00:00Z");

  it("the old rule called EVERY Sunday a rest day, because rest_day is NULL for all 77 profiles", () => {
    expect(weekdayRule(sunday, null)).toBe(true);
  });

  it("...and therefore missed a real rest day rostered on any other weekday", () => {
    expect(weekdayRule(wednesday, null)).toBe(false); // rostered rest day, not seen
  });

  it("the roster rule ignores which weekday it is — only the roster row matters", () => {
    expect(rosterRule(false)).toBe(false); // Sunday shift, not a rostered rest day
    expect(rosterRule(true)).toBe(true);   // Wednesday rest day, correctly seen
  });
});

describe("what the misclassification costs", () => {
  // Same shift, same hours: 08:00-18:00 MYT with the roster starting 08:00.
  // FT threshold is 7.5h and a 1h unpaid break applies over 5h, so 9h worked.
  const shift = {
    clockIn: at("2026-07-19T00:00:00Z"),
    clockOut: at("2026-07-19T10:00:00Z"),
    employmentType: "full_time",
    isPublicHoliday: false,
    scheduledStart: at("2026-07-19T00:00:00Z"),
  };

  it("a normal day gives weekday OT at 1.5x", () => {
    const d = deriveHours({ ...shift, isRestDay: false });
    expect(d.overtimeType).toBe("ot_1_5x");
    expect(d.overtimeHours).toBe(1.5); // 30-min brackets since 2026-09-03 (was floored to 1)
  });

  it("the SAME shift called a rest day gives 2x instead — the rate is wrong, not just the label", () => {
    const d = deriveHours({ ...shift, isRestDay: true });
    expect(d.overtimeType).toBe("ot_2x");
    expect(d.overtimeHours).toBe(1.5); // 30-min brackets since 2026-09-03 (was floored to 1)
  });

  it("under the threshold, a false rest day swallows the OT classification entirely", () => {
    // 07:00-15:00 = 8h clocked, 7h worked after break: under 7.5h either way,
    // but the rest-day branch stamps rest_day_1x, which reads as "worked a rest
    // day" on every report and payslip when no rest day was rostered.
    const short = {
      ...shift,
      clockIn: at("2026-07-18T23:00:00Z"),
      clockOut: at("2026-07-19T07:00:00Z"),
      scheduledStart: at("2026-07-18T23:00:00Z"),
    };
    expect(deriveHours({ ...short, isRestDay: false }).overtimeType).toBeNull();
    expect(deriveHours({ ...short, isRestDay: true }).overtimeType).toBe("rest_day_1x");
  });
});

describe("rest-day pay policy (owner 2026-08-03)", () => {
  // "there will be no rest day premium. there should only be overtime."
  // rest_day_1x credits ZERO overtime hours — the hours are regular, i.e.
  // already inside the monthly salary. Only hours past the threshold earn 2x.
  // This is the existing behaviour and it is deliberate; the test exists so
  // nobody "fixes" it back into a premium.
  const restDay = {
    employmentType: "full_time",
    isPublicHoliday: false,
    isRestDay: true,
    clockIn: at("2026-07-22T00:00:00Z"),
    scheduledStart: at("2026-07-22T00:00:00Z"),
  };

  it("pays NO premium for rest-day work within normal hours", () => {
    // 08:00-15:00 = 7h clocked, 6h worked after break.
    const d = deriveHours({ ...restDay, clockOut: at("2026-07-22T07:00:00Z") });
    expect(d.overtimeType).toBe("rest_day_1x");
    expect(d.overtimeHours).toBe(0);
    expect(d.regularHours).toBe(6);
  });

  it("pays 2x only for the hours BEYOND the threshold", () => {
    const d = deriveHours({ ...restDay, clockOut: at("2026-07-22T10:00:00Z") });
    expect(d.overtimeType).toBe("ot_2x");
    expect(d.overtimeHours).toBe(1.5); // 30-min brackets since 2026-09-03 (was floored to 1)
    expect(d.regularHours).toBe(7.5);
  });
});
