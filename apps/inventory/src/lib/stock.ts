import { prisma } from "./prisma";

/**
 * Update stock balance for a product at a branch.
 * Uses upsert to create if not exists.
 *
 * @param branchId - Branch ID
 * @param productId - Product ID
 * @param delta - Positive to add stock, negative to subtract
 */
export async function adjustStockBalance(
  branchId: string,
  productId: string,
  delta: number,
) {
  await prisma.stockBalance.upsert({
    where: {
      branchId_productId: { branchId, productId },
    },
    create: {
      branchId,
      productId,
      quantity: Math.max(0, delta),
      lastUpdated: new Date(),
    },
    update: {
      quantity: { increment: delta },
      lastUpdated: new Date(),
    },
  });

  // Clamp to zero (stock can't go negative)
  await prisma.stockBalance.updateMany({
    where: {
      branchId,
      productId,
      quantity: { lt: 0 },
    },
    data: { quantity: 0 },
  });
}

/**
 * Set stock balance to an absolute value (used by stock counts).
 */
export async function setStockBalance(
  branchId: string,
  productId: string,
  quantity: number,
) {
  await prisma.stockBalance.upsert({
    where: {
      branchId_productId: { branchId, productId },
    },
    create: {
      branchId,
      productId,
      quantity: Math.max(0, quantity),
      lastUpdated: new Date(),
    },
    update: {
      quantity: Math.max(0, quantity),
      lastUpdated: new Date(),
    },
  });
}
