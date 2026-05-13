export const dynamic = "force-dynamic";

// Nightly: increment or burn weekly streaks.
//
// Logic (run once daily at e.g. 02:00 MYT):
//   For each member with an order in the past 7 days → ensure their
//   streak reflects the current week's order. If they ordered THIS
//   week and haven't been bumped, increment current_streak_weeks.
//
//   On the first day of a new week (Monday MYT), check anyone whose
//   last_order_week_start is older than 2 weeks ago: burn their
//   streak unless they have a saver available — then consume the saver
//   instead.

import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase/server";
import { checkCronAuth } from "@celsius/shared";
import { notifyStreakChestReady } from "@/lib/push/templates";

const BRAND_ID = (process.env.LOYALTY_BRAND_ID ?? "brand-celsius").trim();
const MY_OFFSET_HOURS = 8;

function thisWeekStartIso(now = new Date()): string {
  const my = new Date(now.getTime() + MY_OFFSET_HOURS * 60 * 60 * 1000);
  const daysFromMonday = (my.getUTCDay() + 6) % 7;
  const mon = new Date(my);
  mon.setUTCDate(my.getUTCDate() - daysFromMonday);
  mon.setUTCHours(0, 0, 0, 0);
  return new Date(mon.getTime() - MY_OFFSET_HOURS * 60 * 60 * 1000).toISOString();
}

// Streak savers refill on this cadence. The schema comment says "once
// per quarter" — without this, every member only ever has the one
// saver they were created with, and once it's burned they're back to
// hard-burn mode forever. 90 days is the right anchor: each member
// gets a fresh saver three months after their last one was consumed.
const SAVER_REFILL_DAYS = 90;

export async function GET(req: NextRequest) {
  const cronAuth = checkCronAuth(req.headers);
  if (!cronAuth.ok) return NextResponse.json({ error: cronAuth.error }, { status: cronAuth.status });

  const supabase = getSupabaseAdmin();
  const weekStart = thisWeekStartIso();
  const twoWeeksAgo = new Date(Date.now() - 14 * 24 * 60 * 60 * 1000).toISOString();
  const saverRefillCutoff = new Date(
    Date.now() - SAVER_REFILL_DAYS * 24 * 60 * 60 * 1000,
  ).toISOString();

  // Tier ladder for chests. Cached once per cron run.
  const { data: tiers } = await supabase
    .from("streak_chest_tiers")
    .select("streak_floor, label, bonus_beans, voucher_template_id")
    .eq("brand_id", BRAND_ID)
    .order("streak_floor", { ascending: false });

  function tierForStreak(weeks: number) {
    for (const t of tiers ?? []) {
      if (weeks >= (t.streak_floor as number)) return t;
    }
    return null;
  }

  // Chests expire one full week after the qualifying week ends — gives
  // customers a 7-day buffer to come back and open it, but doesn't let
  // unclaimed chests pile up forever.
  function chestExpiry(weekStartIso: string): string {
    const weekMs = 7 * 24 * 60 * 60 * 1000;
    return new Date(new Date(weekStartIso).getTime() + 2 * weekMs).toISOString();
  }

  // 1) Members with a paid order this week → bump streak if not already
  //    bumped, AND mint a chest for this week (idempotent — unique
  //    on (member_id, brand_id, week_start)).
  const { data: ordering } = await supabase
    .from("orders")
    .select("loyalty_id")
    .gte("created_at", weekStart)
    .in("status", ["preparing", "ready", "completed"])
    .not("loyalty_id", "is", null);

  const uniqueMembers = Array.from(new Set((ordering ?? []).map((o) => o.loyalty_id as string)));

  let bumped = 0;
  let chestsMinted = 0;
  for (const memberId of uniqueMembers) {
    const { data: existing } = await supabase
      .from("user_streaks")
      .select("current_streak_weeks, longest_streak_weeks, last_order_week_start")
      .eq("member_id", memberId)
      .single();

    let currentForChest: number;
    if (existing && existing.last_order_week_start === weekStart) {
      // Already bumped this week — but we still need to make sure
      // the chest was minted (e.g. cron crashed between bump and
      // chest insert previously). Use the existing streak count.
      currentForChest = existing.current_streak_weeks as number;
    } else {
      const newCurrent = (existing?.current_streak_weeks ?? 0) + 1;
      const newLongest = Math.max(existing?.longest_streak_weeks ?? 0, newCurrent);
      await supabase.from("user_streaks").upsert({
        member_id: memberId,
        current_streak_weeks: newCurrent,
        longest_streak_weeks: newLongest,
        last_order_week_start: weekStart,
      });
      bumped++;
      currentForChest = newCurrent;
    }

    // Mint the chest for this week. Pick the highest tier the
    // current streak qualifies for.
    const tier = tierForStreak(currentForChest);
    if (!tier) continue;

    const { data: chestInsert, error: chestErr } = await supabase
      .from("streak_weekly_chests")
      .insert({
        member_id: memberId,
        brand_id: BRAND_ID,
        week_start: weekStart,
        streak_at_qualify: currentForChest,
        tier_floor: tier.streak_floor as number,
        expires_at: chestExpiry(weekStart),
      })
      .select("id")
      .single();

    // Unique-violation = chest already minted (we ran twice in the
    // same day, etc.). Skip the push but don't error.
    if (chestErr || !chestInsert) continue;

    chestsMinted++;

    // Fire-and-forget push so the customer knows there's a chest
    // waiting. Body teases the reward.
    notifyStreakChestReady({
      memberId,
      streakWeeks: currentForChest,
      label: tier.label as string,
      bonusBeans: tier.bonus_beans as number,
      hasVoucher: !!tier.voucher_template_id,
    }).catch(() => {});
  }

  // 2) Lapsed members (last order > 2 weeks ago) — burn streak or saver.
  const { data: lapsed } = await supabase
    .from("user_streaks")
    .select("member_id, current_streak_weeks, saver_available, last_order_week_start")
    .lt("last_order_week_start", twoWeeksAgo)
    .gt("current_streak_weeks", 0);

  let burned = 0;
  let saved = 0;
  for (const s of lapsed ?? []) {
    if (s.saver_available) {
      await supabase.from("user_streaks").update({
        saver_available: false,
        saver_last_used_at: new Date().toISOString(),
      }).eq("member_id", s.member_id);
      saved++;
    } else {
      await supabase.from("user_streaks").update({
        current_streak_weeks: 0,
      }).eq("member_id", s.member_id);
      burned++;
    }
  }

  // 3) Refill streak savers — anyone whose saver was consumed more
  // than SAVER_REFILL_DAYS ago gets it back. Matches the table's
  // "once per quarter" comment. Filtered on saver_last_used_at being
  // older than the cutoff so we never repeatedly toggle the same row.
  const { data: refillCandidates } = await supabase
    .from("user_streaks")
    .select("member_id")
    .eq("saver_available", false)
    .not("saver_last_used_at", "is", null)
    .lt("saver_last_used_at", saverRefillCutoff);

  let refilled = 0;
  for (const r of refillCandidates ?? []) {
    const { error } = await supabase
      .from("user_streaks")
      .update({ saver_available: true })
      .eq("member_id", r.member_id);
    if (!error) refilled++;
  }

  return NextResponse.json({
    week_start: weekStart,
    bumped,
    burned,
    saved,
    refilled,
    chests_minted: chestsMinted,
  });
}
