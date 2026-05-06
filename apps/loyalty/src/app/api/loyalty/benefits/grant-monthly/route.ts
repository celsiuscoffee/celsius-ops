import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';
import {
  isAuthorizedCron,
  issueBenefit,
  monthlyPeriodKey,
  type BenefitRule,
  type GrantResult,
} from '@/lib/benefits';

// GET /api/loyalty/benefits/grant-monthly
// Cron-triggered. Issues each tier's `monthly_perk` benefit to every
// active member of that tier, idempotent per calendar month.
//
// Auth: Bearer CRON_SECRET. Vercel Cron sends this header automatically.
export async function GET(request: NextRequest) {
  if (!isAuthorizedCron(request)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const url = new URL(request.url);
  const brandId = url.searchParams.get('brand_id') || 'brand-celsius';
  const periodKey = monthlyPeriodKey(new Date());

  // 1. Pull every tier with a monthly_perk rule
  const { data: tiers, error: tiersErr } = await supabaseAdmin
    .from('tiers')
    .select('id, benefit_rules')
    .eq('brand_id', brandId)
    .eq('is_active', true);

  if (tiersErr) {
    return NextResponse.json({ error: tiersErr.message }, { status: 500 });
  }

  const tierMonthlyPerks = (tiers ?? [])
    .map((t) => {
      const rules = (t.benefit_rules ?? []) as BenefitRule[];
      const perk = rules.find((r) => r.type === 'monthly_perk');
      return perk && perk.type === 'monthly_perk'
        ? { tier_id: t.id, reward_id: perk.reward_id }
        : null;
    })
    .filter((x): x is { tier_id: string; reward_id: string } => x !== null);

  if (tierMonthlyPerks.length === 0) {
    return NextResponse.json({ period: periodKey, granted: 0, results: [] });
  }

  const tierIds = tierMonthlyPerks.map((p) => p.tier_id);
  const perkByTier = new Map(tierMonthlyPerks.map((p) => [p.tier_id, p.reward_id]));

  // 2. Find every member currently in one of those tiers
  const { data: memberBrands, error: mbErr } = await supabaseAdmin
    .from('member_brands')
    .select('member_id, current_tier_id')
    .eq('brand_id', brandId)
    .in('current_tier_id', tierIds);

  if (mbErr) {
    return NextResponse.json({ error: mbErr.message }, { status: 500 });
  }

  // 3. Issue per member (sequential — keeps DB pressure predictable)
  const results: GrantResult[] = [];
  for (const mb of memberBrands ?? []) {
    if (!mb.current_tier_id) continue;
    const rewardId = perkByTier.get(mb.current_tier_id);
    if (!rewardId) continue;

    const r = await issueBenefit({
      memberId: mb.member_id,
      brandId,
      tierId: mb.current_tier_id,
      benefitType: 'monthly_perk',
      periodKey,
      rewardId,
    });
    results.push(r);
  }

  const granted = results.filter((r) => r.status === 'granted').length;
  const skipped = results.filter((r) => r.status === 'skipped_already_granted').length;
  const errors = results.filter((r) => r.status === 'error').length;

  return NextResponse.json({
    period: periodKey,
    processed: results.length,
    granted,
    skipped,
    errors,
    results,
  });
}
