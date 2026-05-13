// POST /api/loyalty/me/streak/chests/[chestId]/claim
//
// The customer taps "Open chest" on the Challenges tab. We:
//   1. Load the chest + verify it belongs to this caller, isn't
//      expired, and hasn't been claimed already.
//   2. Look up the tier config (rewards live in streak_chest_tiers,
//      keyed by streak_floor at qualify time).
//   3. Issue the voucher (if any), credit bonus Beans (if any).
//   4. Stamp claimed_at + claim_outcome snapshot.
//
// Idempotent: a duplicate POST hits the claimed_at check and returns
// the cached outcome.

import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase/server";
import { resolveMember } from "@/lib/loyalty/v2-auth";
import { issueVoucher } from "@/lib/loyalty/v2";
import { awardBonusBeans } from "@/lib/loyalty/points";

const BRAND_ID = (process.env.LOYALTY_BRAND_ID ?? "brand-celsius").trim();

type ChestClaimOutcome = {
  bonus_beans: number;
  voucher_id: string | null;
  voucher_title: string | null;
  label: string;
  emoji: string;
};

export async function POST(
  req: NextRequest,
  ctx: { params: Promise<{ chestId: string }> },
) {
  const r = await resolveMember(req);
  if (r.error) return r.error as unknown as NextResponse;

  const { chestId } = await ctx.params;
  const supabase = getSupabaseAdmin();
  const memberId = r.member.memberId;

  const { data: chest } = await supabase
    .from("streak_weekly_chests")
    .select("id, member_id, brand_id, tier_floor, expires_at, claimed_at, claim_outcome")
    .eq("id", chestId)
    .maybeSingle();

  if (!chest || chest.member_id !== memberId || chest.brand_id !== BRAND_ID) {
    return NextResponse.json({ error: "Chest not found." }, { status: 404 });
  }

  if (chest.claimed_at) {
    return NextResponse.json({
      already_claimed: true,
      claimed_at: chest.claimed_at,
      outcome: (chest.claim_outcome as ChestClaimOutcome | null) ?? {
        bonus_beans: 0,
        voucher_id: null,
        voucher_title: null,
        label: "Chest",
        emoji: "🎁",
      },
    });
  }

  if (new Date(chest.expires_at as string).getTime() < Date.now()) {
    return NextResponse.json(
      { error: "This chest expired. Keep your streak going to earn the next one." },
      { status: 410 },
    );
  }

  // Pull the tier — this is the source of truth for what the chest
  // contains. Looked up by (brand_id, streak_floor) so a backoffice
  // tier edit applies to all unclaimed chests at that floor.
  const { data: tier } = await supabase
    .from("streak_chest_tiers")
    .select("label, bonus_beans, voucher_template_id, emoji")
    .eq("brand_id", BRAND_ID)
    .eq("streak_floor", chest.tier_floor)
    .maybeSingle();

  if (!tier) {
    return NextResponse.json(
      { error: "This chest's reward tier is no longer configured." },
      { status: 410 },
    );
  }

  const bonusBeans = (tier.bonus_beans as number) ?? 0;
  const templateId = (tier.voucher_template_id as string | null) ?? null;

  // Issue voucher (if any).
  let voucherId: string | null = null;
  let voucherTitle: string | null = null;
  if (templateId) {
    const v = await issueVoucher({
      memberId,
      templateId,
      sourceType: "milestone",  // reuse the milestone source bucket for streak rewards
      sourceRefId: chestId,
    });
    if (v) {
      voucherId = v.id;
      voucherTitle = (v as { title?: string | null }).title ?? null;
    }
  }

  // Credit beans.
  if (bonusBeans > 0) {
    try {
      await awardBonusBeans({
        memberId,
        amount: bonusBeans,
        description: `Streak chest — ${tier.label as string}`,
        referenceId: chestId,
        txnType: "milestone_bonus",
      });
    } catch (e) {
      console.warn("[streak-chest] bonus beans failed", e);
    }
  }

  const outcome: ChestClaimOutcome = {
    bonus_beans: bonusBeans,
    voucher_id: voucherId,
    voucher_title: voucherTitle,
    label: tier.label as string,
    emoji: (tier.emoji as string) ?? "🎁",
  };

  // Stamp claimed_at — conditional on claimed_at IS NULL so two
  // simultaneous taps can't double-issue.
  const { error: stampErr } = await supabase
    .from("streak_weekly_chests")
    .update({
      claimed_at: new Date().toISOString(),
      claim_outcome: outcome,
    })
    .eq("id", chestId)
    .is("claimed_at", null);

  if (stampErr) {
    // Lost the race — return whatever the winner stored.
    const { data: fresh } = await supabase
      .from("streak_weekly_chests")
      .select("claimed_at, claim_outcome")
      .eq("id", chestId)
      .maybeSingle();
    return NextResponse.json({
      already_claimed: true,
      claimed_at: fresh?.claimed_at ?? null,
      outcome: (fresh?.claim_outcome as ChestClaimOutcome | null) ?? outcome,
    });
  }

  return NextResponse.json({
    already_claimed: false,
    claimed_at: new Date().toISOString(),
    outcome,
  });
}
