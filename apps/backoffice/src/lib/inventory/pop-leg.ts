/**
 * Which leg of an invoice a proof-of-payment settles.
 *
 * Most invoices are paid in one go ("full"). Suppliers on deposit terms are
 * paid in two: a deposit up front, then the balance. The Telegram POP matcher
 * used to understand only the first two — it compared a POP against the full
 * amount or the deposit amount and nothing else — so the balance leg had no
 * case at all and dead-ended on "No matching unpaid invoice found".
 *
 * Reconciling the payment channel on 2026-09-17 put a number on that: 16
 * Collective Project payments, RM16,380.30, each exactly 90% of face value,
 * unmatched between April and September. It is the only supplier on deposit
 * terms (10% up front), so it absorbed the whole of the defect.
 */

/**
 * Statuses a POP can still settle a balance against — every status except PAID.
 *
 * Deliberately NOT just DEPOSIT_PAID/PARTIALLY_PAID. The deposit leg reaches
 * an invoice through more than one code path, and only the Telegram one sets
 * DEPOSIT_PAID: as of 2026-09-17 the only two part-paid invoices in the
 * database (RM4,372.20 outstanding, both Collective Project) sit at INITIATED
 * with 10% recorded against them. Gating on the deposit statuses alone would
 * have missed precisely the live cases this exists to catch, so what marks an
 * invoice as awaiting a balance is `amountPaid`, not its status.
 */
export const BALANCE_ELIGIBLE_STATUSES = [
  "DRAFT",
  "INITIATED",
  "PENDING",
  "PARTIALLY_PAID",
  "DEPOSIT_PAID",
  "OVERDUE",
] as const;

export type PopLeg = "full" | "deposit" | "balance" | "none";

/** The matcher's long-standing amount tolerance, in ringgit. */
export const POP_AMOUNT_TOLERANCE = 0.5;

export function classifyPopLeg(input: {
  popAmount: number;
  invoiceAmount: number;
  depositAmount: number | null;
  amountPaid: number;
  status: string;
  tolerance?: number;
}): PopLeg {
  const tol = input.tolerance ?? POP_AMOUNT_TOLERANCE;
  const { popAmount, invoiceAmount, depositAmount, amountPaid, status } = input;

  // A full-amount match always wins — it is the safest reading, and the one
  // that needs no assumption about what was paid before.
  if (Math.abs(invoiceAmount - popAmount) <= tol) return "full";

  // Balance outranks deposit. On an invoice whose deposit is already settled a
  // second POP clears the remainder; reading it as another deposit would leave
  // the invoice open and invite a third payment.
  //
  // What makes an invoice eligible is that money is already recorded against
  // it and something is still owed — not its status. See the note on
  // BALANCE_ELIGIBLE_STATUSES: the live part-paid rows carry INITIATED, not
  // DEPOSIT_PAID. Status is only used to rule out an already-settled invoice.
  const outstanding = invoiceAmount - amountPaid;
  const settleable = (BALANCE_ELIGIBLE_STATUSES as readonly string[]).includes(status);
  if (settleable && amountPaid > 0.01 && outstanding > 0.01 && Math.abs(outstanding - popAmount) <= tol) {
    return "balance";
  }

  if (depositAmount != null && Math.abs(depositAmount - popAmount) <= tol) return "deposit";

  return "none";
}
