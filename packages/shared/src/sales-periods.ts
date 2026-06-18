// Single source of truth for what "this week" / "this month" mean across the
// sales surfaces — backoffice headline (/api/sales/dashboard), the backoffice
// comparison chart, and the staff-native dashboard. Keep ONE definition here so
// the three can never drift again (they previously did: the backoffice headline
// used a trailing-7-day window while the chart + staff used a calendar week).
//
// All boundaries are MYT (UTC+8, no DST). The calendar week starts SUNDAY.
// Helpers operate on YYYY-MM-DD strings and are timezone-safe regardless of the
// server's local TZ (anchored at noon MYT = 04:00 UTC, same calendar day).

/** Today's date as YYYY-MM-DD in MYT. */
export function mytToday(now: Date = new Date()): string {
  return new Date(now.getTime() + 8 * 3600 * 1000).toISOString().slice(0, 10);
}

/** Day of week in MYT for a YYYY-MM-DD date. 0 = Sunday … 6 = Saturday. */
export function dowMYT(dateStr: string): number {
  return new Date(`${dateStr}T12:00:00+08:00`).getUTCDay();
}

/** Add n calendar days to a YYYY-MM-DD date (MYT-safe). */
export function addDaysMYT(dateStr: string, n: number): string {
  const d = new Date(`${dateStr}T12:00:00+08:00`); // = `date` 04:00 UTC
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

/** Sunday of the calendar week containing `dateStr` (MYT). */
export function startOfWeekMYT(dateStr: string): string {
  return addDaysMYT(dateStr, -dowMYT(dateStr));
}

/** First day of the calendar month containing `dateStr`. */
export function startOfMonthMYT(dateStr: string): string {
  return `${dateStr.slice(0, 7)}-01`;
}

/** Last day of the calendar month containing `dateStr`. */
export function endOfMonthMYT(dateStr: string): string {
  const [y, m] = dateStr.split("-").map(Number);
  const last = new Date(Date.UTC(y, m, 0)).getUTCDate(); // day 0 of next month
  return `${dateStr.slice(0, 7)}-${String(last).padStart(2, "0")}`;
}

export type SalesMode = "day" | "week" | "month" | "custom";
export type SalesRange = { from: string; to: string };

/**
 * Canonical current + previous period for a sales mode, as MYT YYYY-MM-DD
 * ranges. Week = calendar week (Sun-start) to date; Month = calendar month to
 * date; Day = today. The previous period is the equivalent calendar period
 * immediately before (callers apply their own same-elapsed cutoff for
 * like-for-like headline deltas).
 */
export function salesPeriodRange(
  mode: SalesMode,
  todayStr: string = mytToday(),
  from?: string | null,
  to?: string | null,
): { cur: SalesRange; prev: SalesRange } {
  if (mode === "week") {
    const sun = startOfWeekMYT(todayStr);
    return {
      cur: { from: sun, to: todayStr },
      prev: { from: addDaysMYT(sun, -7), to: addDaysMYT(sun, -1) },
    };
  }
  if (mode === "month") {
    const ms = startOfMonthMYT(todayStr);
    const prevEnd = addDaysMYT(ms, -1);
    return {
      cur: { from: ms, to: todayStr },
      prev: { from: startOfMonthMYT(prevEnd), to: prevEnd },
    };
  }
  if (mode === "custom" && from && to) {
    const f = from <= to ? from : to;
    const t = from <= to ? to : from;
    const span = Math.round(
      (new Date(`${t}T12:00:00+08:00`).getTime() - new Date(`${f}T12:00:00+08:00`).getTime()) / 86_400_000,
    );
    return { cur: { from: f, to: t }, prev: { from: addDaysMYT(f, -(span + 1)), to: addDaysMYT(f, -1) } };
  }
  // day
  return { cur: { from: todayStr, to: todayStr }, prev: { from: addDaysMYT(todayStr, -1), to: addDaysMYT(todayStr, -1) } };
}
