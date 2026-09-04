// Day-type pay for a MONTHLY-RATED employee who works on a public holiday or a
// rostered rest day — Employment Act 1955 s.60D(3)(a) and s.60(3)(b).
//
// Both are paid in DAYS at the ordinary rate of pay (ORP = monthly wages / 26,
// s.60I(1A)(a)), not in hours. The Act is explicit for holidays: "two days'
// wages at the ordinary rate of pay, regardless that the period of work done
// on that day is less than the normal hours of work". Salary already pays the
// first day, so the premium is ONE ORP per holiday worked. The first cut of the
// PH premium (2026-09-03, PR #1209) paid hours × hourly rate, which shorted a
// 7.0h shift by 7/7.5 of a day (Shairuleen RM78.97 vs RM84.62).
//
// Rest day (s.60(3)(b)): work not exceeding half the normal hours pays half a
// day's wages; more than half (up to the normal hours) pays one day's wages —
// in addition to the month's salary. Hours BEYOND normal hours on either day
// are overtime and are priced by the OT block (2× rest day, 3× holiday).
//
// Pure — pinned by day-type-pay.test.ts. Split shifts on one date aggregate
// (one premium per day, not per log).

export type DayTypeInput = {
  /** Ordinary rate of pay for one day (monthly wages / 26). */
  orp: number;
  /** Normal hours of work per day (7.5 for the 45h/6-day contract). */
  normalHoursPerDay: number;
  /** MYT date → approved regular hours worked on a gazetted public holiday. */
  publicHolidayHours: Map<string, number>;
  /** MYT date → approved regular hours worked on a ROSTERED rest day. */
  restDayHours: Map<string, number>;
};

export type DayTypePay = {
  publicHolidayDays: number;
  publicHolidayHours: number;
  /** Second day's wage per holiday worked (one ORP each). */
  publicHolidayAmount: number;
  restDayDays: number;
  restDayHours: number;
  /** Half or one ORP per rest day worked, by hours. */
  restDayAmount: number;
};

const r2 = (n: number) => Math.round(n * 100) / 100;

export function dayTypePay(input: DayTypeInput): DayTypePay {
  const out: DayTypePay = {
    publicHolidayDays: 0, publicHolidayHours: 0, publicHolidayAmount: 0,
    restDayDays: 0, restDayHours: 0, restDayAmount: 0,
  };
  const orp = Math.max(0, input.orp);
  const half = input.normalHoursPerDay / 2;

  for (const [date, hours] of input.publicHolidayHours) {
    if (!(hours > 0)) continue;
    out.publicHolidayDays++;
    out.publicHolidayHours += hours;
    out.publicHolidayAmount += orp;
    // A holiday that is also a rest day is priced as a holiday only — the
    // holiday rate is the higher entitlement and the day is not paid twice.
    input.restDayHours.delete(date);
  }
  for (const [, hours] of input.restDayHours) {
    if (!(hours > 0)) continue;
    out.restDayDays++;
    out.restDayHours += hours;
    out.restDayAmount += hours <= half ? orp / 2 : orp;
  }
  out.publicHolidayHours = r2(out.publicHolidayHours);
  out.publicHolidayAmount = r2(out.publicHolidayAmount);
  out.restDayHours = r2(out.restDayHours);
  out.restDayAmount = r2(out.restDayAmount);
  return out;
}
