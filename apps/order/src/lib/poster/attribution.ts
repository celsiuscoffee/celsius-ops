import { getSupabaseAdmin } from "@/lib/supabase/server";

/**
 * Order → poster attribution. Mirrors push attribution (lib/push/attribution.ts):
 * when an order is created we tag the most recent unattributed poster tap for the
 * same member within 24h with the order id + revenue. The autopilot
 * (pos_poster_app_perf) then reads attributed_* to learn which poster drives the
 * highest-AOV orders and rotates toward it.
 *
 * Fire-and-forget — never blocks the order POST.
 */

const ATTRIBUTION_WINDOW_MS = 24 * 60 * 60 * 1000;

export async function attributeOrderToPoster(args: {
  orderId: string;
  memberId: string | null;
  revenueRm: number;
}): Promise<void> {
  if (!args.memberId || !(args.revenueRm > 0)) return;
  try {
    const supabase = getSupabaseAdmin();
    const since = new Date(Date.now() - ATTRIBUTION_WINDOW_MS).toISOString();

    const { data: candidate } = await supabase
      .from("poster_events")
      .select("id")
      .eq("loyalty_id", args.memberId)
      .eq("event_type", "tap")
      .is("attributed_order_id", null)
      .gte("created_at", since)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (!candidate) return;

    await supabase
      .from("poster_events")
      .update({
        attributed_order_id: args.orderId,
        attributed_revenue: args.revenueRm,
        attributed_at: new Date().toISOString(),
      })
      .eq("id", (candidate as { id: string }).id);
  } catch (err) {
    console.error("[poster/attribution] failed to attribute order", args.orderId, err);
  }
}
