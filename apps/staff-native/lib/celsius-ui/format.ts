// Celsius UI words for times: 12-hour with AM/PM ("7:40 PM"), Malaysia time
// whatever zone the phone is in. Display only.
import { mytTime } from "../hr/myt";

/** "07:30" or "19:05:00" (a wall-clock string) → "7:30 AM" / "7:05 PM". */
export function hm12(hm: string | null | undefined): string {
  const [hs, ms] = (hm ?? "").slice(0, 5).split(":");
  const h = Number(hs);
  const m = Number(ms);
  if (hs === "" || ms == null || !Number.isFinite(h) || !Number.isFinite(m)) return "-";
  return `${h % 12 || 12}:${String(m).padStart(2, "0")} ${h >= 12 ? "PM" : "AM"}`;
}

/** An instant → its Malaysia time of day, "7:40 PM". */
export function clock12(d: Date | string | number): string {
  return hm12(mytTime(d));
}

/** A raw status ("PENDING_APPROVAL", "ai_approved", "rejected") → "Pending approval". */
export function sentence(raw: string | null | undefined): string {
  const s = String(raw ?? "").replace(/^ai_/i, "").replace(/_/g, " ").trim().toLowerCase();
  return s ? s.charAt(0).toUpperCase() + s.slice(1) : "";
}
