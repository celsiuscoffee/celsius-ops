import { prisma } from "@/lib/prisma";

/**
 * Robust next-PO-number generator. POs are numbered `CC-<outletCode>-<NNNN>`.
 *
 * Do NOT derive the next number from a string MAX(orderNumber) or a row COUNT:
 *  - String MAX picks a stray NON-numeric suffix (e.g. a leftover test order "CC-CC001-AITEST")
 *    because letters sort above digits → parseInt → NaN → every generated number becomes
 *    "CC-<code>-0NaN" and then collides forever (NaN + n is still NaN). This was a live bug.
 *  - COUNT(*)+1 drifts from the real max the moment a row is deleted or a non-sequential number
 *    exists, and two callers using different schemes (composer vs agent) generate clashing
 *    numbers in the shared namespace.
 *
 * Instead: read the existing numbers for this outlet's prefix, keep only the digit suffixes, and
 * take the numeric max. Returns the prefix + the highest number so callers can add 1 (and retry
 * on a collision).
 */
export async function nextOrderNumberBase(outletCode: string): Promise<{ prefix: string; lastNum: number }> {
  const prefix = `CC-${outletCode}-`;
  const existing = await prisma.order.findMany({
    where: { orderNumber: { startsWith: prefix } },
    select: { orderNumber: true },
  });
  let lastNum = 0;
  for (const e of existing) {
    const suffix = e.orderNumber.slice(prefix.length);
    if (/^\d+$/.test(suffix)) lastNum = Math.max(lastNum, parseInt(suffix, 10));
  }
  return { prefix, lastNum };
}

/** The next single PO number for an outlet (caller handles any rare concurrent collision). */
export async function nextOrderNumber(outletCode: string): Promise<string> {
  const { prefix, lastNum } = await nextOrderNumberBase(outletCode);
  return `${prefix}${String(lastNum + 1).padStart(4, "0")}`;
}
