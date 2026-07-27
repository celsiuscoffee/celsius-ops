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

// ─── Count coverage (guard against short / partial submissions) ──────────────
//
// The submit/finalize endpoints trust the client's item list, and the only
// completeness check is "every loaded item has a countedQty". That cannot catch
// a count where products were never loaded onto the sheet at all — e.g. a
// "monthly" that counts 49 of the outlet's ~212 products and submits clean.
//
// evaluateCountCoverage compares what was counted against the outlet's expected
// universe for that frequency (its most recent completed count of the same
// frequency is the baseline). Per the owner's call (2026-07-15):
//   - MONTHLY below the floor → BLOCK (hard stop; a deliberate partial needs an
//     explicit reason at the call site).
//   - DAILY / WEEKLY below the floor → WARN (allow, but the caller routes it to
//     manager review instead of auto-approving). Those are intentionally small
//     and their size varies, so blocking would be noise.
// A first-ever count (no baseline) can't be judged and always passes.

export type CountFrequencyLike = "DAILY" | "WEEKLY" | "MONTHLY";

/** Default minimum share of the expected universe a count must cover. Monthly
 *  counts are historically very consistent (e.g. 254/254/255), so 0.85 leaves
 *  ample room for a few discontinued lines without letting a 23%-complete
 *  count (49/212) through. */
export const DEFAULT_MIN_COVERAGE = 0.85;

export interface CoverageInput {
  frequency: CountFrequencyLike;
  /** Products the outlet is expected to count at this frequency (baseline). */
  expectedProductIds: string[];
  /** Products actually counted in this submission (countedQty present). */
  countedProductIds: string[];
  /** Minimum fraction of the expected universe that must be counted. */
  minCoverage?: number;
}

export interface CoverageResult {
  expected: number; // size of the baseline universe (0 = nothing to judge against)
  counted: number; // expected products that were actually counted
  missing: number;
  coverage: number; // counted / expected, in [0,1]; 1 when there's no baseline
  missingProductIds: string[];
  belowFloor: boolean; // coverage under the floor AND a baseline existed
  block: boolean; // MONTHLY below floor → refuse unless an explicit override is given
  warn: boolean; // DAILY/WEEKLY below floor → allow but flag for review
}

export function evaluateCountCoverage(input: CoverageInput): CoverageResult {
  const min = input.minCoverage ?? DEFAULT_MIN_COVERAGE;
  const expectedSet = new Set(input.expectedProductIds);
  const countedSet = new Set(input.countedProductIds);
  const expected = expectedSet.size;

  // No baseline — first count of this frequency, or none reviewed yet. We have
  // nothing to measure against, so it passes (can't manufacture an expectation).
  if (expected === 0) {
    return {
      expected: 0,
      counted: countedSet.size,
      missing: 0,
      coverage: 1,
      missingProductIds: [],
      belowFloor: false,
      block: false,
      warn: false,
    };
  }

  const missingProductIds: string[] = [];
  for (const id of expectedSet) if (!countedSet.has(id)) missingProductIds.push(id);
  const counted = expected - missingProductIds.length;
  const coverage = counted / expected;
  const belowFloor = coverage < min;

  return {
    expected,
    counted,
    missing: missingProductIds.length,
    coverage,
    missingProductIds,
    belowFloor,
    block: belowFloor && input.frequency === "MONTHLY",
    warn: belowFloor && input.frequency !== "MONTHLY",
  };
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
