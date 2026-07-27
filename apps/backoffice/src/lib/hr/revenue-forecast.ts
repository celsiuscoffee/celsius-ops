// Revenue forecaster — the single weekly/per-day revenue prediction that feeds
// the labour gate's % denominator and the AI generator's "affordable man-hours".
//
// The old forecast was trailing-28-days ÷ 4: a flat mean of 4 equal weeks. That
// already captured the weekday/weekend MIX (28 days = 4 of each weekday), but it
//   (a) lagged a rising/falling trend by ~2 weeks, and
//   (b) was blind to public holidays — a past holiday distorted the baseline,
//       and a holiday in the forecast week wasn't accounted for at all.
//
// This module fixes both while staying a per-weekday model:
//   • Per-weekday baseline with RECENCY weighting (recent weeks count more), so
//     the forecast follows the trend instead of averaging it away.
//   • Public holidays are EXCLUDED from the baseline (a Raya spike or a closure
//     no longer skews a normal Tuesday), and a holiday IN the target week is
//     adjusted by the outlet's own historical holiday-vs-normal ratio (falls
//     back to "same as a normal day, flagged" when there's no holiday history).
//
// Pure + unit-tested here; the IO (fetching daily revenue + holidays) lives in
// labour-gate.ts, which calls buildWeekForecast().

// Trailing weeks of daily history to weigh. 4 keeps it comparable to the old
// 28-day window; the recency weighting is what makes it trend-aware.
export const FORECAST_WEEKS = 4;
// Weeks back at which a day's weight halves. 2 → weights ≈ [1, .71, .5, .35]
// across a 4-week window: recent weeks lead, older weeks still contribute.
export const RECENCY_HALFLIFE_WEEKS = 2;

export type DayForecast = {
  date: string;
  dow: number; // 0=Sun … 6=Sat
  isWeekend: boolean;
  forecast: number;
  isHoliday: boolean;
  holidayName?: string;
  // How this day's number was derived — surfaced in notes/tooltips.
  basis: "weekday-history" | "holiday-adjusted" | "no-history";
};

export type WeekForecast = {
  byDate: DayForecast[];
  weekly: number;
  method: string;
  holidayNote?: string;
};

const DAY_MS = 86400000;
const clampNonNeg = (n: number) => (n > 0 && Number.isFinite(n) ? n : 0);

// Weight for a history day `ageDays` before the week being forecast: geometric
// decay with the configured half-life. ageDays ≤ 0 (shouldn't happen) → weight 1.
function recencyWeight(ageDays: number): number {
  const halfLifeDays = RECENCY_HALFLIFE_WEEKS * 7;
  return Math.pow(0.5, Math.max(0, ageDays) / halfLifeDays);
}

// Build the week's forecast from trailing daily revenue + a holiday calendar.
//   weekDates : the 7 dates (Mon..Sun) being forecast, ISO YYYY-MM-DD.
//   history   : trailing daily revenue { date, revenue } (any length; typically
//               FORECAST_WEEKS×7 days ending the day before weekDates[0]).
//   holidays  : public holidays overlapping history AND the target week.
export function buildWeekForecast(input: {
  weekDates: string[];
  history: Array<{ date: string; revenue: number }>;
  holidays: Array<{ date: string; name: string }>;
}): WeekForecast {
  const { weekDates, history, holidays } = input;
  const holidayName = new Map(holidays.map((h) => [h.date, h.name]));
  const isHol = (date: string) => holidayName.has(date);
  const refMs = weekDates.length ? Date.parse(weekDates[0] + "T00:00:00Z") : NaN;
  const dowOf = (date: string) => new Date(date + "T00:00:00Z").getUTCDay();

  // Per-weekday weighted baseline from NON-holiday history, plus an all-days
  // weighted fallback for weekdays with no clean history.
  const wSum = new Array(7).fill(0);
  const wRev = new Array(7).fill(0);
  let allW = 0, allRev = 0;
  // History holidays: collect (actual / that-weekday-baseline) to size the ratio.
  const holidayObs: Array<{ dow: number; revenue: number; weight: number }> = [];
  for (const h of history) {
    const rev = clampNonNeg(h.revenue);
    const dow = dowOf(h.date);
    const ageDays = Number.isNaN(refMs) ? 0 : Math.round((refMs - Date.parse(h.date + "T00:00:00Z")) / DAY_MS);
    const w = recencyWeight(ageDays);
    if (isHol(h.date)) {
      holidayObs.push({ dow, revenue: rev, weight: w });
      continue; // holidays never pollute the normal-day baseline
    }
    wSum[dow] += w;
    wRev[dow] += w * rev;
    allW += w;
    allRev += w * rev;
  }
  const allAvg = allW > 0 ? allRev / allW : 0;
  const weekdayAvg = (dow: number): number | null => (wSum[dow] > 0 ? wRev[dow] / wSum[dow] : null);

  // Outlet holiday ratio: weighted mean of (holiday revenue ÷ that weekday's
  // normal baseline). Needs at least one history holiday with a usable baseline.
  let holidayRatio: number | null = null;
  {
    let rw = 0, racc = 0;
    for (const o of holidayObs) {
      const base = weekdayAvg(o.dow) ?? (allAvg > 0 ? allAvg : null);
      if (base && base > 0) {
        racc += o.weight * (o.revenue / base);
        rw += o.weight;
      }
    }
    if (rw > 0) holidayRatio = racc / rw;
  }

  const byDate: DayForecast[] = weekDates.map((date) => {
    const dow = dowOf(date);
    const isWeekend = dow === 0 || dow === 6;
    const base = weekdayAvg(dow);
    const holiday = isHol(date);
    if (base == null && allAvg <= 0) {
      return { date, dow, isWeekend, forecast: 0, isHoliday: holiday, holidayName: holidayName.get(date), basis: "no-history" };
    }
    const normal = base ?? allAvg;
    if (holiday) {
      const forecast = clampNonNeg(normal * (holidayRatio ?? 1));
      return { date, dow, isWeekend, forecast, isHoliday: true, holidayName: holidayName.get(date), basis: "holiday-adjusted" };
    }
    return { date, dow, isWeekend, forecast: clampNonNeg(normal), isHoliday: false, basis: "weekday-history" };
  });

  const weekly = byDate.reduce((s, d) => s + d.forecast, 0);
  const weekHolidays = byDate.filter((d) => d.isHoliday);
  const holidayNote = weekHolidays.length
    ? `${weekHolidays.length} public holiday(s) this week: ${weekHolidays
        .map((d) => `${d.date} ${d.holidayName ?? ""}`.trim())
        .join(", ")}${holidayRatio != null ? ` (adjusted ×${holidayRatio.toFixed(2)} from history)` : " (no holiday history — treated as a normal day, verify manually)"}`
    : undefined;

  return {
    byDate,
    weekly,
    method: `per-weekday, ${FORECAST_WEEKS}-week recency-weighted (½-life ${RECENCY_HALFLIFE_WEEKS}w), holidays excluded from baseline`,
    holidayNote,
  };
}
