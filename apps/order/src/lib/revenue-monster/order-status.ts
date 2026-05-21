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
}

export async function markRmOrderPaid(
  orderNumberOrId: { orderNumber?: string; orderId?: string },
  transactionId: string | null,
): Promise<RmOrderPaidResult | null> {
  const supabase = getSupabaseAdmin();
  const base = supabase
    .from("orders")
    .update({
      status: "preparing",
      payment_provider_ref: transactionId,
    } as Record<string, unknown>)
    .eq("status", "pending");
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
  };
}

export async function markRmOrderFailed(
  orderNumberOrId: { orderNumber?: string; orderId?: string },
): Promise<void> {
  const supabase = getSupabaseAdmin();
  const base = supabase
    .from("orders")
    .update({ status: "failed" } as Record<string, unknown>);
  const filtered = orderNumberOrId.orderId
    ? base.eq("id", orderNumberOrId.orderId)
    : base.eq("order_number", orderNumberOrId.orderNumber!);
  await filtered;
}
