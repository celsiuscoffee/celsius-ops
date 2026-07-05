import { NextRequest, NextResponse } from "next/server";
import { cronRoute } from "@/lib/cron-monitor";
import { supabaseAdmin } from "@/lib/loyalty/supabase";
import {
  fetchTierRewardMap,
  monthlyPeriodKey,
  runGrant,
} from "@/lib/loyalty/benefits";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

// GET /api/cron/grant-monthly
// Cron-triggered (monthly). Issues each tier's `monthly_perk` benefit to every
// active member of that tier, idempotent per calendar month. Auth: Bearer
// CRON_SECRET. Vercel Cron sends this header automatically.
//
// Re-homed from the loyalty app (was loyalty.celsiuscoffee.com
// /api/loyalty/benefits/grant-monthly) as part of retiring that app.
async function runGrantMonthly(request: NextRequest) {
  const url = new URL(request.url);
  const brandId = url.searchParams.get("brand_id") || "brand-celsius";
  const periodKey = monthlyPeriodKey(new Date());

  const tierMap = await fetchTierRewardMap({ brandId, ruleType: "monthly_perk" });
  if (!tierMap.ok) return NextResponse.json({ error: tierMap.error }, { status: 500 });
  if (tierMap.map.size === 0) {
    return NextResponse.json({ period: periodKey, granted: 0, results: [] });
  }

  // Every member currently in one of the perk-bearing tiers
  const { data: memberBrands, error: mbErr } = await supabaseAdmin
    .from("member_brands")
    .select("member_id, current_tier_id")
    .eq("brand_id", brandId)
    .in("current_tier_id", Array.from(tierMap.map.keys()));
  if (mbErr) return NextResponse.json({ error: mbErr.message }, { status: 500 });

  const candidates = (memberBrands ?? [])
    .filter((mb): mb is { member_id: string; current_tier_id: string } => !!mb.current_tier_id)
    .map((mb) => ({ memberId: mb.member_id, tierId: mb.current_tier_id }));

  const summary = await runGrant({
    brandId,
    benefitType: "monthly_perk",
    periodKey,
    rewardByTier: tierMap.map,
    candidates,
  });

  return NextResponse.json({
    period: periodKey,
    processed: summary.results.length,
    granted: summary.granted,
    skipped: summary.skipped,
    errors: summary.errors,
    results: summary.results,
  });
}

export const GET = cronRoute("grant-monthly", runGrantMonthly);
