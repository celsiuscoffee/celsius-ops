import type { PrismaClient } from "@prisma/client";

/**
 * GRNI placeholder invoice numbers.
 *
 * When goods arrive before the supplier's bill, the system fabricates an
 * invoice row so the payable exists (GRNI — goods received, not invoiced).
 * These used to be numbered `INV-<n>` from one GLOBAL counter shared by every
 * supplier — so two different suppliers' placeholders could (and did) share a
 * number, and a payment quoting one matched the other's row (real case:
 * INV-1844 open on both Yow Seng RM1,312.30 and Unique Paper RM260.47).
 *
 * New placeholders are namespaced `GRNI-<outletCode>-<n>` (or `GRNI-<n>` when
 * no outlet is known) so they are visibly fake, and the POP matcher treats
 * placeholder-shaped numbers as weak references that need amount/payee
 * corroboration (finance genuinely pays against placeholder numbers off the
 * approve-to-pay card, so they must stay matchable — just never blindly).
 */

/** Matches our fabricated numbers, old and new: INV-1844, TRF-0012, GRNI-0071, GRNI-CC001-0071. */
export function isPlaceholderNumber(n: string | null | undefined): boolean {
  return !!n && /^(GRNI|INV|TRF)-(?:[A-Z0-9]{2,6}-)?\d{3,6}$/i.test(n.trim());
}

/**
 * Reduce an invoice number to its shape: digit runs → '#', case folded, so
 * "IVCT-00012381" → "ivct-#" and "1-15415" → "#-#". Suppliers keep one shape;
 * a number whose shape has never appeared in that supplier's history is a
 * capture red flag (real case: an `IVCT-#` Milk n Moka number stamped onto a
 * `#-#`-numbered Milk Ministry invoice).
 */
export function numberShape(n: string): string {
  return n.trim().toLowerCase().replace(/\d+/g, "#");
}

/**
 * Does this extracted number's shape match the supplier's known numbering?
 * `history` should be the supplier's REAL recent invoice numbers (placeholder
 * rows excluded by the caller). Under 3 history rows there's no established
 * pattern, so anything passes. Returns true when the shape is known.
 */
export function numberShapeMatchesHistory(n: string, history: string[]): boolean {
  const real = history.filter((h) => !isPlaceholderNumber(h));
  if (real.length < 3) return true;
  const shapes = new Set(real.map(numberShape));
  return shapes.has(numberShape(n));
}

/**
 * Mint the next placeholder number. Keeps the legacy global counter (count of
 * all invoices) for sequence continuity; the prefix + outlet code carry the
 * meaning. Falls back to `GRNI-<n>` when the outlet can't be resolved.
 */
export async function mintPlaceholderNumber(
  prisma: PrismaClient,
  outletId?: string | null,
): Promise<string> {
  const seq = String((await prisma.invoice.count()) + 1).padStart(4, "0");
  if (outletId) {
    try {
      const outlet = await prisma.outlet.findUnique({ where: { id: outletId }, select: { code: true } });
      if (outlet?.code) return `GRNI-${outlet.code}-${seq}`;
    } catch {
      /* fall through to the plain form */
    }
  }
  return `GRNI-${seq}`;
}
