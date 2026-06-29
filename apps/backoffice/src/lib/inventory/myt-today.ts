// The business runs in Malaysia (UTC+8). Invoice due/issue dates are stored as midnight of the
// calendar date the user picked (e.g. 2026-06-30 00:00:00, read back as UTC midnight). Computing
// "today" from the server's clock — `new Date(y, m, d)` on Vercel resolves to UTC — mis-buckets
// everything between Malaysia midnight and 08:00, when UTC is still "yesterday": invoices due
// today in Malaysia fall outside the window and vanish from the Due Today card/filter. These
// helpers key "today" to the MALAYSIA date instead. Pure (no deps) — usable on server + client.

const MYT_OFFSET_MS = 8 * 60 * 60 * 1000;

/** Today's Malaysia calendar date as "YYYY-MM-DD" (for date-only string comparisons). */
export function mytTodayStr(): string {
  return new Date(Date.now() + MYT_OFFSET_MS).toISOString().slice(0, 10);
}

/**
 * [start, end) for the current Malaysia day, as UTC-midnight Dates — matching how dueDate/issueDate
 * are stored, so `dueDate: { gte: start, lt: end }` selects invoices due *today in Malaysia*, and
 * `dueDate: { lt: start }` is genuinely overdue.
 */
export function mytTodayRange(): { start: Date; end: Date } {
  const start = new Date(`${mytTodayStr()}T00:00:00.000Z`);
  return { start, end: new Date(start.getTime() + 86400000) };
}
