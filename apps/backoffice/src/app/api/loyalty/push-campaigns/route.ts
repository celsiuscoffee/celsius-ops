import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/loyalty/supabase";
import { requireAuth } from "@/lib/auth";

/**
 * GET /api/loyalty/push-campaigns
 *
 * Returns every push-notification campaign with rolling 7d + 30d
 * stats — sent / opened / orders attributed / revenue attributed.
 * Backoffice list view reads this to render the table; the row
 * action (toggle on/off) hits PATCH on /[key].
 */
export async function GET(request: NextRequest) {
  const auth = await requireAuth(request);
  if (auth.error) return auth.error;

  const { data: campaigns, error } = await supabaseAdmin
    .from("notification_campaigns")
    .select("id, key, name, description, trigger_config, frequency_cap_count, frequency_cap_days, send_window_start_hour, send_window_end_hour, enabled, created_at, updated_at")
    .order("name", { ascending: true });

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const now    = Date.now();
  const day7   = new Date(now - 7  * 24 * 60 * 60 * 1000).toISOString();
  const day30  = new Date(now - 30 * 24 * 60 * 60 * 1000).toISOString();

  // Pull all sends from the last 30d in one query and bucket in
  // memory — avoids per-campaign queries growing with N. Even at
  // 100k sends/month this stays well under a single round-trip.
  const { data: sends } = await supabaseAdmin
    .from("notification_sends")
    .select("campaign_id, sent_at, opened_at, attributed_order_id, attributed_revenue, delivered_count")
    .gte("sent_at", day30);

  type Stats = {
    sent7: number; sent30: number;
    opened7: number; opened30: number;
    orders7: number; orders30: number;
    revenue7: number; revenue30: number;
  };
  const empty = (): Stats => ({ sent7: 0, sent30: 0, opened7: 0, opened30: 0, orders7: 0, orders30: 0, revenue7: 0, revenue30: 0 });
  const byCampaign = new Map<string, Stats>();

  for (const s of (sends ?? []) as Array<{ campaign_id: string; sent_at: string; opened_at: string | null; attributed_order_id: string | null; attributed_revenue: number | null; delivered_count: number }>) {
    const stats = byCampaign.get(s.campaign_id) ?? empty();
    const sentAt = s.sent_at;
    stats.sent30 += s.delivered_count;
    if (s.opened_at) stats.opened30++;
    if (s.attributed_order_id) {
      stats.orders30++;
      stats.revenue30 += Number(s.attributed_revenue ?? 0);
    }
    if (sentAt >= day7) {
      stats.sent7 += s.delivered_count;
      if (s.opened_at) stats.opened7++;
      if (s.attributed_order_id) {
        stats.orders7++;
        stats.revenue7 += Number(s.attributed_revenue ?? 0);
      }
    }
    byCampaign.set(s.campaign_id, stats);
  }

  const rows = (campaigns ?? []).map((c) => {
    const stats = byCampaign.get((c as { id: string }).id) ?? empty();
    return { ...c, stats };
  });

  return NextResponse.json({ campaigns: rows });
}
