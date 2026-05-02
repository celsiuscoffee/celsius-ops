import { prisma } from "@/lib/prisma";

/**
 * Resolve the effective deposit percent for a (supplier, invoice-override)
 * pair. Invoice override wins if set; otherwise we fall back to the supplier
 * default. Returns 0 when there's no deposit policy at all.
 *
 * `invoicePercent` is the value the caller wants to set on the invoice
 * itself (typically read from the request body or the existing row). Pass
 * `undefined` if the caller wants the supplier default; pass `null` if the
 * caller is explicitly turning deposits OFF for this invoice.
 */
export async function resolveDepositPercent(
  supplierId: string | null | undefined,
  invoicePercent: number | null | undefined,
): Promise<number> {
  if (invoicePercent === null) return 0; // explicit "no deposit on this one"
  if (typeof invoicePercent === "number" && invoicePercent >= 0) return invoicePercent;
  if (!supplierId) return 0;
  const supplier = await prisma.supplier.findUnique({
    where: { id: supplierId },
    select: { depositPercent: true },
  });
  return supplier?.depositPercent ?? 0;
}

/**
 * Compute the deposit amount in RM for a given invoice. Rounded to 2dp so
 * downstream PDF/Excel renders match what's stored.
 *
 * Returns null when there's no deposit policy (so the existing invoice
 * payload can `...spread` the result conditionally).
 *
 * Kept in one place so every invoice-creation/edit path (manual POST,
 * PATCH, receivings, telegram webhook, order PATCH) computes
 * invoice.depositAmount consistently — the POP matcher's DEPOSIT_PAID
 * branch only triggers when this field is set.
 */
export async function computeDepositAmount(
  supplierId: string | null | undefined,
  amount: number | null | undefined,
  invoicePercent?: number | null,
): Promise<number | null> {
  if (!amount || amount <= 0) return null;
  const pct = await resolveDepositPercent(supplierId, invoicePercent);
  if (pct <= 0) return null;
  return Math.round((Number(amount) * pct / 100) * 100) / 100;
}
