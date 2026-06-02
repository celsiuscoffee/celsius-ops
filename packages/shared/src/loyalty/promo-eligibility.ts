/**
 * Canonical "is this promotion live right now?" schedule gate.
 *
 * This is the single source of truth for a promotion's date-window /
 * day-of-week / time-of-day eligibility, shared by:
 *   • the rewards engine (apps/loyalty promotions.ts `isPromoEligible`), which
 *     decides what actually discounts a cart, and
 *   • the POS pairing-suggestions endpoint (apps/backoffice suggest-pairs),
 *     which decides what combo badge to show.
 *
 * Keeping it in one place means a "RM2 off, 8–10am" combo can never be
 * advertised by suggestions at a time the engine won't honour it.
 *
 * Time-of-day / day-of-week comparisons run in MYT (Malaysia, UTC+8, no DST):
 * promos like "Breakfast combo 8–10am" are authored in local time, and the
 * evaluator runs on Vercel (UTC). We shift `now` by +8h and read it with UTC
 * accessors so we don't get double-shifted by the host timezone.
 */
export interface PromoSchedule {
  valid_from?: string | null;
  valid_until?: string | null;
  /** 0–6, Sun–Sat (MYT). Empty/absent = every day. */
  day_of_week?: number[] | null;
  /** "HH:MM:SS" local (MYT). Both start and end must be set to gate by time. */
  time_start?: string | null;
  time_end?: string | null;
}

export function isPromoLiveNow(p: PromoSchedule, now: Date = new Date()): boolean {
  if (p.valid_from && new Date(p.valid_from) > now) return false;
  if (p.valid_until && new Date(p.valid_until) < now) return false;

  const myt = new Date(now.getTime() + 8 * 60 * 60 * 1000);

  const dow = p.day_of_week ?? [];
  if (dow.length > 0 && !dow.includes(myt.getUTCDay())) return false;

  if (p.time_start && p.time_end) {
    const hhmm = `${String(myt.getUTCHours()).padStart(2, "0")}:${String(myt.getUTCMinutes()).padStart(2, "0")}:00`;
    if (hhmm < p.time_start || hhmm > p.time_end) return false;
  }

  return true;
}
