// Pure status-lifecycle logic for inbound GrabFood order webhooks. Extracted
// from the webhook route so the forward-only transition rules are unit-testable
// without a request/DB. No I/O — state string in, pos_orders.status out.

/** A Grab order webhook state. The submit-order payload uses the long form;
 *  the helper also tolerates case / separator variants seen across versions. */
export type GrabOrderState =
  | "PENDING" | "ACCEPTED" | "DRIVER_ALLOCATED" | "DRIVER_ARRIVED"
  | "COLLECTED" | "DELIVERED" | "CANCELLED" | "FAILED";

/** Map a Grab orderState to our pos_orders.status. Tolerant of case / separator
 *  variants (Grab has shipped both "DRIVER_ARRIVED" and "Driver Arrived" shapes
 *  across versions). Returns null for anything we don't recognise so an unknown
 *  push is a NO-OP — never a silent fallback to "open". */
export function mapGrabStatusToPOS(
  state: GrabOrderState | string | null | undefined,
): string | null {
  const s = String(state ?? "").trim().toUpperCase().replace(/[\s-]+/g, "_");
  switch (s) {
    case "PENDING": case "DRIVER_ALLOCATED": return "open";
    case "ACCEPTED": return "sent_to_kitchen";
    case "DRIVER_ARRIVED": return "ready";
    case "COLLECTED": case "DELIVERED": return "completed";
    case "CANCELLED": case "CANCELED": case "FAILED": return "cancelled";
    default: return null;
  }
}

// Fulfilment lifecycle rank. A webhook may only ADVANCE an order, never drag it
// backwards: Grab re-pushes states and a late/duplicate DELIVERED can arrive
// hours after the register already marked the order Collected. Without this
// guard those pushes rewrote a completed order's status back to "open" (verified
// in prod: orders carrying completed_at were sitting at status='open', which
// also dropped them from the sales dashboard's delivery total).
export const STATUS_RANK: Record<string, number> = {
  open: 0,
  sent_to_kitchen: 1,
  ready: 2,
  completed: 3,
};

/** The status to persist given the current row + an incoming mapped status, or
 *  null to leave it unchanged. Forward-only; a cancellation is honoured from any
 *  non-terminal status but never un-completes a collected order. */
export function resolveStatusTransition(current: string, incoming: string | null): string | null {
  if (!incoming || incoming === current) return null;
  const terminal = current === "completed" || current === "cancelled" || current === "refunded";
  if (incoming === "cancelled") return terminal ? null : "cancelled";
  const next = STATUS_RANK[incoming];
  if (next == null) return null; // unknown forward state → no-op
  return next > (STATUS_RANK[current] ?? 0) ? incoming : null;
}
