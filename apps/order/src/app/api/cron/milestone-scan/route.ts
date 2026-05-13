export const dynamic = "force-dynamic";

// Periodic (e.g. every 6h): scan all members against active milestones.
// For each milestone whose trigger is met for a member and not yet
// recorded in user_milestones_earned, insert an earned row + issue
// any configured voucher templates.
//
// Lower-frequency than the order-time mission tracker because
// milestones are lifetime — they don't need second-level precision.

import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase/server";
import { checkCronAuth } from "@celsius/shared";
import { issueVoucher } from "@/lib/loyalty/v2";
import { awardBonusBeans } from "@/lib/loyalty/points";
import { notifyMilestoneEarned } from "@/lib/push/templates";

const BRAND_ID = (process.env.LOYALTY_BRAND_ID ?? "brand-celsius").trim();

type MilestoneRow = {
  id: string;
  title: string;
  trigger_type: "lifetime_orders" | "lifetime_beans" | "distinct_outlets" | "streak_weeks";
  trigger_value: number;
  reward_voucher_template_ids: string[];
  reward_bonus_beans: number;
};

export async function GET(req: NextRequest) {
  const cronAuth = checkCronAuth(req.headers);
  if (!cronAuth.ok) return NextResponse.json({ error: cronAuth.error }, { status: cronAuth.status });

  const supabase = getSupabaseAdmin();

  const { data: milestones } = await supabase
    .from("reward_milestones")
    .select("id, title, trigger_type, trigger_value, reward_voucher_template_ids, reward_bonus_beans")
    .eq("brand_id", BRAND_ID)
    .eq("is_active", true);

  if (!milestones || milestones.length === 0) return NextResponse.json({ scanned: 0, earned: 0 });

  // Members + their lifetime stats. brand_data carries totals; supplement
  // with user_streaks for streak-week triggers.
  const { data: members } = await supabase
    .from("members")
    .select("id, brand_data")
    .eq("brand_id", BRAND_ID);

  type MemberStats = {
    id: string;
    lifetime_orders: number;
    lifetime_beans: number;
  };
  const memberStats: MemberStats[] = ((members ?? []) as Array<{ id: string; brand_data: { total_visits?: number; total_points_earned?: number } | null }>).map((m) => ({
    id: m.id,
    lifetime_orders: m.brand_data?.total_visits ?? 0,
    lifetime_beans: m.brand_data?.total_points_earned ?? 0,
  }));

  // Streak weeks for streak_weeks milestones.
  const { data: streaks } = await supabase
    .from("user_streaks")
    .select("member_id, longest_streak_weeks");
  const streakByMember = new Map<string, number>(
    (streaks ?? []).map((s) => [s.member_id as string, s.longest_streak_weeks as number]),
  );

  // Distinct outlets for distinct_outlets milestones — derived per-member
  // from orders, run inline (this is a scan; cost is acceptable).
  async function distinctOutlets(memberId: string): Promise<number> {
    const { data: rows } = await supabase
      .from("orders")
      .select("store_id")
      .eq("loyalty_id", memberId)
      .in("status", ["preparing", "ready", "completed"])
      .not("store_id", "is", null);
    return new Set((rows ?? []).map((r) => r.store_id as string)).size;
  }

  let earned = 0;
  for (const m of milestones as MilestoneRow[]) {
    for (const member of memberStats) {
      let achieved = false;
      switch (m.trigger_type) {
        case "lifetime_orders":  achieved = member.lifetime_orders  >= m.trigger_value; break;
        case "lifetime_beans":   achieved = member.lifetime_beans   >= m.trigger_value; break;
        case "streak_weeks":     achieved = (streakByMember.get(member.id) ?? 0) >= m.trigger_value; break;
        case "distinct_outlets": achieved = (await distinctOutlets(member.id)) >= m.trigger_value; break;
      }
      if (!achieved) continue;

      // Idempotency — skip if already recorded.
      const { data: existing } = await supabase
        .from("user_milestones_earned")
        .select("id")
        .eq("member_id", member.id)
        .eq("milestone_id", m.id)
        .maybeSingle();
      if (existing) continue;

      // Record + grant. Order matters: the earned row goes in FIRST
      // so a crash mid-grant doesn't re-trigger the milestone on the
      // next scan and double-issue vouchers / double-credit beans.
      const { error: insertErr } = await supabase
        .from("user_milestones_earned")
        .insert({ member_id: member.id, milestone_id: m.id });
      // If the insert lost a race with another scanner, skip — the
      // unique (member_id, milestone_id) constraint already protected
      // us from a duplicate earn, and the original winner will have
      // (or will) award the reward.
      if (insertErr) continue;

      let issuedCount = 0;
      for (const tplId of m.reward_voucher_template_ids ?? []) {
        const v = await issueVoucher({
          memberId: member.id,
          templateId: tplId,
          sourceType: "milestone",
          sourceRefId: m.id,
        });
        if (v) issuedCount++;
      }

      // Credit reward_bonus_beans configured on the milestone. Was
      // ignored before — the backoffice exposes the field and the
      // four seeded milestones (50/200/500 etc.) all set it, but the
      // cron never read it. Wrapped in try/catch so a balance write
      // miss never blocks the rest of the scan.
      const bonus = m.reward_bonus_beans ?? 0;
      if (bonus > 0) {
        try {
          await awardBonusBeans({
            memberId: member.id,
            amount: bonus,
            description: `Milestone — ${m.title}`,
            referenceId: m.id,
            txnType: "milestone_bonus",
          });
        } catch (e) {
          console.warn("[milestone] bonus beans failed", e);
        }
      }

      // Fire-and-forget push so the customer feels the milestone land.
      notifyMilestoneEarned({
        memberId: member.id,
        milestoneTitle: m.title,
        voucherCount: issuedCount,
        bonusBeans: bonus,
      }).catch(() => {});

      earned++;
    }
  }

  return NextResponse.json({ scanned: milestones.length * memberStats.length, earned });
}
