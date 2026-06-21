// Single source of truth for resolving an applied reward at order time +
// computing its discount. Used by EVERY server redemption route so POS,
// native pickup, and QR-table never drift on resolution, validation, or
// discount math:
//   - apps/order  /api/checkout/initiate   (QR-table / web PWA)
//   - apps/order  /api/orders              (native pickup)
//   - apps/backoffice /api/pos/loyalty/redeem (POS register)
//
// Two client conventions are unified here:
//   • Wallet voucher: native sends an explicit `walletVoucherId`; the
//     QR-table client sends the voucher's id as `rewardId` (it never sets
//     voucher_id). Either way we resolve it from issued_rewards.
//   • Catalog / points-shop reward: `rewardId` is a legacy text id that
//     maps to a voucher_templates row via legacy_reward_id.
//
// The discount itself always flows through @celsius/shared
// computeVoucherDiscount — never client-trusted, never re-implemented.

import type { SupabaseClient } from "@supabase/supabase-js";
import { computeVoucherDiscount } from "./discount-engine";
import type { VoucherDiscountSpec } from "./discount-engine";
import {
  DISCOUNT_SPEC_COLUMNS,
  type DiscountSpecRow,
  rowToDiscountSpec,
  buildEngineCart,
  inlineSpecFromIssued,
} from "./discount-spec";

const DEFAULT_BRAND_ID = "brand-celsius";

/** Discriminated result. `kind` tells the caller how to persist it on the
 *  order — wallet vouchers consume via wallet_voucher_id (markVoucherUsed
 *  in the confirm / markRmOrderPaid / free-order paths); catalog rewards
 *  burn points via reward_id (deductLoyaltyPoints). A reward is never both. */
export type ResolvedOrderReward =
  | { ok: true; kind: "wallet"; discountSen: number; walletVoucherId: string; spec: VoucherDiscountSpec }
  | { ok: true; kind: "catalog"; discountSen: number; catalogRewardId: string; pointsCost: number; spec: VoucherDiscountSpec }
  | { ok: true; kind: "none"; discountSen: 0 }
  | { ok: false; error: string };

type IssuedRewardRow = {
  member_id: string;
  status: string;
  expires_at: string | null;
  voucher_template_id: string | null;
  min_order_value: number | null;
  discount_type: string | null;
  discount_value: number | null;
  applicable_categories: string[] | null;
  applicable_products: string[] | null;
  free_product_name: string | null;
  source_type: string | null;
};

/** Resolve a catalog / points-shop reward from voucher_templates (by
 *  legacy_reward_id) + validate (active / window / stock / min-order /
 *  points balance) + compute discount via the shared engine. Ported from
 *  apps/order /api/orders validateAppliedReward. */
async function resolveCatalogReward(args: {
  supabase: SupabaseClient;
  rewardId: string;
  items: unknown;
  subtotalSen: number;
  memberId: string | null;
  brandId: string;
}): Promise<ResolvedOrderReward> {
  const { supabase, rewardId, items, subtotalSen, memberId } = args;

  const { data: reward } = await supabase
    .from("voucher_templates")
    .select("id, is_active, valid_from, valid_until, stock, points_cost, " + DISCOUNT_SPEC_COLUMNS)
    .eq("legacy_reward_id", rewardId)
    .maybeSingle<
      {
        id: string;
        is_active: boolean | null;
        valid_from: string | null;
        valid_until: string | null;
        stock: number | null;
        points_cost: number | null;
      } & DiscountSpecRow
    >();

  if (!reward) return { ok: false, error: "Reward no longer available" };
  if (!reward.is_active) return { ok: false, error: "Reward is no longer active" };
  const now = Date.now();
  if (reward.valid_from && new Date(reward.valid_from).getTime() > now) {
    return { ok: false, error: "Reward not yet active" };
  }
  if (reward.valid_until && new Date(reward.valid_until).getTime() < now) {
    return { ok: false, error: "Reward has expired" };
  }
  if (reward.stock != null && reward.stock <= 0) {
    return { ok: false, error: "Reward is out of stock" };
  }
  // min_order_value is SEN — compare against the sen subtotal.
  if (reward.min_order_value != null && subtotalSen < Number(reward.min_order_value)) {
    return {
      ok: false,
      error: `Reward needs a minimum order of RM${(Number(reward.min_order_value) / 100).toFixed(2)}`,
    };
  }

  // Pre-check the points balance for catalog rewards so the customer
  // doesn't pay a discounted amount only for post-payment deduct to find
  // a shortfall. Skip when the member already holds an active issued_reward
  // for this reward (auto-issued vouchers don't deduct points).
  const pointsCost = reward.points_cost ?? 0;
  if (pointsCost > 0 && memberId) {
    const { data: voucher } = await supabase
      .from("issued_rewards")
      .select("id")
      .eq("member_id", memberId)
      .eq("reward_id", rewardId) // issued_rewards.reward_id holds the legacy text id
      .eq("status", "active")
      .limit(1)
      .maybeSingle();
    if (!voucher) {
      const { data: mb } = await supabase
        .from("member_brands")
        .select("points_balance")
        .eq("member_id", memberId)
        .eq("brand_id", args.brandId)
        .single<{ points_balance: number }>();
      const balance = mb?.points_balance ?? 0;
      if (balance < pointsCost) {
        return { ok: false, error: `Not enough points (need ${pointsCost}, have ${balance})` };
      }
    }
  }

  const spec = rowToDiscountSpec(reward);
  const cart = await buildEngineCart(
    supabase,
    items,
    !!(spec.applicable_categories && spec.applicable_categories.length),
  );
  const result = computeVoucherDiscount({ spec, cart });
  const discountSen = Math.max(0, Math.min(subtotalSen, result.discount_sen));
  return { ok: true, kind: "catalog", discountSen, catalogRewardId: rewardId, pointsCost, spec };
}

