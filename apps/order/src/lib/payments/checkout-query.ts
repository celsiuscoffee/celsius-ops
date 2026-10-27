import { queryCheckoutStatus } from "@/lib/revenue-monster/client";
import { IPAY88_CHECKOUT_PREFIX, merchantForStore, requery } from "@/lib/ipay88/client";

/**
 * Gateway-agnostic "did this order's hosted checkout get paid?".
 *
 * orders.payment_checkout_id is the handle of the order's latest hosted
 * checkout: a bare Revenue Monster checkoutId, or `ipay88:<RefNo>` for an
 * iPay88 checkout. Every sweep that used to call RM's queryCheckoutStatus
 * directly (reconcile, expire-orders, reconcile-failed, payments/create's
 * double-charge guard) goes through here, so an iPay88 order is never asked
 * about at RM and vice versa.
 *
 * Statuses: SUCCESS (paid in full) | FAILED | CANCELLED | EXPIRED (RM only)
 * | UNPAID (iPay88 has no paid record — abandoned or still on the page)
 * | anything else = not settled yet. Throws on a gateway/network error —
 * callers treat that as "unknown, try again later".
 */
export type CheckoutGateway = "revenue_monster" | "ipay88";

export interface CheckoutQueryResult {
  gateway: CheckoutGateway;
  status: string;
  transactionId: string | null;
}

export function isIpay88Checkout(checkoutId: string | null | undefined): boolean {
  return !!checkoutId && checkoutId.startsWith(IPAY88_CHECKOUT_PREFIX);
}

export function ipay88CheckoutId(refNo: string): string {
  return `${IPAY88_CHECKOUT_PREFIX}${refNo}`;
}

export async function queryOrderCheckout(order: {
  payment_checkout_id: string;
  store_id: string;
  total: number | null;
}): Promise<CheckoutQueryResult> {
  const checkoutId = order.payment_checkout_id;
  if (!isIpay88Checkout(checkoutId)) {
    const rm = await queryCheckoutStatus(checkoutId);
    return { gateway: "revenue_monster", status: rm.status, transactionId: rm.transactionId };
  }

  const refNo = checkoutId.slice(IPAY88_CHECKOUT_PREFIX.length);
  const merchant = merchantForStore(order.store_id);
  if (!merchant) throw new Error(`iPay88 not configured for store ${order.store_id}`);
  if (order.total == null) throw new Error(`order ${refNo} has no total to requery with`);
  const r = await requery(merchant, refNo, order.total);
  if (r.status === "UNKNOWN") {
    console.warn(`[ipay88] requery ${refNo}: unrecognised answer "${r.raw.slice(0, 120)}"`);
  }
  // Requery doesn't return iPay88's TransId; the signed callback carries it.
  return {
    gateway: "ipay88",
    status: r.status === "UNKNOWN" ? "PENDING" : r.status,
    transactionId: null,
  };
}
