// Order-level (per-trip) validation for supplier purchase orders.
//
// The reorder engine already enforces per-LINE minimums (SupplierProduct.moq, a
// quantity floor per product). This covers the per-ORDER constraints that 17
// real supplier chats showed drive the "add more / which day / too late for
// today's lorry" loops (docs/design/procurement-chat-learnings.md, P1):
//   - trip MOQ: a ringgit minimum per delivery (Supplier.moq, free text like
//     "RM300" / "trip min RM500"); below it, the supplier asks us to top up.
//   - delivery calendar: fixed per-supplier delivery days + lead time, so a
//     planned date that isn't a delivery day gets bumped.
//
// Pure + deterministic so it unit-tests cleanly and can run anywhere (reorder
// cron, PO draft API, supplier-chat agent context). Dates are compared in UTC —
// callers pass a UTC-midnight Date representing the intended local (MYT) day.

export type OrderWarningCode = "BELOW_MOQ" | "DELIVERY_DAY";

export type OrderWarning = {
  code: OrderWarningCode;
  severity: "warn" | "info";
  message: string;
  meta?: Record<string, unknown>;
};

export const WEEKDAYS = [
  "Sunday",
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday",
] as const;

/**
 * Pull a ringgit minimum out of a free-text MOQ field. Handles "RM300",
 * "rm 1,000", "trip min RM500", "min order 250". Prefers an RM-prefixed number;
 * falls back to the first bare number. Returns null when there's no number
 * (e.g. "no MOQ", "", "by arrangement").
 */
export function parseMoqRm(moq: string | null | undefined): number | null {
  if (!moq) return null;
  const text = moq.trim();
  if (!text) return null;
  // Prefer a number that follows RM / MYR.
  const rmMatch = text.match(/(?:rm|myr)\s*([\d,]+(?:\.\d+)?)/i);
  const bareMatch = rmMatch ? null : text.match(/([\d,]+(?:\.\d+)?)/);
  const raw = (rmMatch ?? bareMatch)?.[1];
  if (!raw) return null;
  const n = Number(raw.replace(/,/g, ""));
  return Number.isFinite(n) && n > 0 ? n : null;
}

/** Normalise a delivery-day list to canonical weekday names we recognise. */
function normaliseDays(deliveryDays: string[]): Set<number> {
  const set = new Set<number>();
  for (const d of deliveryDays) {
    const key = d.trim().toLowerCase();
    const idx = WEEKDAYS.findIndex((w) => w.toLowerCase() === key || w.toLowerCase().startsWith(key.slice(0, 3)));
    if (idx >= 0) set.add(idx);
  }
  return set;
}

/**
 * Earliest delivery date on/after `from + leadTimeDays` whose weekday is one of
 * the supplier's delivery days. Returns null when no delivery days are
 * configured (the supplier delivers on demand). Searches a two-week window.
 */
export function nextDeliveryDate(
  deliveryDays: string[],
  leadTimeDays: number,
  from: Date,
): Date | null {
  const days = normaliseDays(deliveryDays);
  if (days.size === 0) return null;
  const start = new Date(from.getTime() + Math.max(0, leadTimeDays) * 86_400_000);
  for (let i = 0; i < 14; i++) {
    const d = new Date(start.getTime() + i * 86_400_000);
    if (days.has(d.getUTCDay())) return d;
  }
  return null;
}

function ymd(d: Date): string {
  return d.toISOString().slice(0, 10);
}

/**
 * Validate a drafted supplier order against its trip MOQ and delivery calendar.
 * Returns the warnings a human (or the approval message) should see — empty when
 * everything lines up.
 */
export function validateSupplierOrder(input: {
  orderTotal: number;
  moq?: string | null;
  deliveryDays: string[];
  deliveryDate?: Date | null; // planned delivery date (UTC-midnight = the MYT day)
}): OrderWarning[] {
  const warnings: OrderWarning[] = [];

  // ── Trip MOQ ──
  const moqRm = parseMoqRm(input.moq);
  if (moqRm != null && input.orderTotal > 0 && input.orderTotal < moqRm) {
    const shortfall = Math.round((moqRm - input.orderTotal) * 100) / 100;
    warnings.push({
      code: "BELOW_MOQ",
      severity: "warn",
      message: `Order RM ${input.orderTotal.toFixed(2)} is below this supplier's MOQ RM ${moqRm.toFixed(2)} — add RM ${shortfall.toFixed(2)} to avoid a top-up request.`,
      meta: { orderTotal: input.orderTotal, moq: moqRm, shortfall },
    });
  }

  // ── Delivery calendar ──
  // Only meaningful when the supplier has fixed delivery days AND a date is
  // planned that falls outside them. The suggestion is the next valid delivery
  // day ON OR AFTER the planned date (lead time 0 — this is a calendar fix, not
  // a reorder-timing decision).
  const days = normaliseDays(input.deliveryDays);
  const planned = input.deliveryDate ?? null;
  if (days.size > 0 && planned && !days.has(planned.getUTCDay())) {
    const suggested = nextDeliveryDate(input.deliveryDays, 0, planned);
    warnings.push({
      code: "DELIVERY_DAY",
      severity: "warn",
      message: `Planned delivery ${WEEKDAYS[planned.getUTCDay()]} (${ymd(planned)}) isn't one of this supplier's delivery days (${input.deliveryDays.join(", ")})${suggested ? `; next is ${WEEKDAYS[suggested.getUTCDay()]} ${ymd(suggested)}` : ""}.`,
      meta: { planned: ymd(planned), suggested: suggested ? ymd(suggested) : null, deliveryDays: input.deliveryDays },
    });
  }

  return warnings;
}
