"use client";

/**
 * Checkout-session storage helpers — shared by the checkout view and the order
 * tracking page so the cart is cleared in exactly ONE place: once payment is
 * CONFIRMED, never at order-creation.
 *
 * Why: the cart used to be wiped the instant /api/checkout/initiate created the
 * (still-unpaid) order. A customer who then bailed on the gateway page and
 * tapped back landed on an empty checkout and couldn't "place the order again"
 * — the order page's own retry instruction. So we keep the cart until payment
 * actually succeeds, and guard against a double-submit with a pending-order
 * breadcrumb instead.
 */

const CART_KEY = "celsius-pickup";
const DINEIN_KEY = "celsius-dinein";
const PENDING_KEY = "celsius-pending-order";

/** Empty the cart + applied reward and end the dine-in session. Called only on
 *  CONFIRMED payment (order page / inline-Stripe success / free order). */
export function clearDineInCart(): void {
  try {
    const raw = window.localStorage.getItem(CART_KEY);
    const parsed = raw ? (JSON.parse(raw) as { state?: Record<string, unknown> }) : { state: {} };
    const s = (parsed.state ?? {}) as Record<string, unknown>;
    s.cart = [];
    s.appliedReward = null;
    s.reservedVoucher = null;
    window.localStorage.setItem(CART_KEY, JSON.stringify({ ...parsed, state: s }));
  } catch {
    /* ignore */
  }
  try { window.localStorage.removeItem(DINEIN_KEY); } catch { /* ignore */ }
  clearPendingOrder();
}

export type PendingOrder = { orderId: string; ts: number };

export function setPendingOrder(orderId: string): void {
  try {
    window.localStorage.setItem(PENDING_KEY, JSON.stringify({ orderId, ts: Date.now() }));
  } catch {
    /* ignore */
  }
}

export function getPendingOrder(): PendingOrder | null {
  try {
    const raw = window.localStorage.getItem(PENDING_KEY);
    if (!raw) return null;
    const d = JSON.parse(raw) as { orderId?: unknown; ts?: unknown };
    if (typeof d.orderId !== "string" || typeof d.ts !== "number") return null;
    return { orderId: d.orderId, ts: d.ts };
  } catch {
    return null;
  }
}

export function clearPendingOrder(): void {
  try { window.localStorage.removeItem(PENDING_KEY); } catch { /* ignore */ }
}

/** Fresh dine-in context, if any (used to keep a bounced table customer in
 *  dine-in instead of stranding them as pickup). */
export function getDineInContext(): { outletId: string; tableNumber: string } | null {
  try {
    const raw = window.localStorage.getItem(DINEIN_KEY);
    if (!raw) return null;
    const d = JSON.parse(raw) as { outletId?: unknown; tableNumber?: unknown; ts?: unknown };
    const fresh = typeof d.ts === "number" && Date.now() - d.ts < 6 * 60 * 60 * 1000;
    if (fresh && typeof d.outletId === "string" && typeof d.tableNumber === "string") {
      return { outletId: d.outletId, tableNumber: d.tableNumber };
    }
    return null;
  } catch {
    return null;
  }
}
