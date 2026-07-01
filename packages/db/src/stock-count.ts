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

export interface CountedLine {
  productId: string;
  /** Quantity as physically counted — in the *package's* units, not base UOM. */
  countedQty: QtyLike;
  /**
   * The counted package's conversion factor (base-UOM units per package). A
   * missing/invalid/≤0 factor is treated as 1 (item counted directly in its
   * base UOM, or an un-packaged item).
   */
  conversionFactor?: QtyLike;
}

/**
 * Convert counted lines into base-UOM totals per product.
 *
 * Staff count in whatever package they physically handle ("22 packets"), but
 * StockBalance is tracked in the product's base UOM (see the wastage/inventory
 * routes: "Stock is tracked in product baseUom"). Each line must therefore be
 * multiplied by its package conversionFactor before it lands in a balance —
 * skipping this stored 22 base units for "22 packets" instead of 22 × pack size.
 *
 * Lines with a null countedQty are ignored (not yet counted). Multiple lines
 * for the same product — e.g. the same item counted in two packages — are
 * summed, so the result is the product's full on-hand in base UOM.
 */
export function baseQtyByProduct(lines: CountedLine[]): Map<string, number> {
  const totals = new Map<string, number>();
  for (const line of lines) {
    const counted = toNum(line.countedQty);
    if (counted === null) continue;
    const cf = toNum(line.conversionFactor);
    const factor = cf === null || cf <= 0 ? 1 : cf;
    totals.set(line.productId, (totals.get(line.productId) ?? 0) + counted * factor);
  }
  return totals;
}
