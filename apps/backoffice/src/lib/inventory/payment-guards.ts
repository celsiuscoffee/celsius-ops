/**
 * Pure decision helpers for the payment / receiving safety rules. No database
 * access — the routes gather the facts and these functions decide, so the
 * thresholds and transitions are unit-testable and shared verbatim between
 * the invoice PATCH, the receivings POST and the Pay & Claim approval.
 */

/** Roles allowed to record a full payment, approve a claim, or receive ad-hoc. */
export const PAYER_ROLES = ["OWNER", "ADMIN", "MANAGER"] as const;

export function isPayerRole(role: string | null | undefined): boolean {
  return !!role && (PAYER_ROLES as readonly string[]).includes(role);
}

/**
 * Receipt-before-pay enforcement, from INVOICE_PAY_REQUIRE_RECEIPT.
 *   "warn"  (default) — pay, but flag NO_RECEIVING_AT_PAYMENT and return a warning.
 *   "block"           — 409 NO_RECEIVING unless body.payWithoutReceipt.
 * Defaults to warn because 50–96 % of POs at the outlets currently have no
 * Receiving row; a hard block on deploy day would stop nearly every payment.
 * Flip to "block" once receiving discipline has caught up.
 */
export type ReceiptRequirementMode = "warn" | "block";

export function receiptRequirementMode(raw: string | undefined | null): ReceiptRequirementMode {
  return raw?.trim().toLowerCase() === "block" ? "block" : "warn";
}

/** Money has moved — the invoice's identity (number) and amount are locked. */
export const MONEY_MOVED_STATUSES = ["PAID", "PARTIALLY_PAID", "DEPOSIT_PAID"] as const;

export function moneyHasMoved(status: string | null | undefined): boolean {
  return !!status && (MONEY_MOVED_STATUSES as readonly string[]).includes(status);
}

/**
 * Invoice vs order total tolerance: max(RM 5, 2 % of the order total). Below it
 * the difference is rounding / a delivery charge; above it someone should look.
 */
export function amountMismatchesOrder(invoiceAmount: number, orderTotal: number): boolean {
  if (!Number.isFinite(invoiceAmount) || !Number.isFinite(orderTotal)) return false;
  const tolerance = Math.max(5, Math.abs(orderTotal) * 0.02);
  return Math.abs(invoiceAmount - orderTotal) > tolerance;
}

/**
 * Would applying `payment` on top of `alreadyPaid` exceed `total`? A cent of
 * float noise is not an overpayment.
 */
export function isOverpayment(alreadyPaid: number, payment: number, total: number): boolean {
  return alreadyPaid + payment - total > 0.01;
}

/** Pay & Claim orders may only be approved (or rejected) while still awaiting approval. */
export const APPROVABLE_CLAIM_STATUSES = ["DRAFT", "PENDING_APPROVAL"] as const;

export function isApprovableClaimStatus(status: string | null | undefined): boolean {
  return !!status && (APPROVABLE_CLAIM_STATUSES as readonly string[]).includes(status);
}

/** A stock transfer can be received only once it is on its way (or at least approved/pending). */
export const RECEIVABLE_TRANSFER_STATUSES = ["PENDING", "APPROVED", "IN_TRANSIT"] as const;

export function canReceiveTransfer(status: string | null | undefined): boolean {
  return !!status && (RECEIVABLE_TRANSFER_STATUSES as readonly string[]).includes(status);
}

/** A PO is receivable from SENT onwards until it is complete or cancelled. */
export const RECEIVABLE_ORDER_STATUSES = ["SENT", "AWAITING_DELIVERY", "PARTIALLY_RECEIVED"] as const;

export function canReceiveOrder(status: string | null | undefined): boolean {
  return !!status && (RECEIVABLE_ORDER_STATUSES as readonly string[]).includes(status);
}

export function orderNotReceivableMessage(status: string): string {
  return status === "COMPLETED"
    ? "Order already fully received."
    : status === "CANCELLED"
      ? "Order was cancelled and cannot be received."
      : "PO must be Sent to the supplier before goods can be received.";
}
