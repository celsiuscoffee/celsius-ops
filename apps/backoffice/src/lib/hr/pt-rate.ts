// PT hourly-rate rule (owner 2026-07-18, from the "Celsius - Part Timer
// 2025/26" wage sheet): part-timers earn the WEEKDAY base Mon–Fri, a higher
// WEEKEND rate on Sat/Sun (company standard RM9 / RM10), and DOUBLE the
// day's rate on a gazetted public holiday (the sheet's RM18/RM20 entries).
// Pure — every consumer (weekly payroll, labour gate, AI Fill costing,
// Assist ranking) prices a PT hour through this one function so the roster's
// estimate and the payout can never disagree.

export const PT_HOLIDAY_MULTIPLIER = 2;

export function isWeekendDate(dateStr: string): boolean {
  const dw = new Date(dateStr + "T00:00:00Z").getUTCDay();
  return dw === 0 || dw === 6;
}

export function ptRateForDate(
  profile: { hourly_rate: number | null; hourly_rate_weekend?: number | null },
  dateStr: string, // YYYY-MM-DD (MYT calendar date)
  isPublicHoliday = false,
): number {
  const base = Number(profile.hourly_rate) || 0;
  const weekend = profile.hourly_rate_weekend != null ? Number(profile.hourly_rate_weekend) : null;
  const day = isWeekendDate(dateStr) && weekend != null && weekend > 0 ? weekend : base;
  return isPublicHoliday ? day * PT_HOLIDAY_MULTIPLIER : day;
}
