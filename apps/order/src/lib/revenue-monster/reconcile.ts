import { after } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase/server";
import { queryCheckoutStatus, queryTransaction } from "./client";
import { markRmOrderPaid, markRmOrderFailed } from "./order-status";
import { notifyOrderPreparing } from "@/lib/push/templates";

/**
 * Single source of truth for settling a Revenue Monster order.
 *
 * Every trigger funnels through here: the RM webhook, the customer's
 * redirect back to `…?payment=done`, the order-screen poll, and the
 * reconcile-pending cron.
 *
 * The defining rule: we NEVER trust a webhook/redirect payload's claimed
 * status. We resolve the order, then ask RM's Query Payment Checkout
 * endpoint directly and act on its authoritative answer. That makes a
 * dropped or signature-failed webhook a non-event (any other trigger
 * settles the order), and a spoofed webhook harmless (RM still reports
 * PENDING, so an unpaid order can't be marked paid).
 *
 * Idempotent: markRmOrderPaid/markRmOrderFailed are gated on the order's
 * status, so concurrent triggers collapse to a single transition. Never
 * throws — RM/query failures resolve to a "pending" result so no caller
 * (page render, webhook ack) can be crashed by a flaky gateway.
 */

export type ReconcileSource =
  | "db"            // already settled before we queried
  | "rm"            // RM gave an authoritative answer
  | "no_checkout_id"// pre-poll / non-RM order with nothing to query
  | "not_rm"        // payment method isn't RM-routed
  | "not_found"     // no such order
  | "error";        // query/network failure — safe to retry on next trigger

export interface ReconcileResult {
  status: string;
  source: ReconcileSource;
  rmStatus?: string;
}

// RM Direct-mode methods whose confirmation rides on a best-effort webhook.
// Kept in sync with the same set in the cron + the order tracking views.
const RM_METHODS = new Set(["fpx", "tng", "boost", "shopeepay", "grabpay", "duitnow", "card"]);

export async function reconcileRmOrder(
  target: {
    orderId?: string;
    orderNumber?: string;
    /** RM transactionId from a webhook payload. The stored checkout id is
     *  only the LATEST attempt — the money can ride an earlier attempt
     *  (each retry overwrites payment_checkout_id while RM's hosted page
     *  keeps prior sessions payable in other tabs). When the checkout
     *  query doesn't confirm payment, this lets us verify the exact
     *  transaction RM claims settled. NEVER trusted as-is — re-queried
     *  against RM and matched to this order before settling. */
    transactionId?: string;
  },
): Promise<ReconcileResult> {
  if (!target.orderId && !target.orderNumber) return { status: "pending", source: "not_found" };

  try {
    const supabase = getSupabaseAdmin();
    const sel = supabase
      .from("orders")
      .select("id, order_number, status, total, payment_checkout_id, payment_method");
    const { data } = target.orderId
      ? await sel.eq("id", target.orderId).maybeSingle()
      : await sel.eq("order_number", target.orderNumber!).maybeSingle();
    const row = data as {
      id: string;
      order_number: string;
      status: string;
      total: number | null;
      payment_checkout_id: string | null;
      payment_method: string | null;
    } | null;

    if (!row) return { status: "pending", source: "not_found" };
    // Already settled — nothing to do (idempotent fast path). "failed" is
    // NOT settled: the customer can retry payment on the same order after a
    // failed attempt (/api/payments/create allows it), so money can land on
    // an order we already flipped to failed. Treating failed as terminal
    // here stranded C-9782: the card attempt expired → order failed → the
    // FPX retry's SUCCESS webhook hit this early-return and the payment was
    // never recorded. Fall through and re-ask RM — markRmOrderPaid accepts
    // failed → paid (money received always wins) and markRmOrderFailed is a
    // no-op on an already-failed row, so this stays idempotent.
    if (row.status !== "pending" && row.status !== "failed") {
      return { status: row.status, source: "db" };
    }
    if (row.payment_method && !RM_METHODS.has(row.payment_method)) {
      return { status: row.status, source: "not_rm" };
    }

    const settle = async (transactionId: string | null): Promise<ReconcileResult> => {
      const paid = await markRmOrderPaid({ orderId: row.id }, transactionId);
      if (paid && !paid.scheduled) {
        // "Brewing now" push — suppressed for scheduled orders (the
        // promote-scheduled cron fires it at brew-window-open time).
        after(async () => {
          await notifyOrderPreparing({
            orderId: paid.orderId,
            orderNumber: paid.orderNumber,
            customerPhone: paid.customerPhone,
          }).catch((e) => console.warn("[push] order_preparing reconcile", e));
        });
      }
      return { status: paid?.scheduled ? "paid" : "preparing", source: "rm", rmStatus: "SUCCESS" };
    };

    const rm = row.payment_checkout_id
      ? await queryCheckoutStatus(row.payment_checkout_id)
      : null;
    if (rm?.status === "SUCCESS") return settle(rm.transactionId);

    // The stored checkout didn't confirm payment, but a webhook may have
    // told us exactly which transaction settled (possibly an EARLIER
    // attempt whose checkout id we overwrote). Verify it with RM and make
    // sure it belongs to THIS order before settling — additionalData is
    // the order UUID we set at checkout creation and RM echoes it back,
    // so a spoofed/foreign transactionId can't be cross-applied; the
    // amount check guards against settling on a mismatched charge.
    if (target.transactionId) {
      try {
        const tx = await queryTransaction(target.transactionId);
        const belongsToOrder =
          (tx.additionalData != null && tx.additionalData === row.id) ||
          (tx.rmOrderId != null && tx.rmOrderId.replace(/-[0-9a-z]{6,}$/, "") === row.order_number);
        const amountMatches =
          tx.amountSen == null || row.total == null || tx.amountSen === row.total;
        if (tx.status === "SUCCESS" && belongsToOrder && amountMatches) {
          return settle(tx.transactionId ?? target.transactionId);
        }
        if (tx.status === "SUCCESS") {
          console.warn(
            `[rm reconcile] tx ${target.transactionId} is SUCCESS but did not match order ${row.order_number} (belongs=${belongsToOrder} amount=${amountMatches}) — NOT settling, review manually`,
          );
        }
      } catch (err) {
        // Transaction lookup is best-effort on top of the checkout query —
        // a failure here must not block the normal flow below.
        console.warn("[rm reconcile] transaction verify failed:", err instanceof Error ? err.message : err);
      }
    }

    if (!rm) {
      return { status: row.status === "failed" ? "failed" : "pending", source: "no_checkout_id" };
    }

    if (rm.status === "FAILED" || rm.status === "CANCELLED" || rm.status === "EXPIRED") {
      await markRmOrderFailed({ orderId: row.id }, `rm_${rm.status.toLowerCase()}`);
      return { status: "failed", source: "rm", rmStatus: rm.status };
    }

    return { status: row.status === "failed" ? "failed" : "pending", source: "rm", rmStatus: rm.status };
  } catch (err) {
    // Gateway/network blip — leave the order pending; another trigger
    // (poll / cron / redirect) will settle it. Must never bubble.
    console.warn("[rm reconcile] failed:", err instanceof Error ? err.message : err);
    return { status: "pending", source: "error" };
  }
}
