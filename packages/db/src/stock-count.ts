/**
 * Stock-count review helpers — shared by the staff and backoffice apps so the
 * single rule "what counts as a discrepancy" lives in exactly one place.
 *
 * A count auto-approves when it has zero discrepancies — i.e. it would show
 * "All OK" in the backoffice review list. Only counts with a real variance
 * land in the manager's review queue.
 */

type QtyLike = number | string | { toString(): string } | null | undefined;

function toNum(v: QtyLike): number | null {
  if (v === null || v === undefined) return null;
  const n = typeof v === "number" ? v : Number(v.toString());
  return Number.isFinite(n) ? n : null;
}

export interface VarianceItem {
  expectedQty: QtyLike;
  countedQty: QtyLike;
}

/**
 * Number of items that were counted, have a known expected quantity, and
 * differ from it. Mirrors the backoffice "Discrepancies" column exactly:
 * an item with no expected baseline (expectedQty == null) cannot be flagged.
 */
export function countDiscrepancies(items: VarianceItem[]): number {
  let n = 0;
  for (const it of items) {
    const expected = toNum(it.expectedQty);
    const counted = toNum(it.countedQty);
    if (expected === null || counted === null) continue; // no baseline → can't flag
    if (counted !== expected) n++;
  }
  return n;
}

/**
 * A count is "clean" — and therefore safe to auto-approve — when nothing flags
 * as a discrepancy. A count with no expected baseline has zero discrepancies,
 * so it auto-approves, matching today's "All OK" behaviour.
 */
export function isCleanCount(items: VarianceItem[]): boolean {
  return countDiscrepancies(items) === 0;
}
