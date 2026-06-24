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
  source_type: "mission" | "mystery" | "birthday" | "referral" | "manual" | "points_redemption" | null;
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
      discount_type, discount_value, multiplier_value, min_order_value,
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
      multiplier_value:      tpl.multiplier_value,
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
 *  member's Points atomically and inserts an issued_rewards row with all
 *  display + discount fields copied off the reward. The voucher then
 *  shows up on the Rewards tab and can be applied at checkout the same
 *  way every other voucher does.
 *
 *  Returns `{ ok: false, reason }` on insufficient balance / unknown
 *  reward / inactive reward — caller turns those into 4xx responses.
 *
 *  Idempotency is NOT enforced here (a customer may legitimately claim
 *  the same reward twice if they have the Points). max_redemptions
 *  enforcement is a TODO. */
export async function redeemPointsShopReward(args: {
  memberId: string;
  rewardId: string;
}): Promise<
  | { ok: true; voucher: IssuedVoucher; newBalance: number; pointsSpent: number }
  | { ok: false; reason: "reward_not_found" | "insufficient_beans" | "insert_failed" }
> {
  const supabase = getSupabaseAdmin();

  // Cleanup: read the canonical template (Bean-Shop mirror) by
  // legacy_reward_id. The template carries discount_type/value directly,
  // so the old reward_configs merge is unnecessary (config stays null).
  // Aliases (name:title, points_required:points_cost) keep downstream
  // code unchanged.
  const [{ data: reward }, { data: config }] = await Promise.all([
    supabase
      .from("voucher_templates")
      .select(`
        id, name:title, description, points_required:points_cost, validity_days,
        category, discount_type, discount_value, min_order_value,
        applicable_categories, applicable_products, free_product_name,
        is_active
      `)
      .eq("legacy_reward_id", args.rewardId)
      .eq("brand_id", BRAND_ID)
      .eq("is_active", true)
      .maybeSingle(),
    // reward_configs merge dropped — the template carries canonical
    // discount_type/value directly, so there's no override table to
    // consult. Kept the tuple shape so the destructure below is stable.
    Promise.resolve({ data: null as { discount_type?: string | null; discount_value?: number | null } | null }),
  ]);

  if (!reward) return { ok: false, reason: "reward_not_found" };

  // Discount comes straight off the template now (single source).
  const discountType         = (config?.discount_type as string | null) ?? (reward.discount_type as string | null);
  const discountValue        = (config?.discount_value as number | null) ?? (reward.discount_value as number | null);
  const minOrderValue        = (reward.min_order_value as number | null);
  const applicableCategories = (reward.applicable_categories as string[] | null);
  const applicableProducts   = (reward.applicable_products as string[] | null);
  const freeProductName      = (reward.free_product_name as string | null);

  const pointsRequired = (reward.points_required as number) ?? 0;
  const id = `ir-redeem-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
  const validityDays = (reward.validity_days as number | null) ?? 30;
  const expiresAt = validityDays
    ? new Date(Date.now() + validityDays * 24 * 60 * 60 * 1000).toISOString()
    : null;

  // Atomic deduct + voucher insert in a single transaction.
  // Earlier this was two separate writes (deduct_points RPC, then a
  // Supabase insert) — if the insert failed after the deduct
  // succeeded, the member lost their points with no voucher to show
  // for it. The redeem_points_shop_reward function does both inside
  // a Postgres transaction so either both happen or neither does.
  const { data, error: rpcErr } = await supabase.rpc("redeem_points_shop_reward", {
    p_member_id: args.memberId,
    p_brand_id:  BRAND_ID,
    p_reward_id: args.rewardId,  // legacy text id — issued_rewards.reward_id stays legacy-keyed
    p_voucher_id: id,
    p_points_required: pointsRequired,
    p_title: reward.name as string,
    p_description: (reward.description as string | null) ?? "",
    p_icon: (reward.category as string | null) ?? "ticket",
    p_category: (reward.category as string | null) ?? "special",
    p_discount_type: discountType,
    p_discount_value: discountValue,
    p_min_order_value: minOrderValue,
    p_applicable_categories: applicableCategories,
    p_applicable_products: applicableProducts,
    p_free_product_name: freeProductName,
    p_expires_at: expiresAt,
  });
  if (rpcErr) {
    if (rpcErr.message?.includes("insufficient_beans")) {
      return { ok: false, reason: "insufficient_beans" };
    }
    console.error("[v2] redeemPointsShopReward: rpc error", rpcErr.message);
    return { ok: false, reason: "insert_failed" };
  }

  const newBalance = Array.isArray(data) && data.length > 0
    ? Number((data[0] as { new_balance: number }).new_balance)
    : 0;

  // Commit 2: the redeem_points_shop_reward RPC inserts the voucher
  // without voucher_template_id (the stored proc predates the template
  // registry). Stamp it here so the minted voucher carries its
  // canonical link. Non-fatal if it fails — the inline discount fields
  // still drive checkout during the grace window.
  await supabase
    .from("issued_rewards")
    .update({ voucher_template_id: reward.id as string })  // reward.id is the template UUID now
    .eq("id", id);

  // Hydrate the voucher row for the caller. The RPC inserted it
  // already, this is just a read-back so we return the same shape
  // the previous TS code did.
  const { data: voucher } = await supabase
    .from("issued_rewards")
    .select("*")
    .eq("id", id)
    .single();

  return {
    ok: true,
    voucher: (voucher ?? { id }) as IssuedVoucher,
    newBalance,
    pointsSpent: pointsRequired,
  };
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
 *  Idempotent on referee_id (a member can only be referred once).
 *
 *  Returns a structured failure reason so the API route can return a
 *  clearer error message and the client can decide what to show:
 *   - not_found   → code doesn't match any active referrer
 *   - self        → referee tried to use their own code
 *   - not_new     → referee already has paid orders (the referral
 *                   bonus is only meant for genuinely new customers)
 *   - duplicate   → referee already has an attribution row from a
 *                   prior code (DB UNIQUE on referee_id)
 *   - error       → generic insert failure
 */
export async function attributeReferralOnSignup(args: {
  refereeId: string;
  code: string;
}): Promise<{
  ok: boolean;
  referrerId?: string;
  reason?: "not_found" | "self" | "not_new" | "duplicate" | "error";
}> {
  const supabase = getSupabaseAdmin();
  const { data: refRow } = await supabase
    .from("referral_codes")
    .select("member_id")
    .eq("code", args.code)
    .single();
  if (!refRow) return { ok: false, reason: "not_found" };
  if (refRow.member_id === args.refereeId) return { ok: false, reason: "self" };

  // Eligibility guard: the referee must be a genuinely new customer.
  // Without this, an existing customer with N prior orders could sign
  // out, sign back in, type a friend's code, and farm a referee bonus
  // on their (N+1)th order — and the referrer would also get credit
  // for "bringing in" someone who was already a paying customer.
  // Counts orders in any post-payment state (preparing / ready /
  // completed). pending / failed / cancelled don't count.
  const { count: priorPaidOrders } = await supabase
    .from("orders")
    .select("id", { count: "exact", head: true })
    .eq("loyalty_id", args.refereeId)
    .in("status", ["preparing", "ready", "completed"]);
  if ((priorPaidOrders ?? 0) > 0) {
    return { ok: false, reason: "not_new" };
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
  if (error) {
    // 23505 = unique_violation on referee_id (the member has been
    // attributed before, whether or not the prior attribution paid out).
    if ((error as { code?: string }).code === "23505") {
      return { ok: false, reason: "duplicate" };
    }
    return { ok: false, reason: "error" };
  }
  return { ok: true, referrerId: refRow.member_id as string };
}

/** Called from the order completion path. If this is the referee's
 *  first qualifying order, issue both-side vouchers and flip the
 *  attribution to 'rewarded'.
 *
 *  Configuration source: the active reward_missions row with
 *  goal.type='referrals_count'. reward_voucher_template_ids drives
 *  the REFERRER side, referee_reward_voucher_template_ids drives the
 *  REFEREE side. The referrals admin page that used to live on
 *  /loyalty/referrals was retired — referral templates are now edited
 *  on the mission row inside the Challenges admin. */
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

  // Load referral mission config — single source of truth. Falls back
  // to the first active referrals_count row if multiple exist (should
  // be one).
  const { data: mission, error: missionErr } = await supabase
    .from("reward_missions")
    .select("id, reward_voucher_template_ids, referee_reward_voucher_template_ids")
    .eq("is_active", true)
    .filter("goal->>type", "eq", "referrals_count")
    .limit(1)
    .maybeSingle();
  if (missionErr) {
    console.error(
      `[v2] maybeRewardReferralOnFirstOrder: failed to load referral mission`,
      `attribution=${attr.id}`,
      `referrer=${attr.referrer_id}`,
      `referee=${args.memberId}`,
      `error=${missionErr.message}`,
    );
    return;
  }
  const referrerTpl = ((mission?.reward_voucher_template_ids ?? []) as string[])[0] ?? null;
  const refereeTpl  = ((mission?.referee_reward_voucher_template_ids ?? []) as string[])[0] ?? null;
  if (!referrerTpl || !refereeTpl) {
    // Misconfigured referral mission. Both sides expected a reward,
    // neither gets one — log loud so an admin can spot the gap in
    // observability without waiting for customers to complain. We
    // do NOT mark the attribution rewarded so when admin fixes the
    // config the next paid order from this referee can still trigger
    // payout (idempotent on referee_id).
    console.error(
      `[v2] maybeRewardReferralOnFirstOrder: referral mission misconfigured — referrer + referee got nothing`,
      `attribution=${attr.id}`,
      `mission=${mission?.id ?? "missing"}`,
      `referrerTpl=${referrerTpl ?? "null"}`,
      `refereeTpl=${refereeTpl ?? "null"}`,
      `referrer=${attr.referrer_id}`,
      `referee=${args.memberId}`,
    );
    return;
  }

  const refereeVoucher  = await issueVoucher({ memberId: args.memberId,             templateId: refereeTpl,  sourceType: "referral", sourceRefId: attr.id });
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

type GoalFilter = {
  // Bill placed strictly before this hour (0-23). Used for time-of-day
  // gated single-order goals.
  order_hour_lt?: number;
  // Bill placed on these days. JS Date.getDay() values — 0=Sun, 6=Sat.
  // Used for weekend / weekday gated goals.
  order_day_in?: number[];
};
type Goal = {
  type: string;
  threshold: number;
  filter?: GoalFilter;
  // For single_order_has_groups + single_order_group_count — names
  // resolved against CATEGORY_GROUPS below. Keeps mission JSON terse
  // ("drinks" / "food" / "pastry") instead of inlining 6-8 fine-grained
  // category strings that drift as the menu evolves.
  groups?: string[];
  group?: string;
};

type OrderItemForMission = {
  product_id: string;
  category: string | null;
  quantity: number;
};

type OrderForMission = {
  id: string;
  outlet_id: string;
  items: OrderItemForMission[];
  item_ids: string[];
  item_count: number;
  total_sen: number;
  created_at: string;
};

// Group fine-grained product categories into the broad buckets the
// challenge engine cares about. New menu categories can be added here
// without touching mission seed JSON.
export const CATEGORY_GROUPS: Record<string, ReadonlyArray<string>> = {
  drinks: [
    "classic", "flavoured", "mocha", "artisan-choc", "artisan-matcha",
    "fruit-tea", "gourmet-tea", "mocktails",
  ],
  food: [
    "nasi-lemak", "noodle", "pasta", "roti-bakar", "sandwiches", "fries",
  ],
  pastry: ["cakes", "cookies", "croissant"],
};

function evalGoalOnOrder(goal: Goal, order: OrderForMission): number {
  // Returns the increment to add to progress_current for this single order.
  // Most goals add 1 per qualifying order; some (like
  // "single_order_item_count" or "single_order_total_at_least") complete
  // the goal in one shot when the order crosses the threshold. Goals
  // that require seeing the member's PRIOR orders (distinct_outlets,
  // distinct_new_products) are handled in evalDedupedGoal below — this
  // function returns 0 for them so callers know they need the async
  // dedup path. Referrals are configured on the referrals_count
  // mission row but are NOT progressed via this evaluator anymore —
  // the per-referral voucher is issued directly in
  // maybeRewardReferralOnFirstOrder, so the mission's only role is
  // to hold the voucher templates as config.
  // Time/day filters are MYT (UTC+8) wall-clock. The server runs in UTC
  // (Vercel), so shift the instant by +8h and read the UTC fields — same
  // trick distinct_order_days uses below. Without this, "before 11am" and
  // "Sat/Sun" were evaluated against UTC, i.e. 8h / one day off.
  const createdMyt = new Date(new Date(order.created_at).getTime() + 8 * 3_600_000);
  if (goal.filter?.order_hour_lt !== undefined && createdMyt.getUTCHours() >= goal.filter.order_hour_lt) {
    return 0;
  }
  if (goal.filter?.order_day_in && !goal.filter.order_day_in.includes(createdMyt.getUTCDay())) {
    return 0;
  }
  switch (goal.type) {
    case "orders_count":               return goal.threshold > 0 ? 1 : 0;
    case "single_order_item_count":    return order.item_count >= goal.threshold ? goal.threshold : 0;
    case "single_order_total_at_least":
      // total_sen is the order subtotal in sen. The threshold lives in
      // sen too (set via the seed migration) so we compare directly.
      // Completes the mission in one shot when the bill clears the bar.
      return order.total_sen >= goal.threshold ? goal.threshold : 0;
    case "single_order_has_groups": {
      // Bill must contain at least one item from EVERY listed group
      // (e.g. "Make it a Meal" needs drink + food in the same bill).
      const groups = goal.groups ?? [];
      if (groups.length === 0) return 0;
      const cats = new Set(order.items.map((i) => i.category).filter((c): c is string => !!c));
      const hasAll = groups.every((g) => {
        const list = CATEGORY_GROUPS[g] ?? [];
        return list.some((c) => cats.has(c));
      });
      return hasAll ? goal.threshold : 0;
    }
    case "single_order_group_count": {
      // Bill must contain at least `threshold` items from a named
      // group (e.g. "Pastry Pair" needs 2+ pastries in one bill).
      const group = goal.group;
      if (!group) return 0;
      const list = new Set(CATEGORY_GROUPS[group] ?? []);
      const count = order.items
        .filter((i) => i.category && list.has(i.category))
        .reduce((s, i) => s + (i.quantity ?? 1), 0);
      return count >= goal.threshold ? goal.threshold : 0;
    }
    case "spend_amount":               return order.total_sen;
    case "distinct_outlets":           return 0; // dedup: see evalDedupedGoal
    case "distinct_new_products":      return 0; // dedup: see evalDedupedGoal
    case "distinct_order_days":        return 0; // dedup: see evalDedupedGoal (one tick per new paid day)
    case "referrals_count":            return 0; // referral mission is config-only; vouchers fire from maybeRewardReferralOnFirstOrder
    default:                            return 0;
  }
}

/** Goals that need the member's prior order history to evaluate
 *  correctly. Without this dedup, "Outlet Hopper · 3 outlets" would
 *  complete on 3 orders from the same outlet, and "Try Something New ·
 *  3 distinct drinks" would complete after 3 orders of the same drink.
 *
 *  Returns 1 when the current order introduces a new outlet / a new
 *  product compared to the customer's previous orders, otherwise 0. */
async function evalDedupedGoal(
  supabase: ReturnType<typeof getSupabaseAdmin>,
  memberId: string,
  goal: Goal,
  order: OrderForMission,
): Promise<number> {
  if (goal.type === "distinct_outlets") {
    // Has the member ever ordered from this outlet BEFORE this order?
    const { count } = await supabase
      .from("orders")
      .select("id", { count: "exact", head: true })
      .eq("loyalty_id", memberId)
      .eq("store_id", order.outlet_id)
      .neq("id", order.id)
      .in("status", ["preparing", "ready", "completed"]);
    return (count ?? 0) === 0 ? 1 : 0;
  }
  if (goal.type === "distinct_new_products") {
    if (order.item_ids.length === 0) return 0;
    // Any product in the current order that the member has NEVER
    // ordered before counts. The mission ticks +1 if at least one such
    // "new" product appears — same semantics as Starbucks' Try It Free.
    const { data: prior } = await supabase
      .from("order_items")
      .select("product_id, order_id, orders!inner(loyalty_id, status)")
      .eq("orders.loyalty_id", memberId)
      .in("orders.status", ["preparing", "ready", "completed"])
      .neq("order_id", order.id);
    const priorIds = new Set<string>((prior ?? []).map((p) => p.product_id as string));
    const hasNew = order.item_ids.some((p) => !priorIds.has(p));
    return hasNew ? 1 : 0;
  }
  if (goal.type === "distinct_order_days") {
    // Frequency goal: +1 the FIRST paid order on each calendar day (MYT),
    // so progress = number of distinct days the member ordered this week.
    // Unlike orders_count (which counts every order, completable in one
    // sitting), this can only be cleared by returning on separate days —
    // the lever for repeat-visit frequency. Caller already filtered free
    // orders (applyOrderToMission), so this order is paid.
    const d = new Date(order.created_at);
    const dayStr = new Date(d.getTime() + 8 * 3_600_000).toISOString().slice(0, 10); // MYT calendar day
    const dayStartUtc = new Date(`${dayStr}T00:00:00+08:00`).toISOString();
    const dayEndUtc   = new Date(`${dayStr}T23:59:59.999+08:00`).toISOString();
    const { count } = await supabase
      .from("orders")
      .select("id", { count: "exact", head: true })
      .eq("loyalty_id", memberId)
      .neq("id", order.id)
      .gt("total", 0)
      .in("status", ["preparing", "ready", "completed"])
      .gte("created_at", dayStartUtc)
      .lte("created_at", dayEndUtc);
    return (count ?? 0) === 0 ? 1 : 0; // first paid order today → new distinct day
  }
  return 0;
}

/** Issue vouchers + bump completion counter + push. Shared by every code
 *  path that flips a mission_assignment to 'completed' so the side
 *  effects stay in one place.
 *
 *  Bonus-Points award was dropped: challenges grant vouchers only now
 *  ("focus on rewards only, no need +beans"). Points-multiplier vouchers
 *  in the catalogue still work the same way at order time. */
async function fulfilCompletedAssignment(args: {
  memberId: string;
  assignmentId: string;
  missionId: string;
  missionTitle: string;
  voucherTemplateIds: string[];
}): Promise<void> {
  const supabase = getSupabaseAdmin();

  let issuedCount = 0;
  for (const tplId of args.voucherTemplateIds) {
    const v = await issueVoucher({
      memberId: args.memberId,
      templateId: tplId,
      sourceType: "mission",
      sourceRefId: args.assignmentId,
    });
    if (v) issuedCount++;
  }

  try {
    await supabase.rpc("increment_mission_completed", { mission_id_param: args.missionId });
  } catch { /* analytics bump is non-critical */ }

  notifyMissionCompleted({
    memberId: args.memberId,
    missionTitle: args.missionTitle,
    voucherCount: issuedCount,
  }).catch(() => {});
}

/** Apply an order to ALL of the customer's active mission assignments
 *  for the current week. Each assignment is evaluated independently;
 *  one order can advance multiple missions. Idempotency within a single
 *  order is not yet enforced (TODO: track processed order_ids per
 *  assignment) — the current callers fire once per completed order. */
export async function applyOrderToMission(args: {
  memberId: string;
  order: OrderForMission;
}): Promise<{ completedMissionIds: string[] }> {
  const supabase = getSupabaseAdmin();

  // Paid-only: a fully-free order (RM0 — a reward/voucher redemption) must
  // NOT advance any mission. Otherwise a redeemed free drink completes the
  // next mission and mints another free drink — a self-feeding chain (the
  // Yousef case: free order completed "Try Something New" → 2nd free coffee).
  // Real money must change hands for a visit/spend/new-product to count.
  if (args.order.total_sen <= 0) {
    return { completedMissionIds: [] };
  }

  // Week-window guard: only credit this order to assignments whose week
  // actually contains the order time. Without this, a member accumulates one
  // active assignment per week and a single order completes the same mission
  // for EVERY un-expired past week at once (the stale-week stacking bug:
  // e.g. one order minting 3× Free Coffee for weeks it didn't earn). Pairs
  // with the daily expiry sweep that flips past-week assignments to 'expired'.
  const { data: assignments } = await supabase
    .from("mission_assignments")
    .select("id, mission_id, progress_current, progress_target")
    .eq("member_id", args.memberId)
    .eq("status", "active")
    .lte("week_start_at", args.order.created_at)
    .gte("week_end_at", args.order.created_at);

  if (!assignments || assignments.length === 0) {
    return { completedMissionIds: [] };
  }

  const completedMissionIds: string[] = [];

  for (const assignment of assignments) {
    const { data: mission } = await supabase
      .from("reward_missions")
      .select("id, title, goal, reward_voucher_template_ids, reward_bonus_beans")
      .eq("id", assignment.mission_id)
      .single();
    if (!mission) continue;

    const goal = mission.goal as Goal;
    let inc = evalGoalOnOrder(goal, args.order);
    if (inc === 0 && (goal.type === "distinct_outlets" || goal.type === "distinct_new_products" || goal.type === "distinct_order_days")) {
      inc = await evalDedupedGoal(supabase, args.memberId, goal, args.order);
    }
    if (inc === 0) continue;

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
      completedMissionIds.push(assignment.mission_id);
      await fulfilCompletedAssignment({
        memberId: args.memberId,
        assignmentId: assignment.id,
        missionId: mission.id,
        missionTitle: (mission.title as string) ?? "Challenge",
        voucherTemplateIds: (mission.reward_voucher_template_ids ?? []) as string[],
      });
    }
  }

  return { completedMissionIds };
}

// ─── Mystery Bean drop ───────────────────────────────────────────────

// Per-member cap on mystery voucher wins. Mystery still spawns on
// every paid order — the pool's "Just your Points" entry is what the
// customer scratches to when they're at-or-over cap, so the drop
// event still happens (no UX regression) but the wallet doesn't
// snowball. Counts mystery_drops with outcome_type='voucher' in the
// rolling window, regardless of reveal status — so hoarding
// un-revealed drops can't bypass the cap.
const MYSTERY_VOUCHER_WIN_CAP        = 3;  // max prize wins per member
const MYSTERY_VOUCHER_WINDOW_DAYS    = 7;  // rolling window length

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

  // Tier-gate by rank: an outcome with min_tier='silver' should be
  // available to silver / gold / platinum, not just silver. Earlier
  // exact-match filter excluded higher tiers from gold/silver-only
  // outcomes — invisible to anyone above the min. Invitation tiers
  // (Staff, Black Card) are ranked above Platinum so they see
  // everything that's available to Platinum + their own tier.
  const TIER_RANK: Record<string, number> = {
    bronze: 1, silver: 2, gold: 3, elite: 4,
    "arba-staff": 5, "black-card": 5,
  };
  const memberRank = args.memberTier ? (TIER_RANK[args.memberTier] ?? 1) : 1;
  const eligible = pool.filter((e) => {
    if (!e.min_tier) return true;
    const need = TIER_RANK[e.min_tier] ?? 99;
    return memberRank >= need;
  });
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

  // Per-member voucher cap. If this member has already banked
  // MYSTERY_VOUCHER_WIN_CAP voucher drops in the last
  // MYSTERY_VOUCHER_WINDOW_DAYS days, swap the pick to the
  // no_bonus entry — the drop event still happens, the customer
  // still gets a card to scratch, they just land on "Just your
  // Points" instead. Light users see full pool odds; heavy users
  // (or testers) get throttled.
  if (pick.outcome_type === "voucher") {
    const windowStart = new Date(
      Date.now() - MYSTERY_VOUCHER_WINDOW_DAYS * 24 * 60 * 60 * 1000,
    ).toISOString();
    const { count: recentWins } = await supabase
      .from("mystery_drops")
      .select("id", { count: "exact", head: true })
      .eq("member_id", args.memberId)
      .eq("outcome_type", "voucher")
      .gte("created_at", windowStart);
    if ((recentWins ?? 0) >= MYSTERY_VOUCHER_WIN_CAP) {
      const noBonus = eligible.find((e) => e.outcome_type === "no_bonus");
      if (noBonus) pick = noBonus;
    }
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

  // Wallet voucher → consumed. Doesn't deduct Points (wallet vouchers
  // cost nothing to claim). Idempotent: a second call no-ops because
  // status='used' is sticky.
  //
  // Constraint note: issued_rewards.status only allows ('active','used',
  // 'expired') — earlier writes here used 'redeemed' which failed the
  // CHECK constraint silently (errors caught + logged but never
  // surfaced), so wallet vouchers stayed status='active' forever and
  // could be re-applied at every checkout. Aligning with the existing
  // enum.
  //
  // ALSO: if the voucher was a multiplier (beans_multiplier with
  // multiplier_value > 1), credit the bonus Points NOW — the cart-side
  // discount engine returns 0 for multiplier vouchers because the
  // multiplier is a post-payment boost, not a price reduction. Without
  // this branch a "2× Points Boost" voucher would be consumed at
  // checkout without ever doubling the customer's earned points.
  if (walletVoucherId) {
    try {
      // Fetch BEFORE the update so we still see the discount metadata
      // (status='used' rows don't get re-read anywhere else in this
      // function).
      const { data: voucher } = await supabase
        .from("issued_rewards")
        .select("discount_type, multiplier_value, title")
        .eq("id", walletVoucherId)
        .eq("member_id", memberId)
        .single();

      // Shared mark-used helper — idempotent (only flips active
      // rows) and stamps redeemed_at. Matches POS's mark-used path
      // so a voucher burned on either surface looks identical
      // post-redemption.
      const { markVoucherUsed } = await import("@celsius/shared");
      const result = await markVoucherUsed({
        supabase,
        voucherId: walletVoucherId,
        memberId,
      });
      if (!result.ok) console.warn("[v2] markVoucherUsed failed", result.error);

      // Multiplier credit. Reads the order's loyalty_points_earned to
      // know what 100% of the base award was, then awards (mul - 1) ×
      // base as a separate "voucher_bonus" transaction. Keeps the base
      // points ledger entry from earnLoyaltyPoints untouched so audit
      // history reads cleanly (base + bonus, not a mutated base).
      const mul = Number((voucher as { multiplier_value?: number | string | null } | null)?.multiplier_value ?? 0);
      const dt  = (voucher as { discount_type?: string | null } | null)?.discount_type ?? null;
      if (voucher && dt === "beans_multiplier" && mul > 1) {
        const { data: orderRow } = await supabase
          .from("orders")
          .select("loyalty_points_earned")
          .eq("id", orderId)
          .single();
        const base = Number((orderRow as { loyalty_points_earned?: number | null } | null)?.loyalty_points_earned ?? 0);
        const bonus = Math.round(base * (mul - 1));
        if (bonus > 0) {
          await awardBonusBeans({
            memberId,
            amount: bonus,
            description: `${(voucher as { title?: string | null }).title ?? "Boost voucher"} (${mul}× bonus)`,
            referenceId: walletVoucherId,
            txnType: "manual_bonus",
          });
        }
      }
    } catch (e) {
      console.warn("[v2] markVoucherUsed/multiplier failed", e);
    }
  }

  // Mission progress. Looks up all the customer's active assignments,
  // evals this order against each, increments progress, and completes
  // any that crossed the threshold. We pull per-item categories so the
  // category-aware goal types (Make it a Meal / Pastry Pair / Double
  // Up) can match against the bill.
  try {
    const [{ data: items }, { data: orderRow }] = await Promise.all([
      supabase
        .from("order_items")
        .select("product_id, quantity")
        .eq("order_id", orderId),
      supabase
        .from("orders")
        .select("total")
        .eq("id", orderId)
        .single(),
    ]);
    const itemRows = items ?? [];
    const itemIds = itemRows.map((i) => i.product_id as string);
    const itemCount = itemRows.reduce((sum, i) => sum + ((i.quantity as number) ?? 0), 0);
    const totalSen = Number((orderRow as { total?: number | null } | null)?.total ?? 0);

    // Resolve product → category via a single batched lookup. order_items
    // doesn't denormalise category and a Supabase FK join needs PostgREST
    // relationship metadata that isn't configured for this pair, so a
    // separate query keeps things robust.
    const categoryById = new Map<string, string>();
    if (itemIds.length > 0) {
      const { data: productsData } = await supabase
        .from("products")
        .select("id, category")
        .in("id", itemIds);
      for (const p of productsData ?? []) {
        if (p.id && p.category) {
          categoryById.set(p.id as string, p.category as string);
        }
      }
    }
    const itemsForMission = itemRows.map((i) => ({
      product_id: i.product_id as string,
      category: categoryById.get(i.product_id as string) ?? null,
      quantity: (i.quantity as number) ?? 1,
    }));

    await applyOrderToMission({
      memberId,
      order: {
        id: orderId,
        outlet_id: outletId,
        items: itemsForMission,
        item_ids: itemIds,
        item_count: itemCount,
        total_sen: totalSen,
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
