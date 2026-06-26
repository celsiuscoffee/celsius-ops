import { prisma } from "@/lib/prisma";

// Records a supplier price change into PriceHistory.
//
// The PriceHistory table existed in the schema but was never written, so the
// Supplier Scorecard's "price changes" metric was always empty and the
// reconciliation/agent price-increase checks had no baseline. This is the
// single write path: call it whenever a SupplierProduct.price is updated,
// passing the price BEFORE the update. No-ops when the price is unchanged.
export async function recordPriceChange(input: {
  supplierId: string;
  productId: string;
  productPackageId?: string | null;
  oldPrice: number;
  newPrice: number;
}): Promise<void> {
  const { supplierId, productId } = input;
  const oldPrice = Number(input.oldPrice);
  const newPrice = Number(input.newPrice);
  // Nothing to record on first-time pricing or an unchanged value.
  if (!Number.isFinite(oldPrice) || !Number.isFinite(newPrice)) return;
  if (Math.abs(newPrice - oldPrice) < 0.0001) return;

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
  } catch (e) {
    // Price history is best-effort telemetry — never fail the price update over it.
    console.warn("[price-history] record failed:", e instanceof Error ? e.message : e);
  }
}
