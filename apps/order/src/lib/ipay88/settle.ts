import { after } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase/server";
import { markRmOrderPaid, markRmOrderFailed } from "@/lib/revenue-monster/order-status";
import { notifyOrderPreparing } from "@/lib/push/templates";
import { isIpay88Checkout, queryOrderCheckout } from "@/lib/payments/checkout-query";
import {
  IPAY88_CURRENCY,
  merchantForStore,
  parseAmountSen,
  verifyResponse,
  type Ipay88Response,
} from "./client";

/**
 * Settling iPay88 orders.
 *
 * An order is marked paid on exactly two kinds of proof, both of which need
 * either the merchant key or iPay88's own server:
 *   1. a response (ResponseURL browser post or BackendURL server post) whose
 *      HMAC signature verifies with the key of the outlet's merchant account,
 *      Status "1", MYR, and an amount equal to the order total; or
 *   2. iPay88's Requery answering "00" for the order's RefNo + total.
 * An unsigned, mis-signed or mismatched post is only a hint to requery — a
 * spoofed post can't mark an unpaid order paid.
 *
 * Status transitions reuse the RM helpers (markRmOrderPaid / markRmOrderFailed),
 * which are gateway-neutral: status-gated so duplicate triggers collapse, they
 * accept failed → paid (money received always wins), and they run the same
 * loyalty earn/burn + v2 hooks every paid order needs.
 */

type OrderRow = {
  id: string;
  order_number: string;
  status: string;
  store_id: string;
  total: number | null;
  payment_checkout_id: string | null;
};

export interface Ipay88SettleResult {
  orderId: string | null;
  status: string;
  source: "signed_response" | "requery" | "db" | "not_found" | "not_ipay88" | "error";
}

async function findOrder(by: { orderId?: string; orderNumber?: string }): Promise<OrderRow | null> {
  const sel = getSupabaseAdmin()
    .from("orders")
    .select("id, order_number, status, store_id, total, payment_checkout_id");
  const { data } = by.orderId
    ? await sel.eq("id", by.orderId).maybeSingle()
    : await sel.eq("order_number", by.orderNumber!).maybeSingle();
  return (data as OrderRow | null) ?? null;
}

async function settlePaid(row: OrderRow, transId: string | null): Promise<string> {
  const paid = await markRmOrderPaid({ orderId: row.id }, transId);
  if (paid && !paid.scheduled) {
    // "Brewing now" push — scheduled orders get it from promote-scheduled.
    after(async () => {
      await notifyOrderPreparing({
        orderId: paid.orderId,
        orderNumber: paid.orderNumber,
        customerPhone: paid.customerPhone,
      }).catch((e) => console.warn("[push] order_preparing ipay88", e));
    });
  }
  if (paid) return paid.scheduled ? "paid" : "preparing";
  // No transition — already settled by another trigger. Report what's there.
  return (await findOrder({ orderId: row.id }))?.status ?? row.status;
}

/** Ask iPay88 directly and settle on its answer. Never throws. */
export async function reconcileIpay88Order(by: { orderId?: string; orderNumber?: string }): Promise<Ipay88SettleResult> {
  try {
    const row = await findOrder(by);
    if (!row) return { orderId: null, status: "pending", source: "not_found" };
    if (row.status !== "pending" && row.status !== "failed") {
      return { orderId: row.id, status: row.status, source: "db" };
    }
    if (!isIpay88Checkout(row.payment_checkout_id)) {
      return { orderId: row.id, status: row.status, source: "not_ipay88" };
    }
    const q = await queryOrderCheckout({
      payment_checkout_id: row.payment_checkout_id!,
      store_id: row.store_id,
      total: row.total,
    });
    if (q.status === "SUCCESS") {
      return { orderId: row.id, status: await settlePaid(row, q.transactionId), source: "requery" };
    }
    if (q.status === "FAILED") {
      await markRmOrderFailed({ orderId: row.id }, "ipay88_failed");
      return { orderId: row.id, status: "failed", source: "requery" };
    }
    return { orderId: row.id, status: row.status, source: "requery" };
  } catch (err) {
    console.warn("[ipay88 reconcile] failed:", err instanceof Error ? err.message : err);
    return { orderId: by.orderId ?? null, status: "pending", source: "error" };
  }
}

/** Settle from a ResponseURL / BackendURL post. Never throws. */
export async function settleIpay88Response(r: Ipay88Response): Promise<Ipay88SettleResult> {
  try {
    if (!r.refNo) return { orderId: null, status: "pending", source: "not_found" };
    const row = await findOrder({ orderNumber: r.refNo });
    if (!row) {
      console.warn(`[ipay88] response for unknown RefNo ${r.refNo}`);
      return { orderId: null, status: "pending", source: "not_found" };
    }
    if (row.status !== "pending" && row.status !== "failed") {
      return { orderId: row.id, status: row.status, source: "db" };
    }

    const merchant = merchantForStore(row.store_id);
    const trusted =
      verifyResponse(r) &&
      merchant != null &&
      merchant.code === r.merchantCode &&
      r.currency === IPAY88_CURRENCY &&
      row.total != null &&
      parseAmountSen(r.amount) === row.total;

    if (trusted && r.status === "1") {
      return { orderId: row.id, status: await settlePaid(row, r.transId || null), source: "signed_response" };
    }
    if (trusted && r.status === "0") {
      // The customer can retry the same order, so this only fails a
      // still-pending row; a later success still settles it.
      const reason = r.errDesc ? `ipay88_failed: ${r.errDesc}`.slice(0, 200) : "ipay88_failed";
      await markRmOrderFailed({ orderId: row.id }, reason);
      return { orderId: row.id, status: "failed", source: "signed_response" };
    }
    if (!trusted) {
      console.warn(
        `[ipay88] response for ${r.refNo} did not verify (sig/merchant/amount) — requerying instead`,
      );
    }
    return reconcileIpay88Order({ orderId: row.id });
  } catch (err) {
    console.warn("[ipay88 settle] failed:", err instanceof Error ? err.message : err);
    return { orderId: null, status: "pending", source: "error" };
  }
}
