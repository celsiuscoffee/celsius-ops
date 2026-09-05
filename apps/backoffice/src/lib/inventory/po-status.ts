// Purchase-order status machine — the one place that says which PO status
// may follow which. The PATCH route used to write whatever `status` the body
// carried, so a stale tab (or a crafted request) could drag a COMPLETED PO
// back to DRAFT, or jump a DRAFT straight to COMPLETED with no goods received.
//
// Kept in sync with the `OrderStatus` enum in packages/db/prisma/schema.prisma.
// Transitions mirror the live UI flows: create page "send" (DRAFT → SENT /
// AWAITING_DELIVERY), edit-modal approve/send, list-page "close short",
// receiving (→ PARTIALLY_RECEIVED / COMPLETED, written directly by the
// receivings route) and cancel from any non-terminal, non-received state.
import type { OrderStatus } from "@celsius/db";

export const PO_STATUS_TRANSITIONS: Record<OrderStatus, readonly OrderStatus[]> = {
  DRAFT: ["PENDING_APPROVAL", "APPROVED", "SENT", "AWAITING_DELIVERY", "CANCELLED"],
  PENDING_APPROVAL: ["APPROVED", "DRAFT", "CANCELLED"],
  APPROVED: ["SENT", "AWAITING_DELIVERY", "CANCELLED"],
  SENT: ["CONFIRMED", "AWAITING_DELIVERY", "PARTIALLY_RECEIVED", "COMPLETED", "CANCELLED"],
  CONFIRMED: ["AWAITING_DELIVERY", "PARTIALLY_RECEIVED", "COMPLETED", "CANCELLED"],
  AWAITING_DELIVERY: ["PARTIALLY_RECEIVED", "COMPLETED", "CANCELLED"],
  PARTIALLY_RECEIVED: ["COMPLETED", "CANCELLED"],
  COMPLETED: [],
  CANCELLED: [],
};

export const PO_STATUSES = Object.keys(PO_STATUS_TRANSITIONS) as OrderStatus[];

export function isOrderStatus(value: unknown): value is OrderStatus {
  return typeof value === "string" && (PO_STATUSES as string[]).includes(value);
}

export function isTerminalPoStatus(status: OrderStatus): boolean {
  return PO_STATUS_TRANSITIONS[status].length === 0;
}

/**
 * True when `to` may follow `from`. A same-status PATCH is allowed as an
 * idempotent no-op (double-tap / retry of "Confirm order") — the route's
 * side effects are individually de-duplicated.
 */
export function canTransitionPo(from: OrderStatus, to: OrderStatus): boolean {
  if (from === to) return true;
  return PO_STATUS_TRANSITIONS[from].includes(to);
}

const words = (s: string) => s.toLowerCase().replace(/_/g, " ");

/** Human-readable refusal for a bad transition, or null when it is allowed. */
export function poTransitionError(from: OrderStatus, to: unknown): string | null {
  if (!isOrderStatus(to)) return `Unknown order status "${String(to)}".`;
  if (canTransitionPo(from, to)) return null;
  if (isTerminalPoStatus(from)) {
    return `This PO is ${words(from)} and can no longer change status.`;
  }
  const next = PO_STATUS_TRANSITIONS[from].map(words).join(", ");
  return `Cannot move a ${words(from)} PO to ${words(to)}. Allowed next: ${next}.`;
}
