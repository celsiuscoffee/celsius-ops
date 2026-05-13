// src/lib/loyalty/v2.ts
//
// Rewards v2 — vouchers (issued_rewards) + missions + mystery bean.
//
// Sits alongside lib/loyalty/points.ts which handles the legacy points-shop.
// All functions accept a member_id (resolved upstream from session.sub or by
// phone lookup). Brand id is read from env with a sensible default.

import { getSupabaseAdmin } from "@/lib/supabase/server";
import { awardBonusBeans } from "@/lib/loyalty/points";
import { notifyMissionCompleted, notifyReferralRewarded } from "@/lib/push/templates";

const BRAND_ID = (process.env.LOYALTY_BRAND_ID ?? "brand-celsius").trim();

// ─── Types ────────────────────────────────────────────────────────────

export type VoucherCategory = "free_item" | "upgrade" | "discount" | "multiplier" | "special";

export type VoucherTemplate = {
  id: string;
  brand_id: string;
  title: string;
  description: string;
  icon: string;
  category: VoucherCategory;
  discount_type: string | null;
  discount_value: number | null;
  multiplier_value: number | null;
  validity_days: number;
  stacks_with_beans: boolean;
};

export type IssuedVoucher = {
  id: string;
  member_id: string;
  voucher_template_id: string | null;
  source_type: "mission" | "mystery" | "birthday" | "referral" | "milestone" | "manual" | "points_redemption" | null;
  source_ref_id: string | null;
  // DB CHECK constraint allows: 'active' | 'used' | 'expired'. ('redeemed'
  // and 'voided' are intentionally NOT in the enum — earlier code that
  // tried to set 'redeemed' silently failed.)
  status: "active" | "used" | "expired";
  issued_at: string;
  expires_at: string | null;
  redeemed_at: string | null;
};

// ─── Brand id helper ─────────────────────────────────────────────────

export function brandId(): string { return BRAND_ID; }

// ─── Voucher issuance ────────────────────────────────────────────────

/** Issue a voucher from a template to a member. Returns the new
 *  issued_rewards row. Computes expires_at from template.validity_days. */
