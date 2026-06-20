// Tier benefit grants — birthday rewards + monthly perks.
//
// Ported verbatim from the (retiring) loyalty app's src/lib/benefits.ts so
// the grant-birthday / grant-monthly crons can run from backoffice instead
// of loyalty.celsiuscoffee.com. The ONLY change is the Supabase client: this
// uses backoffice's `@/lib/loyalty/supabase` admin client, which points at
// the same shared loyalty DB (LOYALTY_SUPABASE_* env vars) the loyalty app
// used. Cron auth lives in the route handlers (@celsius/shared checkCronAuth),
// so the loyalty `isAuthorizedCron` helper was dropped on the way over.

import { supabaseAdmin } from "@/lib/loyalty/supabase";
import { randomInt } from "crypto";

// ─── Types ─────────────────────────────────────────

export type BenefitRule =
  | { type: "points_multiplier"; value: number }
  | { type: "birthday_reward"; reward_id: string }
  | { type: "monthly_perk"; reward_id: string; label?: string }
  | { type: "early_access"; label?: string }
  | { type: "exclusive_event"; label?: string };

export interface GrantResult {
  member_id: string;
  tier_id: string;
  benefit_type: "birthday_reward" | "monthly_perk";
  reward_id: string;
  status: "granted" | "skipped_already_granted" | "skipped_no_reward" | "error";
  error?: string;
}

// ─── Period keys ───────────────────────────────────

export function birthdayPeriodKey(d: Date): string {
  return String(d.getUTCFullYear());
}

export function monthlyPeriodKey(d: Date): string {
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, "0");
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
  benefitType: "birthday_reward" | "monthly_perk";
  periodKey: string;
  rewardId: string;
}): Promise<GrantResult> {
  const { memberId, brandId, tierId, benefitType, periodKey, rewardId } = args;

  // 1. Look up the reward to get validity_days
  const { data: reward, error: rewardErr } = await supabaseAdmin
    .from("rewards")
    .select("id, validity_days, is_active")
    .eq("id", rewardId)
    .single();

  if (rewardErr || !reward || !reward.is_active) {
    return {
      member_id: memberId,
      tier_id: tierId ?? "",
      benefit_type: benefitType,
      reward_id: rewardId,
      status: "skipped_no_reward",
      error: rewardErr?.message,
    };
  }

  // 2. Try to claim the grant slot. If it already exists, this errors
  //    on the unique constraint and we know the benefit was already issued.
  const grantId = `tbg-${benefitType}-${Date.now()}-${randomInt(1000, 9999)}`;
  const { error: grantErr } = await supabaseAdmin
    .from("tier_benefit_grants")
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
    if (grantErr.code === "23505") {
      // Unique violation — already granted this period
      return {
        member_id: memberId,
        tier_id: tierId ?? "",
        benefit_type: benefitType,
        reward_id: rewardId,
        status: "skipped_already_granted",
      };
    }
    return {
      member_id: memberId,
      tier_id: tierId ?? "",
      benefit_type: benefitType,
      reward_id: rewardId,
      status: "error",
      error: grantErr.message,
    };
  }

  // 3. Issue the reward
  const validityDays = reward.validity_days ?? 30;
  const expiresAt = new Date(
    Date.now() + validityDays * 24 * 60 * 60 * 1000,
  ).toISOString();
  const issuedId = `ir-${benefitType.replace("_", "-")}-${Date.now()}-${randomInt(1000, 9999)}`;

  const { error: irErr } = await supabaseAdmin.from("issued_rewards").insert({
    id: issuedId,
    member_id: memberId,
    reward_id: rewardId,
    brand_id: brandId,
    issued_at: new Date().toISOString(),
    expires_at: expiresAt,
    status: "active",
    code: issuedId,
    year: new Date().getFullYear(),
  });

  if (irErr) {
    // Rollback the grant claim so the next run can retry
    await supabaseAdmin.from("tier_benefit_grants").delete().eq("id", grantId);
    return {
      member_id: memberId,
      tier_id: tierId ?? "",
      benefit_type: benefitType,
      reward_id: rewardId,
      status: "error",
      error: irErr.message,
    };
  }

  // 4. Backfill issued_reward_id on the grant row
  await supabaseAdmin
    .from("tier_benefit_grants")
    .update({ issued_reward_id: issuedId })
    .eq("id", grantId);

  return {
    member_id: memberId,
    tier_id: tierId ?? "",
    benefit_type: benefitType,
    reward_id: rewardId,
    status: "granted",
  };
}

// ─── Cron-grant shared helpers ─────────────────────
// Both grant-birthday and grant-monthly run the same shape:
//   1. Pull active tiers, extract a Map<tier_id, reward_id> from a single
//      benefit-rule type.
//   2. Build a member candidate list (the differing part).
//   3. Loop issueBenefit, aggregate {granted, skipped, errors}.
// Extracted here so the routes can stay tiny and never drift.

type GrantBenefitType = GrantResult["benefit_type"];

export async function fetchTierRewardMap(args: {
  brandId: string;
  ruleType: GrantBenefitType;
}): Promise<{ ok: true; map: Map<string, string> } | { ok: false; error: string }> {
  const { data: tiers, error } = await supabaseAdmin
    .from("tiers")
    .select("id, benefit_rules")
    .eq("brand_id", args.brandId)
    .eq("is_active", true);
  if (error) return { ok: false, error: error.message };

  const map = new Map<string, string>();
  for (const t of tiers ?? []) {
    const rules = (t.benefit_rules ?? []) as BenefitRule[];
    const r = rules.find((x) => x.type === args.ruleType);
    if (r && (r.type === "birthday_reward" || r.type === "monthly_perk") && r.reward_id) {
      map.set(t.id, r.reward_id);
    }
  }
  return { ok: true, map };
}

export async function runGrant(args: {
  brandId: string;
  benefitType: GrantBenefitType;
  periodKey: string;
  rewardByTier: Map<string, string>;
  candidates: Array<{ memberId: string; tierId: string | null }>;
  // Birthday lets default-tier members fall back to the first available reward
  // (e.g. Bronze birthday reward when the member doesn't have a current tier).
  // Monthly does not — no tier, no perk.
  fallbackToAnyReward?: boolean;
}): Promise<{ results: GrantResult[]; granted: number; skipped: number; errors: number }> {
  const fallback = args.fallbackToAnyReward
    ? args.rewardByTier.values().next().value
    : null;

  const results: GrantResult[] = [];
  for (const c of args.candidates) {
    const rewardId = (c.tierId && args.rewardByTier.get(c.tierId)) || fallback;
    if (!rewardId) continue;
    const r = await issueBenefit({
      memberId: c.memberId,
      brandId: args.brandId,
      tierId: c.tierId,
      benefitType: args.benefitType,
      periodKey: args.periodKey,
      rewardId,
    });
    results.push(r);
  }

  return {
    results,
    granted: results.filter((r) => r.status === "granted").length,
    skipped: results.filter((r) => r.status === "skipped_already_granted").length,
    errors: results.filter((r) => r.status === "error").length,
  };
}
