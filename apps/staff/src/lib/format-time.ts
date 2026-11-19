// Times on screen (Celsius UI): 12-hour with AM/PM, Malaysia time ("7:40 PM").
export function formatTime(value: string | number | Date): string {
  return new Date(value).toLocaleTimeString("en-US", {
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
    timeZone: "Asia/Kuala_Lumpur",
  });
}

// A wall-clock "HH:MM[:SS]" (a rostered start or end) as "8:00 AM". Pure
// string maths: no time zone is involved. Anything unreadable passes through.
export function formatClock(hhmm: string | null | undefined): string {
  const [h, m] = (hhmm ?? "").split(":");
  const hn = Number(h);
  if (!h || m == null || !Number.isFinite(hn) || !Number.isFinite(Number(m))) return hhmm ?? "";
  const suffix = hn >= 12 && hn < 24 ? "PM" : "AM";
  const h12 = hn % 12 === 0 ? 12 : hn % 12;
  return `${h12}:${m.slice(0, 2)} ${suffix}`;
}
