// Projection compute for the sales/compare page.
//
// Formula: 7-day moving average × total days in the period.
//
// The MA window is the 7 calendar days ending yesterday (MYT), independent
// of where we are in the period. So a monthly card always projects the
// same way whether we're on day 2 or day 25, and the result reads as the
// straightforward "if the last week keeps repeating, this is the month".
//
// The projection is floored at what's already been booked in the period
// (including today's partial day), so it can never read lower than reality.
//
// Reads from the unified_sales VIEW — the canonical estate-wide sales source
// (hubbo + StoreHub + pos-native + pickup + consignment), applying the
// standard revenue convention (NOT is_refund AND status <> 'paymentCancelled').
// The previous source, SalesTransaction, is a dead sync (no rows after
// 2026-04-11) — it silently returned null and disabled the server projection.

import { prisma } from "@/lib/prisma";
import { Prisma } from "@prisma/client";

export type ProjectionResult = {
  projected: number;
  projectedOrders: number;
  daysElapsed: number;
  totalDays: number;
  method: string;
};

/** Get today's date in MYT (Malaysia / UTC+8). */
function getMYTToday(): Date {
  const now = new Date();
  const myt = new Date(now.getTime() + 8 * 60 * 60 * 1000);
  myt.setUTCHours(0, 0, 0, 0);
  return myt;
}

/** Convert "YYYY-MM-DD" to a UTC midnight Date. */
function parseISODate(s: string): Date {
  return new Date(s + "T00:00:00.000Z");
}

/** Format a Date as "YYYY-MM-DD" (UTC). */
function fmtISODate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

/** Days between two UTC dates, inclusive of both ends. */
function daysBetween(a: Date, b: Date): number {
  return Math.round((b.getTime() - a.getTime()) / 86400000) + 1;
}

/** Add `n` days to a UTC date, returning a new Date. */
function addDays(d: Date, n: number): Date {
  const out = new Date(d);
  out.setUTCDate(out.getUTCDate() + n);
  return out;
}

/** Per-day revenue/orders from the unified_sales view, [from, to] inclusive
 *  (MYT business dates — biz_date is pre-computed in the view). Consignment
 *  rows are daily settlements with no receipt count, so their "orders" use
 *  the day's item_count — same convention as the compare aggregation. */
async function unifiedDailySeries(
  outletIds: string[],
  fromDate: string,
  toDate: string,
): Promise<Map<string, { revenue: number; orders: number }>> {
  const rows = await prisma.$queryRaw<Array<{ d: Date; rev: unknown; ord: unknown }>>`
    SELECT biz_date AS d,
           SUM(nett) AS rev,
           SUM(CASE WHEN source = 'consignment' THEN COALESCE(item_count, 0) ELSE 1 END) AS ord
    FROM unified_sales
    WHERE outlet_id IN (${Prisma.join(outletIds)})
      AND NOT is_refund
      AND (status IS NULL OR status <> 'paymentCancelled')
      AND biz_date >= ${fromDate}::date
      AND biz_date <= ${toDate}::date
    GROUP BY biz_date
  `;
  const out = new Map<string, { revenue: number; orders: number }>();
  for (const r of rows) {
    out.set(fmtISODate(r.d), { revenue: Number(r.rev) || 0, orders: Number(r.ord) || 0 });
  }
  return out;
}

/**
 * Compute a 7-day-MA projection for a period. Returns null when today is
 * outside the period or when there is no MA history to work with.
 */
export async function computeProjection(opts: {
  from: string; // "YYYY-MM-DD" (period start, inclusive)
  to: string;   // "YYYY-MM-DD" (period end, inclusive)
  outletIds: string[];
}): Promise<ProjectionResult | null> {
  const { from, to, outletIds } = opts;
  if (!outletIds.length) return null;

  const today = getMYTToday();
  const fromD = parseISODate(from);
  const toD = parseISODate(to);
  if (today < fromD || today > toD) return null;

  const totalDays = daysBetween(fromD, toD);
  const daysElapsed = daysBetween(fromD, today);
  if (daysElapsed > totalDays) return null;

  // ── 1. 7-day moving average (today-7 → yesterday in MYT) ────────────────
  const maDays = await unifiedDailySeries(
    outletIds,
    fmtISODate(addDays(today, -7)),
    fmtISODate(addDays(today, -1)),
  );

  // Average over distinct trading days, not transaction count — a busy
  // Saturday shouldn't outweigh a quiet Monday just because it has more rows.
  const dayCount = maDays.size;
  if (dayCount === 0) return null;

  let sumRev = 0;
  let sumOrd = 0;
  for (const d of maDays.values()) {
    sumRev += d.revenue;
    sumOrd += d.orders;
  }
  const avgRev = sumRev / dayCount;
  const avgOrd = sumOrd / dayCount;

  let projected = avgRev * totalDays;
  let projectedOrders = avgOrd * totalDays;

  // ── 2. Floor at booked-so-far ──────────────────────────────────────────
  // The MA window can sit entirely before the period (e.g., on day 2 of a
  // month following a hot weekend). If actuals already exceed the MA
  // projection, use the actuals — projection should never read lower than
  // what's in the till.
  const periodDays = await unifiedDailySeries(outletIds, from, fmtISODate(today));
  let periodRev = 0;
  let periodOrd = 0;
  for (const d of periodDays.values()) {
    periodRev += d.revenue;
    periodOrd += d.orders;
  }
  projected = Math.max(projected, periodRev);
  projectedOrders = Math.max(projectedOrders, periodOrd);

  return {
    projected: Math.round(projected * 100) / 100,
    projectedOrders: Math.round(projectedOrders),
    daysElapsed,
    totalDays,
    method: `${dayCount}d MA × ${totalDays}d`,
  };
}
