import { getSupabaseAdmin } from "@/lib/supabase/server";

/**
 * Order → notification attribution. When an order is created we look
 * for the most recent unattributed notification_sends row for the
 * same member within the last 24h and tag it with the order id +
 * revenue. The backoffice campaign stats then read attributed_*
 * to compute "orders driven" per campaign.
 *
 * Why 24h: that's the standard last-touch attribution window for
 * push. Anything longer and we start over-claiming credit for orders
 * that would have happened anyway.
 *
 * Why "any unattributed send" instead of only opened sends: a
 * customer may see the notification on the lock screen without
 * tapping it, then open the app via the icon and order. We still
 * want to credit the campaign that put the brand top-of-mind.
 *
 * Fire-and-forget — never blocks the order POST.
 */

const ATTRIBUTION_WINDOW_MS = 24 * 60 * 60 * 1000;

export async function attributeOrderToCampaign(args: {
  orderId: string;
  memberId: string | null;
  revenueRm: number;
}): Promise<void> {
  if (!args.memberId || !(args.revenueRm > 0)) return;
  try {
    const supabase = getSupabaseAdmin();
    const since = new Date(Date.now() - ATTRIBUTION_WINDOW_MS).toISOString();

    const { data: candidate } = await supabase
      .from("notification_sends")
      .select("id")
      .eq("member_id", args.memberId)
      .is("attributed_order_id", null)
      .gte("sent_at", since)
      .order("sent_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (!candidate) return;

    await supabase
      .from("notification_sends")
      .update({
        attributed_order_id: args.orderId,
        attributed_revenue:  args.revenueRm,
        attributed_at:       new Date().toISOString(),
      })
      .eq("id", (candidate as { id: string }).id);
  } catch (err) {
    // Attribution is best-effort. Failing here only affects stats,
    // never the customer's order or push delivery.
    console.error("[push/attribution] failed to attribute order", args.orderId, err);
  }
}
