// Inbox formats (Celsius UI writing rules): RM with two decimals, 12-hour times,
// dates in words ("Mon 9 Nov"), all in Malaysia time.

const TZ = "Asia/Kuala_Lumpur";

export function formatInboxAmount(rm: number): string {
  return "RM " + rm.toLocaleString("en-MY", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

// Today → "2:31 PM"; another day → "Mon 9 Nov".
export function formatInboxTime(iso: string, now: Date = new Date()): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const day = (x: Date) => x.toLocaleDateString("en-CA", { timeZone: TZ });
  if (day(d) === day(now)) {
    return d.toLocaleTimeString("en-US", { timeZone: TZ, hour: "numeric", minute: "2-digit" });
  }
  return d.toLocaleDateString("en-GB", { timeZone: TZ, weekday: "short", day: "numeric", month: "short" });
}
