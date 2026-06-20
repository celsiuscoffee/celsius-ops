import { NextRequest, NextResponse } from "next/server";
import { checkCronAuth } from "@celsius/shared";
import { supabaseAdmin } from "@/lib/loyalty/supabase";
import {
  birthdayPeriodKey,
  fetchTierRewardMap,
  runGrant,
} from "@/lib/loyalty/benefits";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

// GET /api/cron/grant-birthday
// Cron-triggered (daily). Issues the `birthday_reward` benefit to every
// member whose birthday falls on `?date=YYYY-MM-DD` (defaults to today
// UTC). Idempotent per calendar year. Auth: Bearer CRON_SECRET.
//
// Re-homed from the loyalty app (was loyalty.celsiuscoffee.com
// /api/loyalty/benefits/grant-birthday) as part of retiring that app.
export async function GET(request: NextRequest) {
  const cronAuth = checkCronAuth(request.headers);
  if (!cronAuth.ok) {
    return NextResponse.json({ error: cronAuth.error }, { status: cronAuth.status });
  }

  const url = new URL(request.url);
  const brandId = url.searchParams.get("brand_id") || "brand-celsius";
  const dateParam = url.searchParams.get("date");
  const targetDate = dateParam ? new Date(dateParam) : new Date();
  if (isNaN(targetDate.getTime())) {
    return NextResponse.json({ error: "invalid date" }, { status: 400 });
  }

  const periodKey = birthdayPeriodKey(targetDate);
  const month = targetDate.getUTCMonth() + 1;
  const day = targetDate.getUTCDate();

  const tierMap = await fetchTierRewardMap({ brandId, ruleType: "birthday_reward" });
  if (!tierMap.ok) return NextResponse.json({ error: tierMap.error }, { status: 500 });
  if (tierMap.map.size === 0) {
    return NextResponse.json({ period: periodKey, granted: 0, results: [] });
  }

  // Find members born on this month/day with a current tier in this brand.
  // Filter by month/day in JS — cheaper than computing across timezones in SQL.
  const { data: rawCandidates, error: candErr } = await supabaseAdmin
    .from("members")
    .select("id, birthday, member_brands!inner(brand_id, current_tier_id)")
    .eq("member_brands.brand_id", brandId)
    .not("birthday", "is", null);
  if (candErr) return NextResponse.json({ error: candErr.message }, { status: 500 });

  type Cand = {
    id: string;
    birthday: string | null;
    member_brands: { brand_id: string; current_tier_id: string | null }[];
  };
  const candidates = (((rawCandidates as unknown) as Cand[]) ?? [])
    .filter((m) => {
      if (!m.birthday) return false;
      const d = new Date(m.birthday);
      return d.getUTCMonth() + 1 === month && d.getUTCDate() === day;
    })
    .map((m) => ({
      memberId: m.id,
      // Default-tier members (no current tier) still get a birthday reward
      // — the runGrant fallback picks the first rule we found.
      tierId: m.member_brands?.[0]?.current_tier_id ?? null,
    }));

  const summary = await runGrant({
    brandId,
    benefitType: "birthday_reward",
    periodKey,
    rewardByTier: tierMap.map,
    candidates,
    fallbackToAnyReward: true,
  });

  return NextResponse.json({
    period: periodKey,
    date: `${targetDate.getUTCFullYear()}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`,
    processed: summary.results.length,
    granted: summary.granted,
    skipped: summary.skipped,
    errors: summary.errors,
    results: summary.results,
  });
}
