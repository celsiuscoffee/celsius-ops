/**
 * GrabFood order-state → POS-status mapping + the forward-only transition guard.
 *
 * Extracted from the webhook handler so the state machine is unit-testable in
 * isolation (no Next/Supabase/HTTP). This is the logic that decides what a Grab
 * "Push Order State" does to our local pos_orders.status — and, critically, when
 * it must NOT change it.
 *
 * Background: orders were getting stranded at "open". Grab assigns a driver
 * (DRIVER_ALLOCATED) only AFTER the merchant accepts, but that state was mapped
 * to "open" and applied unconditionally — demoting an already-accepted order
 * below the on-register KDS visibility floor, where staff could no longer see or
 * advance it. The guard below makes a Grab push only ever move an order FORWARD.
 */

export type GrabOrderState =
  | "PENDING"
  | "ACCEPTED"
  | "DRIVER_ALLOCATED"
  | "DRIVER_ARRIVED"
  | "COLLECTED"
  | "DELIVERED"
  | "CANCELLED"
  | "FAILED";

export function mapGrabStatusToPOS(state: GrabOrderState | string): string {
  switch (state) {
    // PENDING is the only genuine pre-acceptance state.
    case "PENDING": return "open";
    // DRIVER_ALLOCATED is a POST-acceptance state — Grab assigns a driver only
    // AFTER the merchant accepts. Mapping it to "open" (as it was) demoted an
    // already-accepted order below the on-register KDS floor (GRAB_LIVE), where
    // staff could no longer see it to mark it Ready/Collected — so it sat "open"
    // forever. It belongs in the active kitchen bucket alongside ACCEPTED.
    case "ACCEPTED": case "DRIVER_ALLOCATED": return "sent_to_kitchen";
    case "DRIVER_ARRIVED": return "ready";
    case "COLLECTED": case "DELIVERED": return "completed";
    case "CANCELLED": case "FAILED": return "cancelled";
    default: return "open";
  }
}

// POS fulfilment lifecycle order. A Grab "Push Order State" must only ever move
// an order FORWARD — a late, duplicate, or out-of-order push (e.g. a stray
// PENDING arriving after the order was already accepted) must never demote it.
// That demotion is exactly what stranded orders at "open", off the KDS.
export const STATUS_RANK: Record<string, number> = {
  open: 0,
  sent_to_kitchen: 1,
  preparing: 2,
  ready: 3,
  completed: 4,
};

// Decide whether an inbound mapped status should overwrite the current one.
// Cancellation/failure is terminal and can arrive at any live stage, so it wins
// over a forward status — but never resurrects an already-finished order.
// Forward-only otherwise; unknown statuses pass through (forward-compatible).
export function shouldApplyStatus(current: string | null, next: string): boolean {
  const cur = current ?? "";
  if (cur === next) return false;
  if (next === "cancelled") return cur !== "completed" && cur !== "cancelled";
  const c = STATUS_RANK[cur];
  const n = STATUS_RANK[next];
  if (c === undefined || n === undefined) return true;
  return n > c;
}
