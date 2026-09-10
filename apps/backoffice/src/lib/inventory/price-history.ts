import { prisma } from "@/lib/prisma";

// Records a supplier price change into PriceHistory.
//
// The PriceHistory table existed in the schema but was never written, so the
// Supplier Scorecard's "price changes" metric was always empty and the
// reconciliation/agent price-increase checks had no baseline. This is the
// single write path: call it whenever a SupplierProduct.price is updated,
// passing the price BEFORE the update. No-ops when the price is unchanged.
//
// Returns `true` when history is consistent with the update (row written, or
// nothing to record), `false` when the insert FAILED. The price update itself
// must still go through — history is telemetry — but callers surface the flag
// as `priceHistoryWritten: false` so a silent gap in the scorecard baseline is
// visible instead of being swallowed into a warn log nobody reads.
export async function recordPriceChange(input: {
  supplierId: string;
  productId: string;
  productPackageId?: string | null;
  oldPrice: number;
  newPrice: number;
}): Promise<boolean> {
  const { supplierId, productId } = input;
  const oldPrice = Number(input.oldPrice);
  const newPrice = Number(input.newPrice);
  // Nothing to record on first-time pricing or an unchanged value.
  if (!Number.isFinite(oldPrice) || !Number.isFinite(newPrice)) return true;
  if (Math.abs(newPrice - oldPrice) < 0.0001) return true;

  // % change vs the old price; guard divide-by-zero (old price of 0 → 100%).
  const changePercent =
    oldPrice === 0 ? 100 : Math.round(((newPrice - oldPrice) / oldPrice) * 100 * 100) / 100;

  try {
    await prisma.priceHistory.create({
      data: {
        supplierId,
        productId,
        productPackageId: input.productPackageId ?? null,
        oldPrice,
        newPrice,
        changePercent,
      },
    });
    return true;
  } catch (e) {
    console.error("[price-history] record FAILED", {
      supplierId,
      productId,
      productPackageId: input.productPackageId ?? null,
      oldPrice,
      newPrice,
      changePercent,
      error: e instanceof Error ? e.message : String(e),
    });
    return false;
  }
}
