import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * Reward double-spend guard for the two customer checkout routes.
 *
 * A reward is consumed (wallet voucher marked used / points burned) only when
 * an order is paid, so a customer could open several checkouts against the
 * same voucher or catalog reward, leave them all `pending`, and pay each one
 * on its own payment page. Before a new pending order is inserted, flip any
 * older pending order that references the same reward to `failed`, so only
 * the newest checkout can still complete.
 *
 * Residual: a payment page that is already open for a superseded order can
 * still pay it, and the reconcile-pending cron will honour a gateway "paid"
 * on a failed row (that is its existing retry semantics). The consume paths
 * remain the final authority: a voucher already marked used is refused there.
 */
export async function supersedePendingRewardOrders(
  supabase: SupabaseClient,
  args: { walletVoucherId: string | null; rewardId: string | null; memberId: string | null },
): Promise<number> {
  const { walletVoucherId, rewardId, memberId } = args;
  const match: [string, string][] = walletVoucherId
    ? [["wallet_voucher_id", walletVoucherId]]
    : rewardId && memberId
      ? [["reward_id", rewardId], ["loyalty_id", memberId]]
      : [];
  if (match.length === 0) return 0;
  let q = supabase.from("orders").update({ status: "failed" } as Record<string, unknown>).eq("status", "pending");
  for (const [col, val] of match) q = q.eq(col, val);
  const { data, error } = await q.select("id");
  if (error) {
    // Best-effort: a failed sweep must not block checkout; the consume path
    // still refuses an already-used voucher.
    console.warn("[reward-supersede] sweep failed:", error.message);
    return 0;
  }
  return data?.length ?? 0;
}
