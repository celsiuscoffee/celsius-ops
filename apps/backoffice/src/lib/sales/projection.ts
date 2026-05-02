// Projection compute for the sales/compare page. Two improvements over the
// old `simple_avg × total_days` formula:
//
//   1. Day-of-Week (DOW) averaging: each remaining day in the period is
//      projected using the average revenue/orders of the SAME day-of-week
//      from the last 4 weeks. F&B has strong weekly cycles (Saturday is
//      ~2× Monday in coffee chains) so flat averaging blends them away.
//
//   2. Cold-start blend: when fewer than 3 completed days exist, blend
//      the live trajectory with last month's same date-range revenue.
//      Day 1: 70% history / 30% live. Day 7+: 100% live.
//
// Reads from the local SalesTransaction table — no StoreHub round-trip,
// keeps the compare endpoint snappy.

import { prisma } from "@/lib/prisma";

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
  const d = new Date(s + "T00:00:00.000Z");
  return d;
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

/** Day-of-week index in MYT: 0 = Sun, 6 = Sat. */
function mytDow(d: Date): number {
  // Add 8h so a UTC midnight maps to MYT 08:00, then read getUTCDay.
  // SalesTransaction.transactedAt is stored UTC; the chain's day-of-week
  // is the MYT calendar day, not UTC.
  const myt = new Date(d.getTime() + 8 * 60 * 60 * 1000);
  return myt.getUTCDay();
}

/**
 * Shift a date by `delta` calendar months, clamping the day to the last
 * valid day of the target month. Avoids JS's `setUTCMonth` rollover where
 * "April 31" silently becomes May 1 — which would leak the current month
 * into the prior-period window.
 */
function shiftMonth(d: Date, delta: number): Date {
  const y = d.getUTCFullYear();
  const m = d.getUTCMonth() + delta;
  const day = d.getUTCDate();
  // Day 0 of next month = last day of target month.
  const lastDayOfTarget = new Date(Date.UTC(y, m + 1, 0)).getUTCDate();
  return new Date(Date.UTC(y, m, Math.min(day, lastDayOfTarget)));
}

