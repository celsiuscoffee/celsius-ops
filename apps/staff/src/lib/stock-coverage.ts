import {
  evaluateCountCoverage,
  type CoverageResult,
  type CountFrequencyLike,
} from "@celsius/db";
import { prisma } from "./prisma";

/**
 * The set of products an outlet is expected to count at a given frequency,
 * derived from its most recent COMPLETED count of the same frequency. This is
 * the interim source of truth until `OutletProduct` (which carries a per-product
 * `countFrequency`) is backfilled — at which point this should read that table
 * instead so client and server share one authoritative universe.
 *
 * Keyed on frequency so a daily count (small by design) is never judged against
 * the monthly census. Excludes the count being finalized itself.
 *
 * Uses the FULLEST recent COMPLETED (REVIEWED) count as the baseline, not merely
 * the most recent — so a short count that previously slipped through can't shrink
 * the expected universe for the next one. Only REVIEWED counts qualify (a pending
 * SUBMITTED one could itself be short and unreviewed).
 */
export async function getExpectedProductIds(
  outletId: string,
  frequency: CountFrequencyLike,
  excludeStockCountId?: string,
): Promise<string[]> {
  const recent = await prisma.stockCount.findMany({
    where: {
      outletId,
      frequency,
      status: "REVIEWED",
      ...(excludeStockCountId ? { id: { not: excludeStockCountId } } : {}),
    },
    orderBy: { countDate: "desc" },
    take: 6,
    select: { items: { select: { productId: true } } },
  });
  if (recent.length === 0) return [];

  // The fullest recent census wins.
  let best: Set<string> = new Set();
  for (const c of recent) {
    const ids = new Set(c.items.map((i) => i.productId));
    if (ids.size > best.size) best = ids;
  }
  return [...best];
}

export interface CoverageCheck extends CoverageResult {
  /** A short human-readable note to stamp on a below-floor count for review. */
  shortNote: string;
}

/**
 * Compute coverage for a count about to be submitted/finalized. `countedItems`
 * are the count's items; only those with a non-null countedQty are treated as
 * actually counted.
 */
export async function checkCountCoverage(args: {
  outletId: string;
  frequency: CountFrequencyLike;
  countedItems: Array<{ productId: string; countedQty: unknown }>;
  excludeStockCountId?: string;
}): Promise<CoverageCheck> {
  const expectedProductIds = await getExpectedProductIds(
    args.outletId,
    args.frequency,
    args.excludeStockCountId,
  );
  const countedProductIds = args.countedItems
    .filter((i) => i.countedQty != null)
    .map((i) => i.productId);

  const result = evaluateCountCoverage({
    frequency: args.frequency,
    expectedProductIds,
    countedProductIds,
  });

  return {
    ...result,
    shortNote: `[short count: ${result.counted}/${result.expected} products counted]`,
  };
}
