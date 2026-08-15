import { prisma } from "@/lib/prisma";
import { mytTodayRange } from "@/lib/inventory/myt-today";

/**
 * Keep the stored OVERDUE flag honest — in BOTH directions.
 *
 * The list and export endpoints used to run a single one-way sweep:
 *
 *     updateMany({ where: { status: "PENDING", dueDate: { lt: todayStart } },
 *                  data: { status: "OVERDUE" } })
 *
 * which is correct on the way in and has no way back out. Collective Project's
 * invoice rows are pre-created 7–9 days before their issue date carrying a
 * placeholder due date, so they trip the sweep legitimately; when the real
 * invoice arrives and the date is corrected forward, nothing ever clears the
 * flag. IV-02158 sat OVERDUE with its balance not due for another nine days
 * and its deposit already paid.
 *
 * Two changes:
 *   1. the reverse transition exists — OVERDUE returns to PENDING as soon as
 *      the row is not actually past due;
 *   2. a due date that PRE-DATES the issue date is treated as a placeholder,
 *      not a deadline, so a pre-created row can no longer be marked overdue on
 *      a date that was never real. (due == issue is honoured — COD does that.)
 *
 * Deliberately still only touches PENDING ⇄ OVERDUE. INITIATED and
 * DEPOSIT_PAID carry information an OVERDUE stamp would destroy, so their
 * lateness is surfaced as a derived flag by the caller instead — see
 * `evaluateInvoiceTiming` in @celsius/db.
 */
export async function syncInvoiceOverdue(): Promise<{ marked: number; cleared: number }> {
  const { start: todayStart } = mytTodayRange();

  // "Not genuinely past due": no due date at all, a due date still ahead of us,
  // or a placeholder date that pre-dates the invoice itself.
  const notActuallyOverdue = [
    { dueDate: null },
    { dueDate: { gte: todayStart } },
    { dueDate: { lt: prisma.invoice.fields.issueDate } },
  ];

  const [marked, cleared, restored] = await Promise.all([
    // Past due and still merely PENDING → OVERDUE. The issueDate guard is the
    // root-cause fix: without it a placeholder date manufactures the flag.
    prisma.invoice.updateMany({
      where: {
        status: "PENDING",
        dueDate: { lt: todayStart },
        NOT: { dueDate: { lt: prisma.invoice.fields.issueDate } },
      },
      data: { status: "OVERDUE" },
    }),
    // Not actually past due any more → drop OVERDUE. Covers both the
    // corrected-date case and a placeholder date that never should have
    // counted.
    //
    // Restores the status the row would otherwise carry, which is NOT always
    // PENDING: an invoice whose deposit is already settled belongs in
    // DEPOSIT_PAID. The back office decides its action buttons from status
    // alone — `case "PENDING"` renders "Initiate Deposit" without ever checking
    // depositPaidAt — so sending a deposit-paid row to PENDING puts a live
    // double-payment prompt in front of AP. IV-02158 hit exactly that.
    prisma.invoice.updateMany({
      where: {
        status: "OVERDUE",
        depositPaidAt: null,
        amountPaid: 0,
        OR: notActuallyOverdue,
      },
      data: { status: "PENDING" },
    }),
    prisma.invoice.updateMany({
      where: {
        status: "OVERDUE",
        OR: notActuallyOverdue,
        NOT: { depositPaidAt: null, amountPaid: 0 },
      },
      data: { status: "DEPOSIT_PAID" },
    }),
  ]);

  return { marked: marked.count, cleared: cleared.count + restored.count };
}
