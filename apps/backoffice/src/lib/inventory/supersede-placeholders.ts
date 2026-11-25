// Retire GRNI placeholders once the supplier's real bill is recorded.
//
// Why: receiving mints a placeholder invoice on the PO ("goods received, not
// invoiced"). When staff later record the real bill through Quick Upload or
// the invoices page, that creates a NEW invoice on a different order, and the
// placeholder stayed open, so the same goods were counted twice in COGS and
// payables. Conezion Q3 2026 alone carried RM6.3k of these (Yow Seng
// GRNI-CC001-3272 RM1,764.50 vs YSIV2609-PUTRAJAYA RM1,765.29; Global Coffee
// GRNI-3271 + GRNI-3406 vs one RM2,529.82 bill).
//
// A placeholder is never deleted: it keeps the PO's invoice link (so the
// invoice-requester agent does not start chasing the supplier again). It is
// zeroed and marked settled, with the original amount kept in a flag, which
// is reversible and can never match a bank line.

import type { Prisma } from "@celsius/db";
import { isPlaceholderNumber } from "./placeholder-number";
import type { InvoiceFlag } from "./flag-detector";

export const PLACEHOLDER_WINDOW_DAYS = 21;
export const SUPERSEDED_PAID_VIA = "superseded";

export type PlaceholderCandidate = { id: string; amount: number; issueDate: Date };

/** A bill matches when the amounts agree within max(RM2, 0.5%), which covers rounding and delivery fees. */
export function amountsMatch(a: number, b: number): boolean {
  return Math.abs(a - b) <= Math.max(2, 0.005 * Math.max(a, b));
}

/**
 * Pick the placeholder(s) a real bill replaces: one whose amount matches,
 * nearest in date; otherwise two or three that together add up to the bill
 * (a supplier often bills several deliveries at once). Returns [] when
 * nothing matches unambiguously.
 */
export function pickPlaceholderMatch(
  candidates: PlaceholderCandidate[],
  amount: number,
  billDate: Date,
): string[] {
  if (!(amount > 0)) return [];
  const byNearest = [...candidates].sort(
    (a, b) => Math.abs(a.issueDate.getTime() - billDate.getTime()) - Math.abs(b.issueDate.getTime() - billDate.getTime()),
  );
  const single = byNearest.find((c) => amountsMatch(c.amount, amount));
  if (single) return [single.id];

  const pool = byNearest.slice(0, 12);
  const combos: string[][] = [];
  for (let i = 0; i < pool.length; i++) {
    for (let j = i + 1; j < pool.length; j++) {
      if (amountsMatch(pool[i].amount + pool[j].amount, amount)) combos.push([pool[i].id, pool[j].id]);
      for (let k = j + 1; k < pool.length; k++) {
        if (amountsMatch(pool[i].amount + pool[j].amount + pool[k].amount, amount)) {
          combos.push([pool[i].id, pool[j].id, pool[k].id]);
        }
      }
    }
  }
  // Two different sets adding up to the same bill is a guess, not a match.
  return combos.length === 1 ? combos[0] : [];
}

// Accepts the prisma client or a transaction client; only invoices are touched.
type Tx = Pick<Prisma.TransactionClient, "invoice">;

/**
 * Zero and settle the open placeholders a newly recorded bill replaces.
 * Same supplier and outlet, issued within PLACEHOLDER_WINDOW_DAYS of the
 * bill. Returns the retired placeholder numbers (empty when none matched).
 */
export async function supersedePlaceholders(
  tx: Tx,
  bill: { id: string; invoiceNumber: string; supplierId: string | null; outletId: string | null; amount: number; issueDate: Date },
): Promise<string[]> {
  if (!bill.supplierId || !bill.outletId || !(bill.amount > 0)) return [];
  const from = new Date(bill.issueDate.getTime() - PLACEHOLDER_WINDOW_DAYS * 86_400_000);
  const to = new Date(bill.issueDate.getTime() + PLACEHOLDER_WINDOW_DAYS * 86_400_000);

  const rows = await tx.invoice.findMany({
    where: {
      id: { not: bill.id },
      outletId: bill.outletId,
      status: "PENDING",
      dueDate: null,
      issueDate: { gte: from, lte: to },
      OR: [{ supplierId: bill.supplierId }, { order: { supplierId: bill.supplierId } }],
    },
    select: { id: true, invoiceNumber: true, amount: true, issueDate: true, notes: true, flags: true },
  });
  const open = rows.filter((r) => isPlaceholderNumber(r.invoiceNumber));
  const ids = pickPlaceholderMatch(
    open.map((r) => ({ id: r.id, amount: Number(r.amount), issueDate: r.issueDate })),
    bill.amount,
    bill.issueDate,
  );

  const retired: string[] = [];
  for (const id of ids) {
    const r = open.find((o) => o.id === id)!;
    const original = Number(r.amount);
    const flag: InvoiceFlag = {
      code: "SUPERSEDED_PLACEHOLDER",
      message: `Replaced by supplier invoice ${bill.invoiceNumber} (RM ${bill.amount.toFixed(2)}). Original placeholder amount RM ${original.toFixed(2)}.`,
      detectedAt: new Date().toISOString(),
      meta: { originalAmount: original, byInvoiceId: bill.id, byInvoiceNumber: bill.invoiceNumber },
    };
    const prior = Array.isArray(r.flags) ? (r.flags as unknown as InvoiceFlag[]) : [];
    await tx.invoice.update({
      where: { id },
      data: {
        amount: 0,
        status: "PAID",
        paidAt: new Date(),
        paidVia: SUPERSEDED_PAID_VIA,
        paymentRef: bill.invoiceNumber,
        notes: [r.notes, `Superseded by ${bill.invoiceNumber}; zeroed so the goods are not counted twice (was RM ${original.toFixed(2)}).`]
          .filter(Boolean)
          .join("\n"),
        flags: [...prior, flag] as unknown as Prisma.InputJsonValue,
      },
    });
    retired.push(r.invoiceNumber);
  }
  return retired;
}