/**
 * Compute a DOW-aware projection for a period.
 *
 * Returns null if today is outside the period (no projection needed) or
 * if the period has zero historical reference (clean install).
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
  // Period in the past or future entirely → nothing to project.
  if (today < fromD || today > toD) return null;

  const totalDays = daysBetween(fromD, toD);
  // Days "elapsed" includes today (the current in-progress day). Completed
  // days = days strictly before today.
  const daysElapsed = daysBetween(fromD, today);
  const completedCount = Math.max(0, daysElapsed - 1);
  if (daysElapsed >= totalDays) return null; // period already over

  // ── 1. Pull completed-day revenue from local SalesTransaction ──────────
  // (period start → yesterday inclusive)
  const completedTxns = completedCount > 0 ? await prisma.salesTransaction.findMany({
    where: {
      outletId: { in: outletIds },
      transactedAt: { gte: fromD, lt: today },
    },
    select: { grossAmount: true, quantity: true, transactedAt: true },
  }) : [];

  // Pull today's in-progress transactions separately so the live signal
  // can floor today's projection (we won't project less than what's
  // already booked).
  const tomorrow = addDays(today, 1);
  const todayTxns = await prisma.salesTransaction.findMany({
    where: {
      outletId: { in: outletIds },
      transactedAt: { gte: today, lt: tomorrow },
    },
    select: { grossAmount: true, quantity: true },
  });
  const todayActualRev = todayTxns.reduce((s, t) => s + Number(t.grossAmount), 0);
  const todayActualOrd = todayTxns.reduce((s, t) => s + t.quantity, 0);

  let completedRev = 0;
  let completedOrd = 0;
  // Group by MYT calendar date so partial-day transactions land correctly.
  const completedDailyRev = new Map<string, number>();
  const completedDailyOrd = new Map<string, number>();
  for (const t of completedTxns) {
    completedRev += Number(t.grossAmount);
    completedOrd += t.quantity;
    const dateKey = fmtISODate(new Date(t.transactedAt.getTime() + 8 * 60 * 60 * 1000));
    completedDailyRev.set(dateKey, (completedDailyRev.get(dateKey) ?? 0) + Number(t.grossAmount));
    completedDailyOrd.set(dateKey, (completedDailyOrd.get(dateKey) ?? 0) + t.quantity);
  }

  // ── 2. DOW averages from the 28 days BEFORE the period started ─────────
  const dowWindowStart = addDays(fromD, -28);
  const dowTxns = await prisma.salesTransaction.findMany({
    where: {
      outletId: { in: outletIds },
      transactedAt: { gte: dowWindowStart, lt: fromD },
    },
    select: { grossAmount: true, quantity: true, transactedAt: true },
  });

  // Build per-day totals first, then average per DOW. Doing it on the
  // already-bucketed daily totals (rather than averaging per-transaction)
  // is important: a busy day shouldn't outweigh a quiet day just because
  // it has more rows.
  const dowDayMap = new Map<string, { rev: number; ord: number; dow: number }>();
  for (const t of dowTxns) {
    const myt = new Date(t.transactedAt.getTime() + 8 * 60 * 60 * 1000);
    const dateKey = fmtISODate(myt);
    const dow = myt.getUTCDay();
    const cur = dowDayMap.get(dateKey) ?? { rev: 0, ord: 0, dow };
    cur.rev += Number(t.grossAmount);
    cur.ord += t.quantity;
    dowDayMap.set(dateKey, cur);
  }
  const dowSumRev = new Array(7).fill(0);
  const dowSumOrd = new Array(7).fill(0);
  const dowCount = new Array(7).fill(0);
  for (const day of dowDayMap.values()) {
    dowSumRev[day.dow] += day.rev;
    dowSumOrd[day.dow] += day.ord;
    dowCount[day.dow] += 1;
  }
  const dowAvgRev = dowSumRev.map((s, i) => (dowCount[i] > 0 ? s / dowCount[i] : 0));
  const dowAvgOrd = dowSumOrd.map((s, i) => (dowCount[i] > 0 ? s / dowCount[i] : 0));
  const hasDowData = dowCount.some((c) => c > 0);

  // ── 3. Cold-start anchor: same day-range, prior month ─────────────────
  // Used to dampen extreme day-1 projections. Falls back gracefully if no
  // history exists (new outlet, new product launch, etc.).
  // shiftMonth clamps day-of-month so May 31 → April 30 (not May 1 via
  // JS's setUTCMonth rollover, which would leak the current month into
  // the prior window).
  const priorFrom = shiftMonth(fromD, -1);
  const priorTo = shiftMonth(toD, -1);
  const priorTxns = await prisma.salesTransaction.findMany({
    where: {
      outletId: { in: outletIds },
      transactedAt: { gte: priorFrom, lt: addDays(priorTo, 1) },
    },
    select: { grossAmount: true, quantity: true },
  });
  const priorRev = priorTxns.reduce((s, t) => s + Number(t.grossAmount), 0);
  const priorOrd = priorTxns.reduce((s, t) => s + t.quantity, 0);

  // ── 4. Project remaining days ──────────────────────────────────────────
  // For each remaining day, project using DOW avg if we have it; else fall
  // back to overall completed-day mean. Today is in-progress, so it sits
  // at the start of this loop (i = daysElapsed - 1) and is special-cased:
  // we floor today at actual-so-far so the live signal can't be ignored
  // when it's already exceeded the DOW average.
  let remainRev = 0;
  let remainOrd = 0;
  const fallbackRev = completedCount > 0 ? completedRev / completedCount : 0;
  const fallbackOrd = completedCount > 0 ? completedOrd / completedCount : 0;
  for (let i = daysElapsed - 1; i < totalDays; i++) {
    const day = addDays(fromD, i); // 0-indexed offset from period start
    const dow = mytDow(day);
    let dRev = hasDowData && dowCount[dow] > 0 ? dowAvgRev[dow] : fallbackRev;
    let dOrd = hasDowData && dowCount[dow] > 0 ? dowAvgOrd[dow] : fallbackOrd;
    if (i === daysElapsed - 1) {
      // Today (partial). Use whichever is larger: DOW avg or actual-so-far.
      dRev = Math.max(dRev, todayActualRev);
      dOrd = Math.max(dOrd, todayActualOrd);
    }
    remainRev += dRev;
    remainOrd += dOrd;
  }

  // ── 5. Cold-start blend ────────────────────────────────────────────────
  // When < 3 completed days, the live signal is too thin. Blend toward
  // last-month's actual revenue so day-1 is sane. Weight shifts linearly:
  // day 1 → 0.3 live / 0.7 prior; day 7+ → 1.0 live / 0.0 prior.
  let projected = completedRev + remainRev;
  let projectedOrders = completedOrd + remainOrd;
  let method = hasDowData ? "DOW × 4w" : `${completedCount}d avg`;

  if (completedCount < 3 && priorRev > 0) {
    const liveWeight = Math.min(1, completedCount / 7); // 0/7 → 1/7 → 2/7
    const priorWeight = 1 - liveWeight;
    projected = projected * liveWeight + priorRev * priorWeight;
    projectedOrders = projectedOrders * liveWeight + priorOrd * priorWeight;
    method = `blend (${Math.round(liveWeight * 100)}% live · ${Math.round(priorWeight * 100)}% prior)`;
  }

  return {
    projected: Math.round(projected * 100) / 100,
    projectedOrders: Math.round(projectedOrders),
    daysElapsed,
    totalDays,
    method,
  };
}
