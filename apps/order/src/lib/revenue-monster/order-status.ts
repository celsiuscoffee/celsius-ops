import { getSupabaseAdmin } from "@/lib/supabase/server";
import { earnLoyaltyPoints, deductLoyaltyPoints } from "@/lib/loyalty/points";
import { applyOrderV2Hooks } from "@/lib/loyalty/v2";

// Shared between the RM webhook and the poll endpoint. Idempotent — both
// callers gate the update on `status = 'pending'` so a duplicate delivery
// (webhook + poll racing) doesn't double-earn points or double-deduct
// rewards. Returns the order fields the caller needs to fire the
// "Brewing now" push, or null if no row was transitioned.
//
// Mirrors the Stripe confirm-stripe path: in addition to flipping status
// and earning/burning points, it also runs the v2 hooks
// (wallet-voucher consumption, mission progress, mystery drop mint,
// referral payoff). Without that, RM-paid orders never got a mystery
// bean to reveal — the customer noticed.
export interface RmOrderPaidResult {
  orderId:       string;
  orderNumber:   string;
  customerPhone: string | null;
  /** True when the order was held in "paid" (scheduled for later
   *  pickup) rather than promoted straight to "preparing". Callers
   *  should suppress the "Brewing now" push in this case — the
   *  promote-scheduled cron fires that push when it flips the row to
   *  preparing inside the brew window. */
  scheduled:     boolean;
}

/**
 * Decide whether a paid order should sit in "paid" (held for
 * scheduled pickup) or go straight to "preparing".
 *
 * Holds when pickup_at - prep_time > now. prep_time defaults to 10
 * min if the outlet's pickup_time_mins isn't available. The
 * promote-scheduled cron flips held rows to preparing when this
 * condition becomes false.
 */
export function shouldHoldForScheduled(
  pickupAt: string | null,
  prepTimeMins: number = 10,
): boolean {
  if (!pickupAt) return false;
  const at = new Date(pickupAt).getTime();
  if (Number.isNaN(at)) return false;
  const brewWindowOpensAt = at - prepTimeMins * 60_000;
  return Date.now() < brewWindowOpensAt;
}

export async function markRmOrderPaid(
  orderNumberOrId: { orderNumber?: string; orderId?: string },
  transactionId: string | null,
): Promise<RmOrderPaidResult | null> {
  const supabase = getSupabaseAdmin();
  // First look up the row to read pickup_at + outlet prep_time so we
  // can decide whether to flip status to "paid" (hold for scheduled
  // pickup) or "preparing" (brew now). We do this BEFORE the update
  // so the eq("status", "pending") guard still works.
  const filterBuilder = supabase.from("orders").select(
    "id, order_number, customer_phone, loyalty_id, loyalty_points_earned, reward_id, store_id, created_at, wallet_voucher_id, pickup_at",
  );
  const peeked = orderNumberOrId.orderId
    ? await filterBuilder.eq("id", orderNumberOrId.orderId).maybeSingle()
    : await filterBuilder.eq("order_number", orderNumberOrId.orderNumber!).maybeSingle();
  type Row = {
    id: string;
    order_number: string;
    customer_phone: string | null;
    loyalty_id: string | null;
    loyalty_points_earned: number;
    reward_id: string | null;
    store_id: string;
    created_at: string;
    wallet_voucher_id: string | null;
    pickup_at: string | null;
  };
  const peekedRow = peeked.data as Row | null;
  let prepTimeMins = 10;
  if (peekedRow?.store_id) {
    const { data: outlet } = await supabase
      .from("outlet_settings")
      .select("pickup_time_mins")
      .eq("store_id", peekedRow.store_id)
      .maybeSingle();
    const ptm = (outlet as { pickup_time_mins?: number } | null)?.pickup_time_mins;
    if (typeof ptm === "number" && ptm > 0) prepTimeMins = ptm;
  }
  const scheduled = shouldHoldForScheduled(peekedRow?.pickup_at ?? null, prepTimeMins);
  const nextStatus = scheduled ? "paid" : "preparing";

  const base = supabase
    .from("orders")
    .update({
      status: nextStatus,
      payment_provider_ref: transactionId,
      // A failed → paid rescue must clear the stale failure reason, or the
      // backoffice shows "rm_expired" on an order that was actually paid.
      payment_failure_reason: null,
    } as Record<string, unknown>)
    // A paid event must settle the order even if a stale/abandoned checkout
    // — or the expire-orders cron — already flipped it to "failed". Money
    // received always wins. Still a no-op for already-settled rows
    // (preparing/paid), so duplicate deliveries don't re-earn points.
    .in("status", ["pending", "failed"]);
  const filtered = orderNumberOrId.orderId
    ? base.eq("id", orderNumberOrId.orderId)
    : base.eq("order_number", orderNumberOrId.orderNumber!);
  const { data: order } = await filtered
    .select("id, order_number, customer_phone, loyalty_id, loyalty_points_earned, reward_id, store_id, created_at, wallet_voucher_id")
    .single<{
      id: string;
      order_number: string;
      customer_phone: string | null;
      loyalty_id: string | null;
      loyalty_points_earned: number;
      reward_id: string | null;
      store_id: string;
      created_at: string;
      wallet_voucher_id: string | null;
    }>();

  if (!order) return null;

  if (order.loyalty_id) {
    if (order.loyalty_points_earned > 0) {
      await earnLoyaltyPoints(
        order.loyalty_id,
        order.id,
        order.loyalty_points_earned,
        order.store_id,
      );
    }
    if (order.reward_id) {
      const ok = await deductLoyaltyPoints(order.loyalty_id, order.reward_id, order.store_id);
      if (!ok) {
        console.error(
          `[loyalty] markRmOrderPaid: FAILED to deduct points for order=${order.id} reward=${order.reward_id} — RECONCILE MANUALLY`,
        );
      }
    }
    // V2 hooks — mint mystery drop, advance missions, pay referrals,
    // consume wallet voucher. Catches so a hook failure can't undo the
    // already-committed status transition.
    try {
      await applyOrderV2Hooks({
        memberId:        order.loyalty_id,
        orderId:         order.id,
        outletId:        order.store_id,
        orderCreatedAt:  order.created_at,
        walletVoucherId: order.wallet_voucher_id,
      });
    } catch (e) {
      console.error(`[loyalty] markRmOrderPaid: v2 hooks failed for order=${order.id}`, e);
    }
  }
  return {
    orderId:       order.id,
    orderNumber:   order.order_number,
    customerPhone: order.customer_phone,
    scheduled,
  };
}

export async function markRmOrderFailed(
  orderNumberOrId: { orderNumber?: string; orderId?: string },
  reason?: string | null,
): Promise<void> {
  const supabase = getSupabaseAdmin();
  const base = supabase
    .from("orders")
    // Record WHY it failed (RM FAILED/CANCELLED/EXPIRED, or an abandon reason)
    // so the backoffice/audit can show the real cause instead of a bare "failed".
    .update({ status: "failed", payment_failure_reason: reason ?? null } as Record<string, unknown>)
    // Only a still-"pending" order may be failed. A stale/abandoned checkout
    // or a late FAILED webhook must NEVER knock a paid/preparing order back to
    // failed — that conflation was the double-charge / no-order root cause.
    .eq("status", "pending");
  const filtered = orderNumberOrId.orderId
    ? base.eq("id", orderNumberOrId.orderId)
    : base.eq("order_number", orderNumberOrId.orderNumber!);
  await filtered;
}
