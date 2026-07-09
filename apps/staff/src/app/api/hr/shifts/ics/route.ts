import { NextRequest } from "next/server";

export const dynamic = "force-dynamic";

// GET /api/hr/shifts/ics?title=&start=&end=&tz=&details=
//
// Returns the shift as an iCalendar (.ics) file so the native "Add to calendar"
// button lands the event in the device's own calendar: Apple Calendar on iOS,
// the default calendar on Android. The app opens this URL with Linking, which
// hands it to the system browser WITHOUT the app's Bearer token, so this route
// is intentionally PUBLIC: it does no data access, it only formats the caller's
// own supplied title + times into a calendar file (no different from the app
// building the file itself, which it can't do without a native file module).
export async function GET(req: NextRequest) {
  const sp = req.nextUrl.searchParams;
  const title = (sp.get("title") || "Celsius shift").slice(0, 200);
  const details = (sp.get("details") || "Celsius Coffee shift").slice(0, 500);
  const start = sp.get("start") || ""; // local stamp "20260709T153000"
  const end = sp.get("end") || "";
  const tz = sp.get("tz") || "Asia/Kuala_Lumpur";

  const stampOk = /^\d{8}T\d{6}$/;
  if (!stampOk.test(start) || !stampOk.test(end)) {
    return new Response("Invalid start/end", { status: 400 });
  }

  // iCalendar text escaping: backslash, comma, semicolon, newline.
  const esc = (s: string) =>
    s.replace(/\\/g, "\\\\").replace(/([,;])/g, "\\$1").replace(/\r?\n/g, "\\n");

  const uid = `${start}-${end}-celsius-shift@celsiuscoffee.com`;

  // Malaysia is a single zone with no DST (always +0800), so a fixed-offset
  // VTIMEZONE makes the file fully valid without any date arithmetic.
  const ics = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//Celsius Coffee//Staff App//EN",
    "CALSCALE:GREGORIAN",
    "METHOD:PUBLISH",
    "BEGIN:VTIMEZONE",
    `TZID:${tz}`,
    "BEGIN:STANDARD",
    "DTSTART:19700101T000000",
    "TZOFFSETFROM:+0800",
    "TZOFFSETTO:+0800",
    "END:STANDARD",
    "END:VTIMEZONE",
    "BEGIN:VEVENT",
    `UID:${uid}`,
    `DTSTART;TZID=${tz}:${start}`,
    `DTEND;TZID=${tz}:${end}`,
    `SUMMARY:${esc(title)}`,
    `DESCRIPTION:${esc(details)}`,
    "END:VEVENT",
    "END:VCALENDAR",
  ].join("\r\n");

  return new Response(ics, {
    status: 200,
    headers: {
      "Content-Type": "text/calendar; charset=utf-8",
      "Content-Disposition": 'attachment; filename="celsius-shift.ics"',
      "Cache-Control": "no-store",
    },
  });
}
