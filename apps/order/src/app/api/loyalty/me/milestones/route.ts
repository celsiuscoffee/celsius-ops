// GET /api/loyalty/me/milestones — every active milestone for the
// brand, with the caller's current progress against each one.
//
// Powers the pickup app's Milestones tab. We hand the client both
// the "earned" set (so the row can render its "Earned · date" pill)
// and the live counter for unearned rows (so "37 / 50 orders"
// renders even before the milestone-scan cron picks them up).

import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase/server";
import { resolveMember } from "@/lib/loyalty/v2-auth";

const BRAND_ID = (process.env.LOYALTY_BRAND_ID ?? "brand-celsius").trim();

type MilestoneRow = {
  id: string;
  title: string;
  description: string | null;
  icon: string | null;
  trigger_type: "lifetime_orders" | "lifetime_beans" | "distinct_outlets" | "streak_weeks";
  trigger_value: number;
  reward_voucher_template_ids: string[];
  reward_bonus_beans: number;
  reward_unlock: string | null;
};

type MilestoneOut = MilestoneRow & {
  progress_current: number;
  earned: boolean;
  earned_at: string | null;
};

export async function GET(req: NextRequest) {
  const r = await resolveMember(req);
  if (r.error) return r.error as unknown as NextResponse;

  const supabase = getSupabaseAdmin();
  const memberId = r.member.memberId;

  // All active milestones, ordered low → high threshold inside each
  // trigger_type so the list renders as a natural ladder.
  const { data: milestones } = await supabase
    .from("reward_milestones")
    .select(
      "id, title, description, icon, trigger_type, trigger_value, reward_voucher_template_ids, reward_bonus_beans, reward_unlock",
    )
    .eq("brand_id", BRAND_ID)
    .eq("is_active", true)
    .order("trigger_value", { ascending: true });

  if (!milestones || milestones.length === 0) {
    return NextResponse.json({ milestones: [] });
  }

  // Pre-fetch every signal we need so we never await inside the row
  // loop. lifetime_orders + lifetime_beans come from member_brands;
  // distinct_outlets is derived from the orders table; streak weeks
  // come from user_streaks.
  const [
    { data: brandRow },
    { data: orderRows },
    { data: streakRow },
    { data: earnedRows },
  ] = await Promise.all([
    supabase
      .from("member_brands")
      .select("total_visits, total_points_earned")
      .eq("member_id", memberId)
      .eq("brand_id", BRAND_ID)
      .maybeSingle(),
    supabase
      .from("orders")
      .select("store_id")
      .eq("loyalty_id", memberId)
      .in("status", ["preparing", "ready", "completed"])
      .not("store_id", "is", null),
    supabase
      .from("user_streaks")
      .select("longest_streak_weeks")
      .eq("member_id", memberId)
      .maybeSingle(),
    supabase
      .from("user_milestones_earned")
      .select("milestone_id, earned_at")
      .eq("member_id", memberId),
  ]);

  const lifetimeOrders   = (brandRow as { total_visits?: number } | null)?.total_visits ?? 0;
  const lifetimeBeans    = (brandRow as { total_points_earned?: number } | null)?.total_points_earned ?? 0;
  const distinctOutlets  = new Set((orderRows ?? []).map((o) => o.store_id as string)).size;
  const streakWeeks      = (streakRow as { longest_streak_weeks?: number } | null)?.longest_streak_weeks ?? 0;
  const earnedById       = new Map(
    (earnedRows ?? []).map((e) => [e.milestone_id as string, e.earned_at as string]),
  );

  const out: MilestoneOut[] = (milestones as MilestoneRow[]).map((m) => {
    let progress: number;
    switch (m.trigger_type) {
      case "lifetime_orders":  progress = lifetimeOrders;  break;
      case "lifetime_beans":   progress = lifetimeBeans;   break;
      case "distinct_outlets": progress = distinctOutlets; break;
      case "streak_weeks":     progress = streakWeeks;     break;
      default:                 progress = 0;
    }
    const earnedAt = earnedById.get(m.id) ?? null;
    return {
      ...m,
      progress_current: progress,
      earned: !!earnedAt,
      earned_at: earnedAt,
    };
  });

  return NextResponse.json({ milestones: out });
}
