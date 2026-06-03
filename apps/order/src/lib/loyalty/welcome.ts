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

    // Pull every active new_member auto_issue voucher template for the
    // brand from the canonical voucher_templates (the legacy `rewards` +
    // `reward_configs` tables are being retired — reward_type + auto_issue
    // were backfilled onto voucher_templates). Usually one (Welcome BOGO)
    // but the loop tolerates multiple. The template carries display +
    // discount config directly, so no second join is needed.
    const { data: templates } = await supabase
      .from("voucher_templates")
      .select(
        "id, legacy_reward_id, title, description, validity_days, category, discount_type, discount_value, min_order_value, applicable_categories, applicable_products, free_product_name",
      )
      .eq("brand_id", brandId)
      .eq("reward_type", "new_member")
      .eq("auto_issue", true)
      .eq("is_active", true);

    if (!templates || templates.length === 0) return;

    for (const tmpl of templates) {
      const templateId = tmpl.id as string;
      const legacyId = (tmpl.legacy_reward_id as string | null) ?? null;

      // Idempotency gate: if this member has EVER been issued this
      // template (active, used, or expired), do nothing — we don't want to
      // re-issue to someone who already redeemed theirs months ago. Keyed
      // on the canonical voucher_template_id link, OR the legacy reward_id
      // for any voucher minted before that link existed.
      const idemBase = supabase
        .from("issued_rewards")
        .select("id", { count: "exact", head: true })
        .eq("member_id", memberId)
        .eq("brand_id", brandId);
      const { count } = legacyId
        ? await idemBase.or(`voucher_template_id.eq.${templateId},reward_id.eq.${legacyId}`)
        : await idemBase.eq("voucher_template_id", templateId);

      if ((count ?? 0) > 0) continue;

      const validityDays = (tmpl.validity_days as number | null) ?? 30;
      const expiresAt = new Date(
        Date.now() + validityDays * 24 * 60 * 60 * 1000,
      ).toISOString();
      const id   = `ir-app-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
      const code = `NM-APP-${Math.random().toString(36).slice(2, 8).toUpperCase()}`;

      const rewardCategory = (tmpl.category as string | null) ?? "free_item";

      const { error } = await supabase.from("issued_rewards").insert({
        id,
        member_id:  memberId,
        // Legacy text id for back-compat with redemption/consume paths that
        // still key issued_rewards.reward_id; null for native templates
        // (voucher_template_id is the canonical link either way).
        reward_id:  legacyId,
        voucher_template_id: templateId,
        brand_id:   brandId,
        status:     "active",
        expires_at: expiresAt,
        code,
        year:       null,
        issued_at:  new Date().toISOString(),
        // Denormalised display + discount fields — without these the
        // wallet renders a generic "Voucher" tile and the cart engine
        // returns 0 discount, producing the ghost vouchers customers
        // kept seeing in their wallet right after signup.
        source_type:           "manual",
        title:                 tmpl.title,
        description:           tmpl.description,
        icon:                  rewardCategory,
        category:              rewardCategory,
        discount_type:         tmpl.discount_type as string | null,
        discount_value:        tmpl.discount_value as number | null,
        min_order_value:       tmpl.min_order_value as number | null,
        applicable_categories: tmpl.applicable_categories as string[] | null,
        applicable_products:   tmpl.applicable_products as string[] | null,
        free_product_name:     tmpl.free_product_name as string | null,
        stacks_with_beans:     true,
      });

      if (error) {
        // Race condition (two near-simultaneous logins) is the most
        // likely cause — the duplicate insert just fails. Don't crash the
        // login; the next sign-in sees the existing voucher and skips.
        console.warn(
          `[welcome] failed to issue template ${templateId} to ${memberId}:`,
          error.message,
        );
        continue;
      }

      // Notify the member that the welcome voucher landed. Wrapped in
      // after() so Vercel's waitUntil keeps the lambda alive until the
      // Expo fetch completes — without it the push silently dropped on
      // response return. Errors still swallowed so a push miss never
      // blocks issuance.
      const rewardName = (tmpl as { title?: string }).title;
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
