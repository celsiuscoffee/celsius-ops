import { supabaseAdmin } from '@/lib/supabase';
import { randomInt } from 'crypto';

// ─── Types ─────────────────────────────────────────

export type BenefitRule =
  | { type: 'points_multiplier'; value: number }
  | { type: 'birthday_reward'; reward_id: string }
  | { type: 'monthly_perk'; reward_id: string; label?: string }
  | { type: 'early_access'; label?: string }
  | { type: 'exclusive_event'; label?: string };

export interface GrantResult {
  member_id: string;
  tier_id: string;
  benefit_type: 'birthday_reward' | 'monthly_perk';
  reward_id: string;
  status: 'granted' | 'skipped_already_granted' | 'skipped_no_reward' | 'error';
  error?: string;
}

// ─── Period keys ───────────────────────────────────

export function birthdayPeriodKey(d: Date): string {
  return String(d.getUTCFullYear());
}

export function monthlyPeriodKey(d: Date): string {
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, '0');
  return `${y}-${m}`;
}

// ─── Issue a reward + record the grant atomically ──
// The UNIQUE(member_id, benefit_type, period_key) on tier_benefit_grants
// is the idempotency key — we insert into the ledger first, and on
// conflict we skip the issued_reward write.

export async function issueBenefit(args: {
  memberId: string;
  brandId: string;
  tierId: string | null;
  benefitType: 'birthday_reward' | 'monthly_perk';
  periodKey: string;
  rewardId: string;
}): Promise<GrantResult> {
  const { memberId, brandId, tierId, benefitType, periodKey, rewardId } = args;

  // 1. Look up the reward to get validity_days
  const { data: reward, error: rewardErr } = await supabaseAdmin
    .from('rewards')
    .select('id, validity_days, is_active')
    .eq('id', rewardId)
    .single();

  if (rewardErr || !reward || !reward.is_active) {
    return {
      member_id: memberId,
      tier_id: tierId ?? '',
      benefit_type: benefitType,
      reward_id: rewardId,
      status: 'skipped_no_reward',
      error: rewardErr?.message,
    };
  }

  // 2. Try to claim the grant slot. If it already exists, this errors
  //    on the unique constraint and we know the benefit was already issued.
  const grantId = `tbg-${benefitType}-${Date.now()}-${randomInt(1000, 9999)}`;
  const { error: grantErr } = await supabaseAdmin
    .from('tier_benefit_grants')
    .insert({
      id: grantId,
      member_id: memberId,
      brand_id: brandId,
      tier_id: tierId,
      benefit_type: benefitType,
      period_key: periodKey,
      issued_reward_id: null, // backfilled below
    });

  if (grantErr) {
    if (grantErr.code === '23505') {
      // Unique violation — already granted this period
      return {
        member_id: memberId,
        tier_id: tierId ?? '',
        benefit_type: benefitType,
        reward_id: rewardId,
        status: 'skipped_already_granted',
      };
    }
    return {
      member_id: memberId,
      tier_id: tierId ?? '',
      benefit_type: benefitType,
      reward_id: rewardId,
      status: 'error',
      error: grantErr.message,
    };
  }

  // 3. Issue the reward
  const validityDays = reward.validity_days ?? 30;
  const expiresAt = new Date(
    Date.now() + validityDays * 24 * 60 * 60 * 1000
  ).toISOString();
  const issuedId = `ir-${benefitType.replace('_', '-')}-${Date.now()}-${randomInt(1000, 9999)}`;

  const { error: irErr } = await supabaseAdmin.from('issued_rewards').insert({
    id: issuedId,
    member_id: memberId,
    reward_id: rewardId,
    brand_id: brandId,
    issued_at: new Date().toISOString(),
    expires_at: expiresAt,
    status: 'active',
    code: issuedId,
    year: new Date().getFullYear(),
  });

  if (irErr) {
    // Rollback the grant claim so the next run can retry
    await supabaseAdmin.from('tier_benefit_grants').delete().eq('id', grantId);
    return {
      member_id: memberId,
      tier_id: tierId ?? '',
      benefit_type: benefitType,
      reward_id: rewardId,
      status: 'error',
      error: irErr.message,
    };
  }

  // 4. Backfill issued_reward_id on the grant row
  await supabaseAdmin
    .from('tier_benefit_grants')
    .update({ issued_reward_id: issuedId })
    .eq('id', grantId);

  return {
    member_id: memberId,
    tier_id: tierId ?? '',
    benefit_type: benefitType,
    reward_id: rewardId,
    status: 'granted',
  };
}

// ─── Cron auth ─────────────────────────────────────

export function isAuthorizedCron(request: Request): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return false;
  const provided =
    request.headers.get('authorization')?.replace(/^Bearer\s+/i, '') ??
    request.headers.get('x-cron-secret');
  return provided === secret;
}