export async function issueVoucher(args: {
  memberId: string;
  templateId: string;
  sourceType: NonNullable<IssuedVoucher["source_type"]>;
  sourceRefId?: string | null;
}): Promise<IssuedVoucher | null> {
  const supabase = getSupabaseAdmin();

  // Resolve template — need the expiry window + display + discount fields
  // for the row so the checkout discount engine has everything inline.
  const { data: tpl } = await supabase
    .from("voucher_templates")
    .select(`
      id, title, description, icon, category, validity_days,
      discount_type, discount_value, min_order_value,
      applicable_categories, applicable_products, free_product_name,
      stacks_with_beans
    `)
    .eq("id", args.templateId)
    .eq("brand_id", BRAND_ID)
    .eq("is_active", true)
    .single();

  if (!tpl) {
    console.warn("[v2] issueVoucher: template not found", args.templateId);
    return null;
  }

  const expiresAt = tpl.validity_days
    ? new Date(Date.now() + tpl.validity_days * 24 * 60 * 60 * 1000).toISOString()
    : null;

  // issued_rewards.id is text NOT NULL with no DB default, so callers
  // own ID generation. Format mirrors the legacy "ir-…" prefix so the
  // backoffice + analytics queries that filter by prefix keep working.
  const id = `ir-${args.sourceType}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;

  const { data, error } = await supabase
    .from("issued_rewards")
    .insert({
      id,
      brand_id: BRAND_ID,
      member_id: args.memberId,
      voucher_template_id: tpl.id,
      source_type: args.sourceType,
      source_ref_id: args.sourceRefId ?? null,
      // Display + discount fields denormalised onto issued_rewards so the
      // client doesn't have to join voucher_templates on every read AND
      // the checkout discount engine can compute everything inline.
      title:                 tpl.title,
      description:           tpl.description,
      icon:                  tpl.icon,
      category:              tpl.category,
      discount_type:         tpl.discount_type,
      discount_value:        tpl.discount_value,
      min_order_value:       tpl.min_order_value,
      applicable_categories: tpl.applicable_categories,
      applicable_products:   tpl.applicable_products,
      free_product_name:     tpl.free_product_name,
      stacks_with_beans:     tpl.stacks_with_beans ?? true,
      status: "active",
      issued_at: new Date().toISOString(),
      expires_at: expiresAt,
    })
    .select()
    .single();

  if (error) {
    console.warn("[v2] issueVoucher: insert failed", error.message);
    return null;
  }
  return data as IssuedVoucher;
}

/** Redeem a legacy points-shop reward INTO the wallet. Deducts the
 *  member's Beans atomically and inserts an issued_rewards row with all
 *  display + discount fields copied off the reward. The voucher then
 *  shows up on the Rewards tab and can be applied at checkout the same
 *  way every other voucher does.
 *
 *  Returns `{ ok: false, reason }` on insufficient balance / unknown
 *  reward / inactive reward — caller turns those into 4xx responses.
 *
 *  Idempotency is NOT enforced here (a customer may legitimately claim
 *  the same reward twice if they have the Beans). max_redemptions
 *  enforcement is a TODO. */
export async function redeemPointsShopReward(args: {
  memberId: string;
  rewardId: string;
}): Promise<
  | { ok: true; voucher: IssuedVoucher; newBalance: number; pointsSpent: number }
  | { ok: false; reason: "reward_not_found" | "insufficient_beans" | "insert_failed" }
> {
  const supabase = getSupabaseAdmin();

  const [{ data: reward }, { data: config }] = await Promise.all([
    supabase
      .from("rewards")
      .select(`
        id, name, description, points_required, validity_days,
        category, discount_type, discount_value, min_order_value,
        applicable_categories, applicable_products, free_product_name,
        is_active, auto_issue
      `)
      .eq("id", args.rewardId)
      .eq("brand_id", BRAND_ID)
      .eq("is_active", true)
      .single(),
    // Discount metadata for most rewards lives in reward_configs, not on
    // the rewards row directly. Without this lookup the issued voucher
    // lands with discount_type=null and the cart-side discount engine
    // returns 0, which presents as "the voucher banner shows but the
    // subtotal doesn't drop". Joining via reward_id keeps existing
    // backoffice editors as the single source of truth for discount config.
    //
    // reward_configs is a slim override table: only reward_id,
    // discount_type, discount_value, updated_at. Earlier SELECT named
    // columns that don't exist (max_discount_value, min_order_value,
    // applicable_categories, applicable_products, free_product_name,
    // bogo_buy_qty, bogo_free_qty) — the query errored with
    // "column reward_configs.max_discount_value does not exist" and
    // EVERY claim attempt failed. Limit the SELECT to what's actually
    // on the table; everything else falls back to the rewards row.
    supabase
      .from("reward_configs")
      .select("discount_type, discount_value")
      .eq("reward_id", args.rewardId)
      .maybeSingle(),
  ]);

  if (!reward) return { ok: false, reason: "reward_not_found" };

  // Merge: reward_configs overrides discount_type / discount_value when
  // present (that's all that table actually stores). Eligibility +
  // min-order filters live exclusively on the rewards row.
  const discountType         = (config?.discount_type as string | null) ?? (reward.discount_type as string | null);
  const discountValue        = (config?.discount_value as number | null) ?? (reward.discount_value as number | null);
  const minOrderValue        = (reward.min_order_value as number | null);
  const applicableCategories = (reward.applicable_categories as string[] | null);
  const applicableProducts   = (reward.applicable_products as string[] | null);
  const freeProductName      = (reward.free_product_name as string | null);

  const pointsRequired = (reward.points_required as number) ?? 0;

  // Atomic deduction via existing RPC — returns the new balance or
  // throws when balance < pointsRequired.
  if (pointsRequired > 0) {
    const { data: newBalance, error: rpcErr } = await supabase.rpc("deduct_points", {
      p_member_id: args.memberId,
      p_brand_id:  BRAND_ID,
      p_points:    pointsRequired,
    });
    if (rpcErr) {
      // RPC raises a specific error on insufficient balance — surface it.
      return { ok: false, reason: "insufficient_beans" };
    }

    // Insert the voucher into the wallet.
    const id = `ir-redeem-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
    const validityDays = (reward.validity_days as number | null) ?? 30;
    const expiresAt = validityDays
      ? new Date(Date.now() + validityDays * 24 * 60 * 60 * 1000).toISOString()
      : null;

    const { data: inserted, error: insErr } = await supabase
      .from("issued_rewards")
      .insert({
        id,
        brand_id: BRAND_ID,
        member_id: args.memberId,
        reward_id: reward.id,
        source_type: "points_redemption",
        source_ref_id: reward.id,
        title:                 reward.name,
        description:           reward.description,
        icon:                  reward.category ?? "ticket",
        category:              reward.category ?? "special",
        discount_type:         discountType,
        discount_value:        discountValue,
        min_order_value:       minOrderValue,
        applicable_categories: applicableCategories,
        applicable_products:   applicableProducts,
        free_product_name:     freeProductName,
        stacks_with_beans:     false, // points-shop redemptions don't stack with Beans by default
        status: "active",
        issued_at: new Date().toISOString(),
        expires_at: expiresAt,
      })
      .select()
      .single();

    if (insErr || !inserted) {
      // Beans already deducted — caller decides whether to refund. We
      // log loud + return insert_failed so the route handler can refund
      // via awardBonusBeans before responding 500.
      console.error("[v2] redeemPointsShopReward: insert failed", insErr?.message);
      return { ok: false, reason: "insert_failed" };
    }

    return {
      ok: true,
      voucher: inserted as IssuedVoucher,
      newBalance: newBalance as number,
      pointsSpent: pointsRequired,
    };
  }

  // Zero-cost reward (admin-grant flavours). Issue without touching balance.
  const id = `ir-redeem-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
  const validityDays = (reward.validity_days as number | null) ?? 30;
  const expiresAt = validityDays
    ? new Date(Date.now() + validityDays * 24 * 60 * 60 * 1000).toISOString()
    : null;

  const { data: inserted, error: insErr } = await supabase
    .from("issued_rewards")
    .insert({
      id,
      brand_id: BRAND_ID,
      member_id: args.memberId,
      reward_id: reward.id,
      source_type: "points_redemption",
      source_ref_id: reward.id,
      title:                 reward.name,
      description:           reward.description,
      icon:                  reward.category ?? "ticket",
      category:              reward.category ?? "special",
      discount_type:         discountType,
      discount_value:        discountValue,
      min_order_value:       minOrderValue,
      applicable_categories: applicableCategories,
      applicable_products:   applicableProducts,
      free_product_name:     freeProductName,
      stacks_with_beans:     false,
      status: "active",
      issued_at: new Date().toISOString(),
      expires_at: expiresAt,
    })
    .select()
    .single();
  if (insErr || !inserted) return { ok: false, reason: "insert_failed" };
  return { ok: true, voucher: inserted as IssuedVoucher, newBalance: 0, pointsSpent: 0 };
}

// ─── Referrals ───────────────────────────────────────────────────────

/** Get-or-create a referral code for this member. Codes are short
 *  human-readable strings; on insert collision we retry once. */
export async function getOrCreateReferralCode(memberId: string): Promise<string | null> {
  const supabase = getSupabaseAdmin();
  const { data: existing } = await supabase
    .from("referral_codes")
    .select("code")
    .eq("member_id", memberId)
    .maybeSingle();
  if (existing?.code) return existing.code as string;

  // Generate a code. Short, no ambiguous chars.
  const ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  function gen(): string {
    let s = "CC";
    for (let i = 0; i < 4; i++) s += ALPHABET[Math.floor(Math.random() * ALPHABET.length)];
    return s;
  }

  for (let attempt = 0; attempt < 3; attempt++) {
    const code = gen();
    const { error } = await supabase
      .from("referral_codes")
      .insert({ member_id: memberId, brand_id: BRAND_ID, code });
    if (!error) return code;
    // 23505 unique_violation — retry
  }
  return null;
}

/** Record a pending attribution when a new member signs up using a code.
 *  Idempotent on referee_id (a member can only be referred once). */
export async function attributeReferralOnSignup(args: {
  refereeId: string;
  code: string;
}): Promise<{ ok: boolean; referrerId?: string }> {
  const supabase = getSupabaseAdmin();
  const { data: refRow } = await supabase
    .from("referral_codes")
    .select("member_id")
    .eq("code", args.code)
    .single();
  if (!refRow || refRow.member_id === args.refereeId) {
    return { ok: false };
  }
  const { error } = await supabase
    .from("referral_attributions")
    .insert({
      brand_id: BRAND_ID,
      referrer_id: refRow.member_id,
      referee_id: args.refereeId,
      referral_code: args.code,
      status: "pending",
    });
  if (error) return { ok: false };
  return { ok: true, referrerId: refRow.member_id as string };
}

/** Called from the order completion path. If this is the referee's
 *  first qualifying order, issue both-side vouchers and flip the
 *  attribution to 'rewarded'. */
export async function maybeRewardReferralOnFirstOrder(args: {
  memberId: string;
  orderId: string;
}): Promise<void> {
  const supabase = getSupabaseAdmin();

  // Find pending attribution where this member is the referee.
  const { data: attr } = await supabase
    .from("referral_attributions")
    .select("id, referrer_id, status")
    .eq("referee_id", args.memberId)
    .eq("status", "pending")
    .maybeSingle();
  if (!attr) return;

  // Look up voucher template ids from AppConfig. value is jsonb so
  // callers may store a bare string or an object; unwrap both shapes.
  const { data: cfg } = await supabase
    .from("AppConfig")
    .select("key, value")
    .in("key", ["referral_referrer_voucher_template_id", "referral_referee_voucher_template_id"]);

  function unwrap(raw: unknown): string | null {
    if (typeof raw === "string") return raw;
    if (raw && typeof raw === "object" && "value" in (raw as Record<string, unknown>)) {
      return String((raw as Record<string, unknown>).value);
    }
    return null;
  }
  const cfgMap = new Map((cfg ?? []).map((c) => [c.key as string, unwrap(c.value)]));
  const referrerTpl = cfgMap.get("referral_referrer_voucher_template_id");
  const refereeTpl  = cfgMap.get("referral_referee_voucher_template_id");
  if (!referrerTpl || !refereeTpl) return; // referral disabled until configured

  const refereeVoucher  = await issueVoucher({ memberId: args.memberId,          templateId: refereeTpl,  sourceType: "referral", sourceRefId: attr.id });
  const referrerVoucher = await issueVoucher({ memberId: attr.referrer_id as string, templateId: referrerTpl, sourceType: "referral", sourceRefId: attr.id });

  await supabase
    .from("referral_attributions")
    .update({
      status: "rewarded",
      referee_first_order_id: args.orderId,
      referrer_voucher_id: referrerVoucher?.id ?? null,
      referee_voucher_id:  refereeVoucher?.id ?? null,
      rewarded_at: new Date().toISOString(),
    })
    .eq("id", attr.id);

  // Bump referrer's total_referred counter (display only).
  try {
    await supabase.rpc("increment_referral_total", { member_id_param: attr.referrer_id });
  } catch { /* analytics bump is non-critical */ }

  // Notify both sides — landing the gift in their wallet is the moment
  // they should hear about it, not when they next open the app.
  notifyReferralRewarded({ memberId: attr.referrer_id as string, isReferrer: true }).catch(() => {});
  notifyReferralRewarded({ memberId: args.memberId,              isReferrer: false }).catch(() => {});
}

// ─── Mission progress ────────────────────────────────────────────────

type GoalFilter = { order_hour_lt?: number };
type Goal = { type: string; threshold: number; filter?: GoalFilter };

type OrderForMission = {
  id: string;
  outlet_id: string;
  item_ids: string[];
  item_count: number;
  total_sen: number;
  created_at: string;
};

function evalGoalOnOrder(goal: Goal, order: OrderForMission): number {
  // Returns the increment to add to progress_current for this single order.
  // Most goals add 1 per qualifying order; some (like "items_count") add
  // the item count of a single order.
  const hour = new Date(order.created_at).getHours();
  if (goal.filter?.order_hour_lt !== undefined && hour >= goal.filter.order_hour_lt) {
    return 0;
  }
  switch (goal.type) {
    case "orders_count":             return 1;
    case "single_order_item_count":  return order.item_count >= goal.threshold ? goal.threshold : 0;
    case "distinct_outlets":         return 1; // server-side dedupe handled below
    case "distinct_new_products":    return 1; // dedupe handled below
    case "spend_amount":             return order.total_sen;
    default:                          return 0;
  }
}

/** Apply an order to the customer's active mission. Updates progress,
 *  flips status to 'completed' on threshold, and issues the configured
 *  voucher templates. Idempotent within a single order via order_id
 *  guard (TODO: track which orders we already processed). */
export async function applyOrderToMission(args: {
  memberId: string;
  order: OrderForMission;
}): Promise<{ completed: boolean; missionId: string | null }> {
  const supabase = getSupabaseAdmin();
  const noResult = { completed: false, missionId: null };

  // Look up active assignment.
  const { data: assignment } = await supabase
    .from("mission_assignments")
    .select("id, mission_id, progress_current, progress_target")
    .eq("member_id", args.memberId)
    .eq("status", "active")
    .single();

  if (!assignment) return noResult;

  const { data: mission } = await supabase
    .from("reward_missions")
    .select("id, goal, reward_voucher_template_ids, reward_bonus_beans")
    .eq("id", assignment.mission_id)
    .single();

  if (!mission) return noResult;

  const inc = evalGoalOnOrder(mission.goal as Goal, args.order);
  if (inc === 0) return { completed: false, missionId: assignment.mission_id };

  const newProgress = assignment.progress_current + inc;
  const completed = newProgress >= assignment.progress_target;

  await supabase
    .from("mission_assignments")
    .update({
      progress_current: newProgress,
      status: completed ? "completed" : "active",
      completed_at: completed ? new Date().toISOString() : null,
    })
    .eq("id", assignment.id);

  if (completed) {
    // Look up mission title for the push.
    const { data: meta } = await supabase
      .from("reward_missions")
      .select("title")
      .eq("id", mission.id)
      .single();

    // Issue all configured voucher templates.
    let issuedCount = 0;
    for (const tplId of mission.reward_voucher_template_ids ?? []) {
      const v = await issueVoucher({
        memberId: args.memberId,
        templateId: tplId,
        sourceType: "mission",
        sourceRefId: assignment.id,
      });
      if (v) issuedCount++;
    }
    // Bump completion counter on the mission (analytics). Best-effort.
    try {
      await supabase.rpc("increment_mission_completed", { mission_id_param: mission.id });
    } catch { /* analytics bump is non-critical */ }

    // Fire-and-forget push so the customer knows their challenge landed.
    notifyMissionCompleted({
      memberId: args.memberId,
      missionTitle: (meta?.title as string) ?? "Challenge",
      voucherCount: issuedCount,
    }).catch(() => {});
  }

  return { completed, missionId: assignment.mission_id };
}

// ─── Mystery Bean drop ───────────────────────────────────────────────

type MysteryPoolEntry = {
  id: string;
  outcome_type: "beans_multiplier" | "flat_beans" | "voucher" | "no_bonus" | "surprise_in_store";
  multiplier_value: number | null;
  flat_beans_value: number | null;
  voucher_template_id: string | null;
  weight: number;
  min_tier: string | null;
  birthday_month_boost: boolean;
  label: string;
  reveal_emoji: string | null;
};

/** Generate a mystery drop for this order. Picks one entry from the
 *  brand's active mystery_pool weighted by `weight`, with optional
 *  birthday-month boost. Inserts a mystery_drops row with revealed_at
 *  = null so the customer's tap reveals it.
 *
 *  Returns the drop id (or null if no pool / disabled). */
export async function generateMysteryDrop(args: {
  memberId: string;
  orderId: string;
  memberTier?: string | null;
  birthdayMonth?: number | null; // 1-12; null if unknown
}): Promise<{ dropId: string | null }> {
  const supabase = getSupabaseAdmin();
  const noResult = { dropId: null };

  const { data: poolRaw } = await supabase
    .from("mystery_pool")
    .select("id, outcome_type, multiplier_value, flat_beans_value, voucher_template_id, weight, min_tier, birthday_month_boost, label, reveal_emoji")
    .eq("brand_id", BRAND_ID)
    .eq("is_active", true);

  const pool = (poolRaw ?? []) as MysteryPoolEntry[];
  if (pool.length === 0) return noResult;

  // Tier-gate. Without a clear ladder we just admit everything when
  // min_tier is null. (TODO: proper tier rank check vs args.memberTier)
  const eligible = pool.filter((e) => !e.min_tier || (args.memberTier && args.memberTier === e.min_tier));
  if (eligible.length === 0) return noResult;

  // Birthday boost — double weight when birthday_month_boost AND the
  // customer's birthday month matches the current month.
  const currentMonth = new Date().getMonth() + 1;
  const birthdayBoost = args.birthdayMonth !== null && args.birthdayMonth === currentMonth;

  const weights = eligible.map((e) =>
    e.birthday_month_boost && birthdayBoost ? e.weight * 2 : e.weight
  );
  const totalWeight = weights.reduce((a, b) => a + b, 0);
  if (totalWeight === 0) return noResult;

  let r = Math.random() * totalWeight;
  let pick: MysteryPoolEntry = eligible[0];
  for (let i = 0; i < eligible.length; i++) {
    r -= weights[i];
    if (r <= 0) { pick = eligible[i]; break; }
  }

  const { data, error } = await supabase
    .from("mystery_drops")
    .insert({
      member_id: args.memberId,
      order_id: args.orderId,
      pool_entry_id: pick.id,
      outcome_type: pick.outcome_type,
      multiplier_applied: pick.outcome_type === "beans_multiplier" ? pick.multiplier_value : null,
      beans_awarded: pick.outcome_type === "flat_beans" ? pick.flat_beans_value : null,
      voucher_id: null, // populated on reveal if this is a voucher outcome
    })
    .select("id")
    .single();

  if (error || !data) {
    console.warn("[v2] generateMysteryDrop: insert failed", error?.message);
    return noResult;
  }
  return { dropId: data.id };
}

// ─── Reveal mystery drop ────────────────────────────────────────────

export async function revealMysteryDrop(args: {
  memberId: string;
  dropId: string;
  baseBeansEarned: number;
}): Promise<{
  drop_id: string;
  outcome_type: string;
  multiplier_value: number | null;
  flat_beans_value: number | null;
  voucher_id: string | null;
  reveal_emoji: string | null;
  label: string;
  total_beans_awarded: number;
} | null> {
  const supabase = getSupabaseAdmin();

  // Load the drop + pool entry it references.
  const { data: drop } = await supabase
    .from("mystery_drops")
    .select("id, member_id, order_id, pool_entry_id, outcome_type, multiplier_applied, beans_awarded, voucher_id, revealed_at")
    .eq("id", args.dropId)
    .eq("member_id", args.memberId)
    .single();

  if (!drop) return null;
  // Allow re-reveal — return the existing reveal payload if already revealed.

  const { data: entry } = await supabase
    .from("mystery_pool")
    .select("label, reveal_emoji, voucher_template_id, outcome_type")
    .eq("id", drop.pool_entry_id)
    .single();

  if (!entry) return null;

  let voucherId: string | null = drop.voucher_id;
  let totalBeansAwarded = args.baseBeansEarned;

  if (!drop.revealed_at) {
    // First reveal — apply effects.
    if (drop.outcome_type === "beans_multiplier" && drop.multiplier_applied) {
      const bonusBeans = Math.round(args.baseBeansEarned * (drop.multiplier_applied - 1));
      totalBeansAwarded = args.baseBeansEarned + bonusBeans;
      // Credit the multiplier delta to the member ledger so their
      // displayed balance reflects the reveal.
      if (bonusBeans > 0) {
        await awardBonusBeans({
          memberId: args.memberId,
          amount: bonusBeans,
          description: `Mystery Bean ${drop.multiplier_applied}× multiplier`,
          referenceId: drop.order_id ?? drop.id,
          txnType: "mystery_bonus",
        });
      }
    }
    if (drop.outcome_type === "flat_beans" && drop.beans_awarded) {
      totalBeansAwarded = args.baseBeansEarned + drop.beans_awarded;
      await awardBonusBeans({
        memberId: args.memberId,
        amount: drop.beans_awarded,
        description: "Mystery Bean flat bonus",
        referenceId: drop.order_id ?? drop.id,
        txnType: "mystery_bonus",
      });
    }
    if (drop.outcome_type === "voucher" && entry.voucher_template_id) {
      const issued = await issueVoucher({
        memberId: args.memberId,
        templateId: entry.voucher_template_id,
        sourceType: "mystery",
        sourceRefId: drop.id,
      });
      voucherId = issued?.id ?? null;
    }

    await supabase
      .from("mystery_drops")
      .update({
        revealed_at: new Date().toISOString(),
        voucher_id: voucherId,
      })
      .eq("id", drop.id);
  } else if (drop.outcome_type === "beans_multiplier" && drop.multiplier_applied) {
    totalBeansAwarded = args.baseBeansEarned * drop.multiplier_applied;
  } else if (drop.outcome_type === "flat_beans" && drop.beans_awarded) {
    totalBeansAwarded = args.baseBeansEarned + drop.beans_awarded;
  }

  return {
    drop_id: drop.id,
    outcome_type: drop.outcome_type,
    multiplier_value: drop.multiplier_applied,
    flat_beans_value: drop.beans_awarded,
    voucher_id: voucherId,
    reveal_emoji: entry.reveal_emoji,
    label: entry.label,
    total_beans_awarded: Math.round(totalBeansAwarded),
  };
}

// ─── Shared payment-success hook ─────────────────────────────────────
//
// Three payment paths exist:
//   1. Stripe webhook (primary, paid orders)
//   2. /api/checkout/create-payment-intent zero-pay branch (free orders
//      bypassing Stripe — happens when a wallet voucher / reward covers
//      the entire bill)
//   3. /api/orders/[id]/confirm-stripe (client-side fallback)
//
// Each one used to duplicate the mission + mystery + referral + voucher
// bookkeeping in slightly different ways, and the zero-pay branch had
// none of it at all. This helper centralises the logic so adding a new
// payment path (or new v2 hook) only touches one file. Safe to call
// from after() — every step has its own try/catch so a single failure
// doesn't drop the rest.

export async function applyOrderV2Hooks(args: {
  memberId: string;
  orderId: string;
  outletId: string;
  orderCreatedAt: string;            // ISO timestamp; usually orders.created_at
  walletVoucherId?: string | null;   // if set, mark the issued voucher redeemed
}): Promise<void> {
  const supabase = getSupabaseAdmin();
  const { memberId, orderId, outletId, orderCreatedAt, walletVoucherId } = args;

  // Wallet voucher → consumed. Doesn't deduct Beans (wallet vouchers
  // cost nothing to claim). Idempotent: a second call no-ops because
  // status='used' is sticky.
  //
  // Constraint note: issued_rewards.status only allows ('active','used',
  // 'expired') — earlier writes here used 'redeemed' which failed the
  // CHECK constraint silently (errors caught + logged but never
  // surfaced), so wallet vouchers stayed status='active' forever and
  // could be re-applied at every checkout. Aligning with the existing
  // enum.
  if (walletVoucherId) {
    try {
      const { error } = await supabase
        .from("issued_rewards")
        .update({ status: "used", redeemed_at: new Date().toISOString() })
        .eq("id", walletVoucherId)
        .eq("member_id", memberId);
      if (error) console.warn("[v2] markVoucherUsed failed", error.message);
    } catch (e) {
      console.warn("[v2] markVoucherUsed failed", e);
    }
  }

  // Mission progress. Looks up the active assignment + the goal, evals
  // this order against it, increments progress, completes + issues
  // voucher templates on threshold.
  try {
    const { data: items } = await supabase
      .from("order_items")
      .select("product_id, quantity")
      .eq("order_id", orderId);
    const itemIds = (items ?? []).map((i) => i.product_id as string);
    const itemCount = (items ?? []).reduce((sum, i) => sum + ((i.quantity as number) ?? 0), 0);

    await applyOrderToMission({
      memberId,
      order: {
        id: orderId,
        outlet_id: outletId,
        item_ids: itemIds,
        item_count: itemCount,
        total_sen: 0,
        created_at: orderCreatedAt,
      },
    });
  } catch (e) {
    console.warn("[v2] applyOrderToMission failed", e);
  }

  // Mystery drop. Pulls member tier + birthday so the weighted pick
  // can honour tier-gates and birthday-month boost.
  try {
    const [{ data: memberBrand }, { data: memberRow }] = await Promise.all([
      supabase
        .from("member_brands")
        .select("tiers(slug)")
        .eq("member_id", memberId)
        .eq("brand_id", BRAND_ID)
        .single(),
      supabase
        .from("members")
        .select("brand_data")
        .eq("id", memberId)
        .single(),
    ]);
    const tierSlug = (memberBrand as { tiers?: { slug?: string } | null } | null)?.tiers?.slug ?? null;
    const bdayIso = (memberRow?.brand_data as { birthday?: string | null } | null)?.birthday ?? null;
    const birthdayMonth = bdayIso ? new Date(bdayIso).getMonth() + 1 : null;

    await generateMysteryDrop({
      memberId,
      orderId,
      memberTier: tierSlug,
      birthdayMonth,
    });
  } catch (e) {
    console.warn("[v2] generateMysteryDrop failed", e);
  }

  // Referral payoff on the referee's first qualifying order. Idempotent
  // via referral_attributions.status — second call no-ops.
  try {
    await maybeRewardReferralOnFirstOrder({ memberId, orderId });
  } catch (e) {
    console.warn("[v2] maybeRewardReferralOnFirstOrder failed", e);
  }
}
