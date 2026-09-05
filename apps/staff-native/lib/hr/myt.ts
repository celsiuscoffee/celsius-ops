// Malaysia-time formatting without Intl. Hermes' Intl support for the
// `timeZone` option is not reliable across devices, and the screens used the
// phone's local zone, so a staffer on roaming (or a phone left on another
// zone) saw shifts a day early and clock times hours off. Everything here
// shifts the instant by +08:00 and reads UTC fields.

const MYT_OFFSET_MS = 8 * 3600 * 1000;
const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

const shifted = (d: Date | string | number) => new Date(new Date(d).getTime() + MYT_OFFSET_MS);

/** "09:05" in Malaysia time from an instant. */
export function mytTime(d: Date | string | number): string {
  const s = shifted(d);
  return `${String(s.getUTCHours()).padStart(2, "0")}:${String(s.getUTCMinutes()).padStart(2, "0")}`;
}

/** "Mon, 3 Aug" in Malaysia time from an instant. */
export function mytDayLabel(d: Date | string | number): string {
  const s = shifted(d);
  return `${DAYS[s.getUTCDay()]}, ${s.getUTCDate()} ${MONTHS[s.getUTCMonth()]}`;
}

/** YYYY-MM-DD of the instant in Malaysia time. */
export function mytDate(d: Date | string | number): string {
  return shifted(d).toISOString().slice(0, 10);
}

/** Today's Malaysia calendar date. */
export function mytToday(): string {
  return mytDate(Date.now());
}

/**
 * Parts of a plain calendar day ("2026-08-03") — a roster date has no
 * instant, so it must never go through `new Date(ymd)` (UTC midnight, which
 * is the previous evening west of Greenwich and renders as the wrong day).
 */
export function calendarDayParts(ymd: string): { dayName: string; dayNum: string; monthName: string; label: string } {
  const [y, m, d] = ymd.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  const dayName = DAYS[dt.getUTCDay()];
  const monthName = MONTHS[m - 1];
  return { dayName, dayNum: String(d), monthName, label: `${dayName}, ${d} ${monthName}` };
}

/** "HH:MM:SS" roster wall time → "09:05" (roster times are already Malaysia wall-clock). */
export function wallTime(t: string): string {
  return t.slice(0, 5);
}

/** A roster row that is a rest-day marker (00:00–00:00 / "Rest Day"), never a shift to show or export. */
export function isRestDayRow(row: { start_time: string; end_time: string; position?: string | null; notes?: string | null }): boolean {
  const zero = row.start_time.slice(0, 5) === "00:00" && row.end_time.slice(0, 5) === "00:00";
  return zero || row.notes === "rest_day" || /^rest/i.test(row.position ?? "");
}
