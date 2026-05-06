import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';
import {
  birthdayPeriodKey,
  isAuthorizedCron,
  issueBenefit,
  type BenefitRule,
  type GrantResult,
} from '@/lib/benefits';

// GET /api/loyalty/benefits/grant-birthday
// Cron-triggered (daily). Issues the `birthday_reward` benefit to
// every member whose birthday falls on `?date=YYYY-MM-DD` (defaults
// to today UTC). Idempotent per calendar year.
//
// Auth: Bearer CRON_SECRET.
export async function GET(request: NextRequest) {
  if (!isAuthorizedCron(request)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const url = new URL(request.url);
  const brandId = url.searchParams.get('brand_id') || 'brand-celsius';
  const dateParam = url.searchParams.get('date');
  const targetDate = dateParam ? new Date(dateParam) : new Date();
  if (isNaN(targetDate.getTime())) {
    return NextResponse.json({ error: 'invalid date' }, { status: 400 });
  }

  const periodKey = birthdayPeriodKey(targetDate);
  const month = targetDate.getUTCMonth() + 1;
  const day = targetDate.getUTCDate();

  // 1. Pull every tier with a birthday_reward rule
  const { data: tiers, error: tiersErr } = await supabaseAdmin
    .from('tiers')
    .select('id, benefit_rules')
    .eq('brand_id', brandId)
    .eq('is_active', true);

  if (tiersErr) {
    return NextResponse.json({ error: tiersErr.message }, { status: 500 });
  }

  const birthdayByTier = new Map<string, string>();
  for (const t of tiers ?? []) {
    const rules = (t.benefit_rules ?? []) as BenefitRule[];
    const r = rules.find((x) => x.type === 'birthday_reward');
    if (r && r.type === 'birthday_reward') {
      birthdayByTier.set(t.id, r.reward_id);
    }
  }

  if (birthdayByTier.size === 0) {
    return NextResponse.json({ period: periodKey, granted: 0, results: [] });
  }

  // 2. Find members born on this month/day with a current tier in this brand
  const { data: candidates, error: candErr } = await supabaseAdmin
    .from('members')
    .select('id, birthday, member_brands!inner(brand_id, current_tier_id)')
    .eq('member_brands.brand_id', brandId)
    .not('birthday', 'is', null);

  if (candErr) {
    return NextResponse.json({ error: candErr.message }, { status: 500 });
  }

  // Filter by month/day in JS — cheaper than computing across timezones in SQL.
  type Cand = {
    id: string;
    birthday: string | null;
    member_brands: { brand_id: string; current_tier_id: string | null }[];
  };
  const matching = ((candidates as unknown) as Cand[] ?? []).filter((m) => {
    if (!m.birthday) return false;
    const d = new Date(m.birthday);
    return d.getUTCMonth() + 1 === month && d.getUTCDate() === day;
  });

  // 3. Issue per member based on their tier
  const results: GrantResult[] = [];
  for (const m of matching) {
    const mb = m.member_brands?.[0];
    const tierId = mb?.current_tier_id ?? null;
    // Default-tier members (or no tier yet) still get the Bronze birthday
    // reward — pick the first birthday rule we find in the map
    const rewardId =
      (tierId && birthdayByTier.get(tierId)) ||
      birthdayByTier.values().next().value;
    if (!rewardId) continue;

    const r = await issueBenefit({
      memberId: m.id,
      brandId,
      tierId,
      benefitType: 'birthday_reward',
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
    date: `${targetDate.getUTCFullYear()}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`,
    processed: results.length,
    granted,
    skipped,
    errors,
    results,
  });
}
