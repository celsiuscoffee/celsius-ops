import type { Shift } from "./api";

// Malaysia has a single timezone with no DST, so we can pin every shift to
// Asia/Kuala_Lumpur and hand Google Calendar wall-clock times directly.
const TZ = "Asia/Kuala_Lumpur";

// "2026-07-09" + "15:30:00" -> "20260709T153000" (Google TEMPLATE local stamp)
function stamp(dateISO: string, time: string): string {
  const date = dateISO.replace(/-/g, "");
  const parts = time.split(":");
  while (parts.length < 3) parts.push("00");
  const t = parts
    .slice(0, 3)
    .map((x) => x.padStart(2, "0"))
    .join("");
  return `${date}T${t}`;
}

function nextDay(dateISO: string): string {
  const [y, m, d] = dateISO.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  dt.setUTCDate(dt.getUTCDate() + 1);
  return dt.toISOString().slice(0, 10);
}

// Duration in minutes, wrapping past midnight for closing/overnight shifts
// (end time earlier than or equal to start time means it lands the next day).
export function shiftDurationMinutes(startTime: string, endTime: string): number {
  const [sh, sm] = startTime.split(":").map(Number);
  const [eh, em] = endTime.split(":").map(Number);
  let mins = eh * 60 + em - (sh * 60 + sm);
  if (mins <= 0) mins += 24 * 60;
  return mins;
}

export function formatDuration(startTime: string, endTime: string): string {
  const mins = shiftDurationMinutes(startTime, endTime);
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return m ? `${h}h ${m}m` : `${h}h`;
}

// Build a Google Calendar "add event" URL for a shift. We use the web
// TEMPLATE endpoint (opened via Linking) rather than expo-calendar so the
// feature ships over-the-air — no native module, no calendar permission,
// works on iOS and Android, and the org already lives in Google Workspace.
export function buildShiftCalendarUrl(shift: Shift): string {
  const role = shift.position ? ` — ${shift.position}` : "";
  const title = `Celsius shift${role}`;
  const start = stamp(shift.shift_date, shift.start_time);
  // A closing shift can cross midnight; roll the end date forward when it does.
  const endDate =
    shift.end_time <= shift.start_time
      ? nextDay(shift.shift_date)
      : shift.shift_date;
  const end = stamp(endDate, shift.end_time);
  const details = "Celsius Coffee shift";

  // Build the query manually: React Native's URLSearchParams polyfill is
  // limited and mangles non-ASCII (e.g. the em dash in the title), so encode
  // each value with encodeURIComponent instead.
  const q = [
    ["action", "TEMPLATE"],
    ["text", title],
    ["dates", `${start}/${end}`],
    ["ctz", TZ],
    ["details", details],
  ]
    .map(([k, v]) => `${k}=${encodeURIComponent(v)}`)
    .join("&");
  return `https://www.google.com/calendar/render?${q}`;
}
