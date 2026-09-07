// Shift wall-clock times, normalised to HH:MM.
//
// The roster grid's custom-hours form reads two `<input type="time">` fields
// and posts them to /api/hr/schedules/cell. Browsers hand back "HH:MM"
// normally and "HH:MM:SS" when the input carries sub-minute precision, and an
// EMPTY STRING when the field is cleared or half-entered — which is trivial to
// do on a tablet's wheel picker. Postgres `time` columns read back as
// "HH:MM:SS" too, and the template path already slices those to "HH:MM".
//
// A strict /^\d{2}:\d{2}$/ on the request body therefore rejected perfectly
// good input: the grid posts `start + ":00"`, so EVERY custom-hours save was
// refused with "Custom shift times must be HH:MM" from 2026-09-05 (#1218)
// until this landed. Parse leniently, store one canonical shape.

/** "9:5" | "09:05" | "09:05:00" → "09:05". Anything else → null. */
export function normalizeShiftTime(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const m = /^(\d{1,2}):(\d{2})(?::(\d{2}))?$/.exec(value.trim());
  if (!m) return null;
  const hours = Number(m[1]);
  const minutes = Number(m[2]);
  const seconds = m[3] === undefined ? 0 : Number(m[3]);
  if (hours > 23 || minutes > 59) return null;
  // A shift boundary is minute-precision; ":30" seconds would silently round.
  if (seconds !== 0) return null;
  return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}`;
}

/** Minutes since midnight, for ordering two normalised times. */
export function minutesOfDay(hhmm: string): number {
  const [h, m] = hhmm.split(":").map(Number);
  return h * 60 + m;
}
