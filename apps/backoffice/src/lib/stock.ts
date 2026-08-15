import { prisma } from "./prisma";

/**
 * Update stock balance for a product+package at an outlet.
 *
 * @param outletId - Outlet ID
 * @param productId - Product ID
 * @param delta - Positive to add stock, negative to subtract
 * @param productPackageId - Optional package ID (tracks stock per SKU)
 */
export async function adjustStockBalance(
  outletId: string,
  productId: string,
  delta: number,
  productPackageId?: string | null,
) {
  const pkgId = productPackageId ?? null;

  const existing = await prisma.stockBalance.findFirst({
    where: { outletId, productId, productPackageId: pkgId },
  });

  if (existing) {
    await prisma.stockBalance.update({
      where: { id: existing.id },
      data: {
        quantity: { increment: delta },
        lastUpdated: new Date(),
      },
    });
  } else {
    await prisma.stockBalance.create({
      data: {
        outletId,
        productId,
        productPackageId: pkgId,
        quantity: Math.max(0, delta),
        lastUpdated: new Date(),
      },
    });
  }

  // Clamp to zero (stock can't go negative)
  await prisma.stockBalance.updateMany({
    where: {
      outletId,
      productId,
      productPackageId: pkgId,
      quantity: { lt: 0 },
    },
    data: { quantity: 0 },
  });
}

/**
 * Set stock balance to an absolute value (used by stock counts).
 */
export async function setStockBalance(
  outletId: string,
  productId: string,
  quantity: number,
  productPackageId?: string | null,
) {
  const pkgId = productPackageId ?? null;

  const existing = await prisma.stockBalance.findFirst({
    where: { outletId, productId, productPackageId: pkgId },
  });

  if (existing) {
    await prisma.stockBalance.update({
      where: { id: existing.id },
      data: {
        quantity: Math.max(0, quantity),
        lastUpdated: new Date(),
      },
    });
  } else {
    await prisma.stockBalance.create({
      data: {
        outletId,
        productId,
        productPackageId: pkgId,
        quantity: Math.max(0, quantity),
        lastUpdated: new Date(),
      },
    });
  }
}

/**
 * Credit received goods to stock, converting package units to base UOM.
 *
 * Goods are received in whatever package was purchased ("2 packs of butter"),
 * but StockBalance is tracked in the product's base UOM everywhere else —
 * receiving, wastage, stock counts, par levels. Two rules therefore apply to
 * every receipt, and Pay & Claim was honouring neither:
 *
 *   1. multiply by the package's conversionFactor (2 packs x 250g = 500g), and
 *   2. write the CANONICAL per-product row (productPackageId = null).
 *
 * Writing a per-package row instead is doubly wrong: the inventory reader sums
 * across rows, so the same goods are counted twice, and the canonical row never
 * receives the stock at all — so a Pay & Claim purchase was effectively
 * invisible to par levels and reorder. (Observed 2026-08-02: 13 Pay & Claim
 * receipts created 33 orphan package rows; e.g. 17 packs of shimeji = 2,125g
 * sat on a package row while the real balance read zero.)
 *
 * Mirrors the conversion the main receivings route already does.
 */
export interface PackageLine {
  productId: string;
  productPackageId?: string | null;
  /** Quantity in PACKAGE units. Negative for a debit (transfer out, cancel). */
  quantity: number;
}

/**
 * Pure part of the conversion: package-unit lines + factors → base-UOM totals
 * per product. Split out so the arithmetic is testable without a database.
 *
 * A line with no package (or an unknown/invalid factor) is treated as already
 * being in base units — factor 1. Lines for the same product are summed, since
 * they must all land on the single canonical balance row.
 *
 * On RECEIPT paths that factor-1 fallback is no longer where an unrecorded
 * package lands: `guardReceiptPackages` runs upstream and either resolves the
 * package or rejects the request, so a null here means "this product genuinely
 * has no packages" rather than "nobody said". Transfers still reach it directly,
 * which is safe because a transfer debits and credits in the same unit.
 */
export function baseTotalsFromPackages(
  items: PackageLine[],
  cfMap: Map<string, number>,
): Map<string, number> {
  const baseTotals = new Map<string, number>();
  for (const it of items) {
    const raw = it.productPackageId ? cfMap.get(it.productPackageId) : undefined;
    const cf = raw !== undefined && Number.isFinite(raw) && raw > 0 ? raw : 1;
    const qty = Number(it.quantity);
    if (!Number.isFinite(qty)) continue;
    baseTotals.set(it.productId, (baseTotals.get(it.productId) ?? 0) + qty * cf);
  }
  return baseTotals;
}

export async function adjustStockByPackages(outletId: string, items: PackageLine[]) {
  const pkgIds = [
    ...new Set(items.map((i) => i.productPackageId ?? null).filter((id): id is string => id != null)),
  ];
  const cfMap = new Map<string, number>();
  if (pkgIds.length > 0) {
    const pkgs = await prisma.productPackage.findMany({
      where: { id: { in: pkgIds } },
      select: { id: true, conversionFactor: true },
    });
    for (const p of pkgs) cfMap.set(p.id, Number(p.conversionFactor));
  }

  const baseTotals = baseTotalsFromPackages(items, cfMap);

  await Promise.all(
    [...baseTotals].map(([productId, baseQty]) =>
      adjustStockBalance(outletId, productId, baseQty, null),
    ),
  );
}
