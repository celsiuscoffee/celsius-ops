import type { Shift } from "./api";
import { API_BASE_URL } from "../env";

// Malaysia has a single timezone with no DST, so we can pin every shift to
// Asia/Kuala_Lumpur wall-clock times directly.
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

// Build the .ics endpoint URL for a shift. Opened with Linking, iOS hands the
// text/calendar response to Apple Calendar and Android to its default calendar,
// so the event lands in the user's OWN device calendar. We serve an .ics (via
// the backend) rather than a Google Calendar link so it isn't tied to Google,
// and it still ships over-the-air (no native calendar/file module needed).
export function buildShiftIcsUrl(shift: Shift): string {
  const role = shift.position ? ` (${shift.position})` : "";
  const title = `Celsius shift${role}`;
  const start = stamp(shift.shift_date, shift.start_time);
  // A closing shift can cross midnight; roll the end date forward when it does.
  const endDate =
    shift.end_time <= shift.start_time
      ? nextDay(shift.shift_date)
      : shift.shift_date;
  const end = stamp(endDate, shift.end_time);

  const q = [
    ["title", title],
    ["details", "Celsius Coffee shift"],
    ["start", start],
    ["end", end],
    ["tz", TZ],
  ]
    .map(([k, v]) => `${k}=${encodeURIComponent(v)}`)
    .join("&");
  return `${API_BASE_URL}/api/hr/shifts/ics?${q}`;
}
