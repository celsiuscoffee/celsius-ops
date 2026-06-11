import { after } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase/server";
import { queryCheckoutStatus } from "./client";
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
  target: { orderId?: string; orderNumber?: string },
): Promise<ReconcileResult> {
  if (!target.orderId && !target.orderNumber) return { status: "pending", source: "not_found" };

  try {
    const supabase = getSupabaseAdmin();
    const sel = supabase
      .from("orders")
      .select("id, status, payment_checkout_id, payment_method");
    const { data } = target.orderId
      ? await sel.eq("id", target.orderId).maybeSingle()
      : await sel.eq("order_number", target.orderNumber!).maybeSingle();
    const row = data as {
      id: string;
      status: string;
      payment_checkout_id: string | null;
      payment_method: string | null;
    } | null;

    if (!row) return { status: "pending", source: "not_found" };
    // Already settled — nothing to do (idempotent fast path).
    if (row.status !== "pending") return { status: row.status, source: "db" };
    if (row.payment_method && !RM_METHODS.has(row.payment_method)) {
      return { status: row.status, source: "not_rm" };
    }
    if (!row.payment_checkout_id) return { status: "pending", source: "no_checkout_id" };

    const rm = await queryCheckoutStatus(row.payment_checkout_id);

    if (rm.status === "SUCCESS") {
      const paid = await markRmOrderPaid({ orderId: row.id }, rm.transactionId);
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
      return { status: paid?.scheduled ? "paid" : "preparing", source: "rm", rmStatus: rm.status };
    }

    if (rm.status === "FAILED" || rm.status === "CANCELLED" || rm.status === "EXPIRED") {
      await markRmOrderFailed({ orderId: row.id }, `rm_${rm.status.toLowerCase()}`);
      return { status: "failed", source: "rm", rmStatus: rm.status };
    }

    return { status: "pending", source: "rm", rmStatus: rm.status };
  } catch (err) {
    // Gateway/network blip — leave the order pending; another trigger
    // (poll / cron / redirect) will settle it. Must never bubble.
    console.warn("[rm reconcile] failed:", err instanceof Error ? err.message : err);
    return { status: "pending", source: "error" };
  }
}
