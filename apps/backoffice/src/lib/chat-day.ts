// WhatsApp-style day grouping for chat threads. Computed in MYT (UTC+8) — the
// business runs there while timestamps are stored UTC — so a message at 00:30 MYT
// groups under the right calendar day, not the previous UTC one. See myt-today.ts.
const MYT_OFFSET = 8 * 60 * 60 * 1000;

const ms = (iso: string | Date) => (typeof iso === "string" ? Date.parse(iso) : iso.getTime());

/** The MYT calendar day (YYYY-MM-DD) a UTC instant falls on — the day-boundary key. */
export function mytDayKey(iso: string | Date): string {
  return new Date(ms(iso) + MYT_OFFSET).toISOString().slice(0, 10);
}

/** "Today" / "Yesterday" / weekday (within the past week) / "3 June 2026". */
export function chatDayLabel(iso: string | Date): string {
  const key = mytDayKey(iso);
  const diffDays = Math.round((Date.parse(mytDayKey(new Date())) - Date.parse(key)) / 86400000);
  if (diffDays === 0) return "Today";
  if (diffDays === 1) return "Yesterday";
  // Format the MYT-shifted instant in UTC so the wall-clock fields read as MYT.
  const shifted = new Date(ms(iso) + MYT_OFFSET);
  if (diffDays > 1 && diffDays < 7) {
    return shifted.toLocaleDateString("en-MY", { weekday: "long", timeZone: "UTC" });
  }
  return shifted.toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" });
}
