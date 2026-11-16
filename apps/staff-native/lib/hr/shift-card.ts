// Today's shift on the Today clock card (restructure step 4B, 16 Nov 2026).
// Pure helpers so they can be tested without React Native. Times are Malaysia
// time and 12-hour with AM/PM (Celsius UI writing rules).

export type ShiftLike = { shift_date: string; start_time: string; end_time: string | null; outlet_name?: string | null; position?: string | null };

const MYT_OFFSET_MS = 8 * 60 * 60 * 1000;

// Rest-day markers are saved as a shift with equal start/end (00:00–00:00);
// they are not shifts to clock in for.
function isRealShift(s: ShiftLike): boolean {
  return !!s.end_time && s.start_time.slice(0, 5) !== s.end_time.slice(0, 5);
}

/** Earliest real shift on `today` (YYYY-MM-DD, Malaysia date), or null. */
export function pickTodayShift<T extends ShiftLike>(shifts: T[] | null | undefined, today: string): T | null {
  const mine = (shifts ?? []).filter((s) => s.shift_date === today && isRealShift(s));
  mine.sort((a, b) => a.start_time.localeCompare(b.start_time));
  return mine[0] ?? null;
}

/** "07:30" → "7:30 AM"; "15:00" → "3 PM". */
export function time12(hm: string): string {
  const [h, m] = hm.slice(0, 5).split(":").map(Number);
  const suffix = h >= 12 ? "PM" : "AM";
  const hr = h % 12 || 12;
  return m ? `${hr}:${String(m).padStart(2, "0")} ${suffix}` : `${hr} ${suffix}`;
}

/** Epoch ms of a Malaysia wall-clock time on a date. */
function mytMs(date: string, hm: string): number {
  return Date.parse(`${date}T${hm.slice(0, 5)}:00Z`) - MYT_OFFSET_MS;
}

const mins = (ms: number) => Math.round(ms / 60_000);
const span = (m: number) => (m < 60 ? `${m} min` : m % 60 ? `${Math.floor(m / 60)} h ${m % 60} min` : `${m / 60} h`);

/**
 * What the clock card says about today's shift.
 * - times: "7:30 AM – 3:30 PM"
 * - hint:  before → "Starts in 12 min" / "Started 5 min ago";
 *          clocked in → "Ends 3:30 PM".
 */
export function shiftLine(shift: ShiftLike, now: number, clockedIn: boolean): { times: string; hint: string } {
  const end = shift.end_time ?? shift.start_time;
  const times = `${time12(shift.start_time)} – ${time12(end)}`;
  if (clockedIn) return { times, hint: `Ends ${time12(end)}` };
  const diff = mins(mytMs(shift.shift_date, shift.start_time) - now);
  const hint = diff > 0 ? `Starts in ${span(diff)}` : diff === 0 ? "Starts now" : `Started ${span(-diff)} ago`;
  return { times, hint };
}
