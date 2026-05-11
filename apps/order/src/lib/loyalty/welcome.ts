// src/lib/loyalty/welcome.ts
// Issue new-member auto_issue rewards (Welcome BOGO etc.) on first
// pickup-app sign-in. Idempotent — checks issued_rewards for ANY prior
// row (active/used/expired) before issuing, so logins after the first
// don't pile up duplicates.
//
// Why this lives in the order app rather than the loyalty service:
// the policy is "members get the BOGO when they first sign in via the
// pickup app." Members created via POS or backoffice don't get it at
// creation — they only get it when they later log into the app. The
// order-app's otp/verify proxy is the only place that knows the
// signal "this is a pickup-app sign-in," so the issuance hook lives
// alongside it.

import { after } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase/server";
import { notifyWelcomeBonus } from "@/lib/push/templates";

const BRAND_ID = "brand-celsius";

export async function ensureNewMemberRewards(
  memberId: string,
  brandId: string = BRAND_ID,
): Promise<void> {
  try {
    const supabase = getSupabaseAdmin();

    // Pull every active new_member auto_issue reward for the brand.
    // Usually one (Welcome BOGO) but the loop tolerates multiple.
    const { data: rewards } = await supabase
      .from("rewards")
      .select("id, name, validity_days")
      .eq("brand_id", brandId)
      .eq("reward_type", "new_member")
      .eq("auto_issue", true)
      .eq("is_active", true);

    if (!rewards || rewards.length === 0) return;

    for (const reward of rewards) {
      // Idempotency gate: if this member has EVER been issued this
      // reward (active, used, or expired), do nothing. We don't want
      // to re-issue a fresh voucher to someone who already redeemed
      // theirs months ago.
      const { count } = await supabase
        .from("issued_rewards")
        .select("id", { count: "exact", head: true })
        .eq("member_id", memberId)
        .eq("brand_id", brandId)
        .eq("reward_id", reward.id);

      if ((count ?? 0) > 0) continue;

      const validityDays = (reward.validity_days as number | null) ?? 30;
      const expiresAt = new Date(
        Date.now() + validityDays * 24 * 60 * 60 * 1000,
      ).toISOString();
      const id   = `ir-app-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
      const code = `NM-APP-${Math.random().toString(36).slice(2, 8).toUpperCase()}`;

      const { error } = await supabase.from("issued_rewards").insert({
        id,
        member_id:  memberId,
        reward_id:  reward.id as string,
        brand_id:   brandId,
        status:     "active",
        expires_at: expiresAt,
        code,
        year:       null,
        issued_at:  new Date().toISOString(),
      });

      if (error) {
        // Race condition (two near-simultaneous logins) is the most
        // likely cause — the duplicate insert just fails. Don't
        // crash the login; the next sign-in will see the existing
        // voucher and skip.
        console.warn(
          `[welcome] failed to issue reward ${reward.id} to ${memberId}:`,
          error.message,
        );
        continue;
      }

      // Notify the member that the welcome voucher landed. Wrapped in
      // after() so Vercel's waitUntil keeps the lambda alive until the
      // Expo fetch completes — without it the push silently dropped on
      // response return. Errors still swallowed so a push miss never
      // blocks issuance.
      const rewardName = (reward as { name?: string }).name;
      after(async () => {
        await notifyWelcomeBonus({
          memberId,
          rewardName,
        }).catch((e) => console.warn("[push] welcome_bonus", e));
      });
    }
  } catch (err) {
    // Never block sign-in on a voucher issuance failure.
    console.error("[welcome] ensureNewMemberRewards unexpected:", err);
  }
}