/**
 * Resolve + compute the applied reward for an order, authoritatively.
 *
 * Resolution order:
 *   1. WALLET voucher — `walletVoucherId` (explicit, native) OR `rewardId`
 *      that resolves to an active issued_rewards row for this member
 *      (QR-table sends the voucher id as rewardId). Spec prefers the linked
 *      voucher_template (full mechanics), else issued_rewards inline columns.
 *   2. CATALOG reward — `rewardId` as voucher_templates.legacy_reward_id.
 *
 * An explicit `walletVoucherId` that's missing / wrong-member / used /
 * expired is a hard error. A `rewardId` that isn't a live issued_reward
 * falls through to the catalog path (it may legitimately be a catalog id).
 */
export async function resolveOrderReward(args: {
  supabase: SupabaseClient;
  memberId: string | null;
  rewardId?: string | null;
  walletVoucherId?: string | null;
  items: unknown;
  subtotalSen: number;
  brandId?: string;
}): Promise<ResolvedOrderReward> {
  const { supabase, memberId, items, subtotalSen } = args;
  const brandId = args.brandId ?? DEFAULT_BRAND_ID;
  const rewardId = args.rewardId ?? null;
  const explicitWalletId = args.walletVoucherId ?? null;

  // ── 1) Wallet voucher ──────────────────────────────────────────────
  const candidateWalletId = explicitWalletId ?? rewardId;
  if (candidateWalletId && memberId) {
    const { data: voucher } = await supabase
      .from("issued_rewards")
      .select(`
        member_id, status, expires_at, voucher_template_id, min_order_value,
        discount_type, discount_value,
        applicable_categories, applicable_products, free_product_name, source_type
      `)
      .eq("id", candidateWalletId)
      .maybeSingle<IssuedRewardRow>();

    if (voucher && voucher.member_id === memberId) {
      if (voucher.status !== "active") {
        if (explicitWalletId) return { ok: false, error: "Voucher already used or inactive" };
        // rewardId matched a non-active voucher → treat as catalog miss below
      } else if (voucher.expires_at && new Date(voucher.expires_at) < new Date()) {
        if (explicitWalletId) return { ok: false, error: "Voucher expired" };
      } else {
        // Prefer the linked voucher_template (carries max_discount_value /
        // free_product_ids / bogo·combo·override); else inline columns.
        let spec: VoucherDiscountSpec;
        if (voucher.voucher_template_id) {
          const { data: tmpl } = await supabase
            .from("voucher_templates")
            .select(DISCOUNT_SPEC_COLUMNS)
            .eq("id", voucher.voucher_template_id)
            .maybeSingle<DiscountSpecRow>();
          spec = tmpl ? rowToDiscountSpec(tmpl) : inlineSpecFromIssued(voucher);
        } else {
          spec = inlineSpecFromIssued(voucher);
        }
        // Daily cap: at most ONE mission free-drink reward redeemed per member
        // per day. Members can bank several earned free-drink vouchers, but
        // only burn one a day — so the rewards pace repeat visits instead of
        // being cleared in a single sitting (the Yousef case: 2 free coffees
        // in 4 minutes). Only mission free_item vouchers are capped; mystery /
        // welcome / points rewards are unaffected. The voucher being applied
        // isn't marked 'used' until post-payment, so this counts only EARLIER
        // redemptions today and never blocks itself.
        if (voucher.source_type === "mission" && voucher.discount_type === "free_item") {
          const dayStr = new Date(Date.now() + 8 * 3_600_000).toISOString().slice(0, 10); // MYT day
          const { count } = await supabase
            .from("issued_rewards")
            .select("id", { count: "exact", head: true })
            .eq("member_id", memberId)
            .eq("source_type", "mission")
            .eq("discount_type", "free_item")
            .eq("status", "used")
            .gte("redeemed_at", new Date(`${dayStr}T00:00:00+08:00`).toISOString())
            .lte("redeemed_at", new Date(`${dayStr}T23:59:59.999+08:00`).toISOString());
          if ((count ?? 0) >= 1) {
            return { ok: false, error: "You've already redeemed a free-drink reward today — your other reward is saved for tomorrow." };
          }
        }

        const cart = await buildEngineCart(
          supabase,
          items,
          !!(spec.applicable_categories && spec.applicable_categories.length),
        );
        const result = computeVoucherDiscount({ spec, cart });
        if (result.reason === "below_min_order") {
          return { ok: false, error: "Minimum order not met for voucher" };
        }
        const discountSen = Math.max(0, Math.min(subtotalSen, result.discount_sen));
        return { ok: true, kind: "wallet", walletVoucherId: candidateWalletId, discountSen, spec };
      }
    } else if (explicitWalletId) {
      // Explicit wallet id not found / belongs to another member.
      return { ok: false, error: "Voucher not found" };
    }
    // else: rewardId wasn't a live issued_reward → fall through to catalog
  }

  // ── 2) Catalog / points-shop reward ────────────────────────────────
  if (rewardId) {
    return resolveCatalogReward({ supabase, rewardId, items, subtotalSen, memberId, brandId });
  }

  return { ok: true, kind: "none", discountSen: 0 };
}
