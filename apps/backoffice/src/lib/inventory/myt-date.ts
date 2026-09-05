// Business-timezone (Asia/Kuala_Lumpur, UTC+8, no DST) calendar-day helpers.
// Pure — no DB imports — so report routes and agents can share ONE definition
// of "which MYT day is this instant on" instead of each comparing raw
// timestamps against 00:00 UTC.

const MYT_OFFSET_MS = 8 * 60 * 60 * 1000;
const YMD_RE = /^\d{4}-\d{2}-\d{2}$/;

/** YYYY-MM-DD of the MYT calendar day an instant falls on. */
export function mytYmd(d: Date): string {
  return new Date(d.getTime() + MYT_OFFSET_MS).toISOString().slice(0, 10);
}

/** Today's MYT calendar day as YYYY-MM-DD. */
export function todayMyt(now: Date = new Date()): string {
  return mytYmd(now);
}

/** First instant (UTC) of a MYT calendar day. */
export function mytDayStart(ymd: string): Date {
  return new Date(`${ymd}T00:00:00+08:00`);
}

/** Last instant (UTC, ms precision) of a MYT calendar day. */
export function mytDayEnd(ymd: string): Date {
  return new Date(`${ymd}T23:59:59.999+08:00`);
}

/**
 * Parse a report-range query param. A bare YYYY-MM-DD is treated as a whole
 * MYT day (start or end of it, per `edge`); a full ISO timestamp is used as-is.
 * Returns null for unparseable input so callers can fall back to a default.
 */
export function parseMytRangeParam(raw: string | null | undefined, edge: "start" | "end"): Date | null {
  if (!raw) return null;
  const s = raw.trim();
  if (YMD_RE.test(s)) return edge === "start" ? mytDayStart(s) : mytDayEnd(s);
  const d = new Date(s);
  return Number.isNaN(d.getTime()) ? null : d;
}

/**
 * Supplier on-time test: delivered on or before the promised calendar day, in
 * MYT. Comparing `receivedAt <= deliveryDate` as timestamps was wrong because
 * deliveryDate is stored as a date (midnight) — every afternoon delivery on the
 * promised day counted as late.
 */
export function isOnTimeDelivery(receivedAt: Date, deliveryDate: Date): boolean {
  return mytYmd(receivedAt) <= mytYmd(deliveryDate);
}

/** True when the MYT day `ymd` is today or in the future (i.e. not yet closed). */
export function isOpenMytDay(ymd: string, now: Date = new Date()): boolean {
  return ymd >= todayMyt(now);
}
