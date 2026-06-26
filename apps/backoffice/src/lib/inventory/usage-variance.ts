// Pure helpers for the ingredient usage-variance report.
//
// "Actual usage" is reconstructed from physical stock movements between two
// stock counts (count-bracketed):
//   actual = openingCount + receipts + transfersIn − transfersOut − wastage − closingCount
// "Expected usage" is theoretical: Σ(menu sales × BOM qty per ingredient).
// Variance = actual − expected → unexplained loss (over-portioning, theft,
// unrecorded spoilage). A positive variance means more left inventory than the
// recipes account for.
//
// CRITICAL: stock movements are recorded in MIXED units — receivings, transfers
// and counts carry a productPackageId and are in PACKAGE units; wastage
// (StockAdjustment) has no package and is already in BASE units. adjustStockBalance
// does NO conversion, so every consumer must normalise to base UOM itself. That
// is exactly what toBaseQty() does here, using ProductPackage.conversionFactor
// (base units per package unit).

export type VarianceFlag = "HIGH_VARIANCE" | "NO_COST" | "OVER_USED" | "UNDER_USED";

export type VarianceRow = {
  productId: string;
  productName: string;
  baseUom: string;
  actualQty: number;
  expectedQty: number;
  varianceQty: number;
  costPerBase: number;
  expectedCost: number;
  varianceCost: number;
  variancePercent: number | null;
  flags: VarianceFlag[];
};

// Convert a movement quantity to base UOM. A null packageId means the qty is
// already in base units (wastage, base-keyed balances). conv missing/≤0 → treat
// as already-base (1×) so we never multiply by garbage.
export function toBaseQty(
  qty: number,
  productPackageId: string | null | undefined,
  convByPackage: Map<string, number>,
): number {
  if (!productPackageId) return qty;
  const conv = convByPackage.get(productPackageId);
  return conv && conv > 0 ? qty * conv : qty;
}

export function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

// Flag thresholds: a variance worth a human's attention.
const HIGH_VARIANCE_PCT = 5; // |variance| ≥ 5% of expected cost
const HIGH_VARIANCE_RM = 20; // or ≥ RM 20 absolute

export function buildVarianceRow(input: {
  productId: string;
  productName: string;
  baseUom: string;
  actualQty: number;
  expectedQty: number;
  costPerBase: number;
}): VarianceRow {
  const actualQty = round2(input.actualQty);
  const expectedQty = round2(input.expectedQty);
  const varianceQty = round2(actualQty - expectedQty);
  const costPerBase = input.costPerBase;
  const expectedCost = round2(expectedQty * costPerBase);
  const varianceCost = round2(varianceQty * costPerBase);
  const variancePercent = expectedCost > 0 ? round2((varianceCost / expectedCost) * 100) : null;

  const flags: VarianceFlag[] = [];
  if (costPerBase <= 0) flags.push("NO_COST");
  if (Math.abs(varianceCost) >= HIGH_VARIANCE_RM || (variancePercent !== null && Math.abs(variancePercent) >= HIGH_VARIANCE_PCT)) {
    flags.push("HIGH_VARIANCE");
  }
  if (varianceQty > 0) flags.push("OVER_USED");
  else if (varianceQty < 0) flags.push("UNDER_USED");

  return {
    productId: input.productId,
    productName: input.productName,
    baseUom: input.baseUom,
    actualQty,
    expectedQty,
    varianceQty,
    costPerBase: round2(costPerBase),
    expectedCost,
    varianceCost,
    variancePercent,
    flags,
  };
}
