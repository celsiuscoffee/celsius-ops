import { prisma } from "@/lib/prisma";

/**
 * If the supplier requires an upfront deposit, return the depositAmount
 * rounded to 2 decimals. Returns null when there's no supplier, no percent
 * configured, or the computed amount is zero.
 *
 * Kept in one place so every invoice-creation path (manual POST, receivings,
 * telegram webhook, order PATCH) populates invoice.depositAmount consistently
 * — the POP matcher's DEPOSIT_PAID branch only triggers when this field is set.
 */
export async function computeDepositAmount(
  supplierId: string | null | undefined,
  amount: number | null | undefined,
): Promise<number | null> {
  if (!supplierId || !amount || amount <= 0) return null;
  const supplier = await prisma.supplier.findUnique({
    where: { id: supplierId },
    select: { depositPercent: true },
  });
  const pct = supplier?.depositPercent ?? 0;
  if (pct <= 0) return null;
  return Math.round((Number(amount) * pct / 100) * 100) / 100;
}
