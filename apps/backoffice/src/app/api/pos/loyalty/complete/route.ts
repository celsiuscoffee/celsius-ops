import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { markVoucherUsed } from "@celsius/shared";

/**
 * POST /api/pos/loyalty/complete
 * Body: { member_id, order_id }
 *
 * Runs the loyalty "order hooks" for a completed POS (in-store register)
 * sale — the counter-sales equivalent of what apps/order does on a pickup
 * order's payment confirmation. Until this existed, POS orders earned no
 * Beans, advanced no tier, and never spawned a Mystery Bean (only pickup /
 * web orders ran the engine), so a member ordering at the till got nothing.
 *
 * Server-authoritative: the spend is read from the pos_orders row, never
 * trusted from the client. Idempotent per order:
 *   - Beans   → skipped if a point_transactions 'earn' already references
 *               this order (so a fire-and-forget retry can't double-award).
 *   - Mystery → skipped if a mystery_drops row already exists for the order.
 *
 * Beans + tier go through the canonical DB RPCs (add_loyalty_points,
 * evaluate_member_tier) so the POS ledger entry is identical to pickup's.
 * The Mystery Bean spawn mirrors apps/order generateMysteryDrop (weighted
 * pool pick with tier-gate, birthday boost, and the per-member voucher cap).
 *
 * Challenges/missions are intentionally NOT run here yet — that needs the
 * shared mission-eval engine and is tracked separately.
 *
 * Best-effort: every step is independently guarded so a failure in one
 * never blocks the others or the sale. Always 200 with a summary.
 */

const BRAND_ID = "brand-celsius";
const MYSTERY_VOUCHER_WIN_CAP = 3; // max prize wins per member
const MYSTERY_VOUCHER_WINDOW_DAYS = 7; // rolling window length

function getAdmin() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
  );
}

type Admin = ReturnType<typeof getAdmin>;

function genCode(): string {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let c = "";
  for (let i = 0; i < 8; i++) c += chars.charAt(Math.floor(Math.random() * chars.length));
  return c;
}

/**
 * Commit a catalog reward the register RESERVED at apply time (it called
 * /redeem in preview mode → no burn). This is where the Beans are actually
 * spent: once, only after payment confirmed. Idempotent on order_id (skips if
 * a 'redeem' txn already references it). A no-op when the order carried no
 * reward, or carried a reward_id that doesn't resolve to a catalog template
 * (e.g. an issued-voucher redemption already committed at apply time).
 */
async function commitReservedRedemption(
  supabase: Admin,
  args: { memberId: string; orderId: string; rewardId: string | null; outletId: string | null },
): Promise<number> {
  if (!args.rewardId) return 0;
  const { data: already } = await supabase
    .from("point_transactions")
    .select("id")
    .eq("reference_id", args.orderId)
    .eq("type", "redeem")
    .limit(1)
    .maybeSingle();
  if (already) return 0;

  const { data: reward } = await supabase
    .from("voucher_templates")
    .select("title, points_cost")
    .eq("legacy_reward_id", args.rewardId)
    .eq("brand_id", BRAND_ID)
    .eq("is_active", true)
    .maybeSingle();
  const pointsCost = Number((reward as { points_cost?: number } | null)?.points_cost ?? 0);
  if (!reward || pointsCost <= 0) {
    // Not a points-cost catalog reward → it may be an ISSUED VOUCHER that the
    // register RESERVED at apply time (rewardId carries the issued_reward id).
    // Burn it now that payment is confirmed — costs no points. Idempotent:
    // markVoucherUsed only flips an 'active' row, so a retry returns
    // alreadyUsed and we skip the duplicate redemption row.
    const { data: ir } = await supabase
      .from("issued_rewards")
      .select("id, title")
      .eq("id", args.rewardId)
      .eq("member_id", args.memberId)
      .eq("brand_id", BRAND_ID)
      .eq("status", "active")
      .maybeSingle();
    if (ir) {
      const burn = await markVoucherUsed({ supabase, voucherId: (ir as { id: string }).id, memberId: args.memberId, brandId: BRAND_ID });
      if (burn.ok && !burn.alreadyUsed) {
        await supabase.from("redemptions").insert({
          id: `rdm-pos-${Date.now()}-${Math.floor(Math.random() * 9000 + 1000)}`,
          member_id: args.memberId, reward_id: (ir as { id: string }).id, brand_id: BRAND_ID,
          outlet_id: args.outletId, points_spent: 0, status: "confirmed",
          code: genCode(), redemption_type: "in_store", source: "pos",
          confirmed_at: new Date().toISOString(),
        });
      }
    }
    return 0; // points-wise a no-op (vouchers cost no Beans)
  }

  const { data: newBal, error: deductErr } = await supabase.rpc("deduct_points", {
    p_member_id: args.memberId, p_brand_id: BRAND_ID, p_points: pointsCost,
  });
  if (deductErr || typeof newBal !== "number" || newBal < 0) return 0;

  await supabase.from("point_transactions").insert({
    id: `txn-pos-${Date.now()}-${Math.floor(Math.random() * 9000 + 1000)}`,
    member_id: args.memberId, brand_id: BRAND_ID, outlet_id: args.outletId,
    type: "redeem", points: -pointsCost, balance_after: newBal,
    description: `POS Redeemed: ${(reward as { title?: string }).title ?? "reward"}`,
    reference_id: args.orderId, multiplier: 1,
  });
  await supabase.from("redemptions").insert({
    id: `rdm-pos-${Date.now()}-${Math.floor(Math.random() * 9000 + 1000)}`,
    member_id: args.memberId, reward_id: args.rewardId, brand_id: BRAND_ID,
    outlet_id: args.outletId, points_spent: pointsCost, status: "confirmed",
    code: genCode(), redemption_type: "in_store", source: "pos",
    confirmed_at: new Date().toISOString(),
  });
  return pointsCost;
}

type MysteryPoolEntry = {
  id: string;
  outcome_type: "beans_multiplier" | "flat_beans" | "voucher" | "no_bonus" | "surprise_in_store";
  multiplier_value: number | null;
  flat_beans_value: number | null;
  voucher_template_id: string | null;
  weight: number;
  min_tier: string | null;
  birthday_month_boost: boolean;
};

/** Tier-gate by rank: an outcome with min_tier='silver' is available to
 *  silver and everyone above. Invitation tiers rank above the ladder. */
const TIER_RANK: Record<string, number> = {
  bronze: 1, silver: 2, gold: 3, elite: 4, "arba-staff": 5, "black-card": 5,
};

/** Mirrors apps/order/src/lib/loyalty/v2.ts generateMysteryDrop, against the
 *  same mystery_pool / mystery_drops tables. Append-only; the caller guards
 *  on an existing drop for the order so this runs at most once per sale. */
async function spawnMysteryDrop(
  supabase: Admin,
  args: { memberId: string; orderId: string; memberTier: string | null; birthdayMonth: number | null },
): Promise<boolean> {
  const { data: poolRaw } = await supabase
    .from("mystery_pool")
    .select("id, outcome_type, multiplier_value, flat_beans_value, voucher_template_id, weight, min_tier, birthday_month_boost")
    .eq("brand_id", BRAND_ID)
    .eq("is_active", true);

  const pool = (poolRaw ?? []) as MysteryPoolEntry[];
  if (pool.length === 0) return false;

  const memberRank = args.memberTier ? (TIER_RANK[args.memberTier] ?? 1) : 1;
  const eligible = pool.filter((e) => {
    if (!e.min_tier) return true;
    return memberRank >= (TIER_RANK[e.min_tier] ?? 99);
  });
  if (eligible.length === 0) return false;

  const currentMonth = new Date().getMonth() + 1;
  const birthdayBoost = args.birthdayMonth !== null && args.birthdayMonth === currentMonth;
  const weights = eligible.map((e) => (e.birthday_month_boost && birthdayBoost ? e.weight * 2 : e.weight));
  const totalWeight = weights.reduce((a, b) => a + b, 0);
  if (totalWeight === 0) return false;

  let r = Math.random() * totalWeight;
  let pick: MysteryPoolEntry = eligible[0];
  for (let i = 0; i < eligible.length; i++) {
    r -= weights[i];
    if (r <= 0) { pick = eligible[i]; break; }
  }

  // Per-member voucher cap: heavy winners get swapped to the no_bonus entry
  // ("Just your Beans") so the drop event still happens but the wallet
  // doesn't snowball.
  if (pick.outcome_type === "voucher") {
    const windowStart = new Date(Date.now() - MYSTERY_VOUCHER_WINDOW_DAYS * 24 * 60 * 60 * 1000).toISOString();
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

  const { error } = await supabase.from("mystery_drops").insert({
    member_id: args.memberId,
    order_id: args.orderId,
    pool_entry_id: pick.id,
    outcome_type: pick.outcome_type,
    multiplier_applied: pick.outcome_type === "beans_multiplier" ? pick.multiplier_value : null,
    beans_awarded: pick.outcome_type === "flat_beans" ? pick.flat_beans_value : null,
    voucher_id: null, // populated on reveal if this is a voucher outcome
  });
  if (error) {
    console.warn("[pos/loyalty/complete] mystery insert failed:", error.message);
    return false;
  }
  return true;
}

export async function POST(req: NextRequest) {
  try {
    const { member_id, order_id } = await req.json();
    if (!member_id || !order_id) {
      return NextResponse.json({ error: "member_id and order_id required" }, { status: 400 });
    }

    const supabase = getAdmin();

    // Server-authoritative spend + outlet from the order row itself.
    const { data: order } = await supabase
      .from("pos_orders")
      .select("id, total, sst_amount, outlet_id, status, reward_id")
      .eq("id", order_id)
      .maybeSingle();
    if (!order) {
      return NextResponse.json({ error: "Order not found" }, { status: 404 });
    }
    if (order.status !== "completed") {
      return NextResponse.json({ ok: false, reason: "order not completed" });
    }

    // Member tier (slug + multiplier) + birthday for the weighted mystery pick.
    const [{ data: mb }, { data: memberRow }] = await Promise.all([
      supabase
        .from("member_brands")
        .select("tiers(slug, multiplier)")
        .eq("member_id", member_id)
        .eq("brand_id", BRAND_ID)
        .maybeSingle(),
      supabase.from("members").select("brand_data").eq("id", member_id).maybeSingle(),
    ]);
    const tier = (mb as { tiers?: { slug?: string | null; multiplier?: number | null } | null } | null)?.tiers ?? null;
    const tierSlug = tier?.slug ?? null;
    const tierMul = Number(tier?.multiplier ?? 1) || 1;
    const bdayIso = (memberRow?.brand_data as { birthday?: string | null } | null)?.birthday ?? null;
    const birthdayMonth = bdayIso ? new Date(bdayIso).getMonth() + 1 : null;

    let pointsAwarded = 0;
    let mysterySpawned = false;
    let rewardBurned = 0;

    // ── Reward redemption commit — burn the Beans for a reward the register
    //    RESERVED at apply time, now that payment is confirmed. One per order,
    //    idempotent; no-op if the order carried no (catalog) reward. ────────
    try {
      rewardBurned = await commitReservedRedemption(supabase, {
        memberId: member_id,
        orderId: order_id,
        rewardId: (order as { reward_id?: string | null }).reward_id ?? null,
        outletId: order.outlet_id ?? null,
      });
    } catch (e) {
      console.warn("[pos/loyalty/complete] reward-commit step failed", e);
    }

    // ── Beans (idempotent on order_id) ───────────────────────────────
    try {
      const { data: existingEarn } = await supabase
        .from("point_transactions")
        .select("id")
        .eq("reference_id", order_id)
        .eq("type", "earn")
        .limit(1)
        .maybeSingle();

      if (!existingEarn) {
        // Earn on the pre-tax paid amount (Beans aren't awarded on SST),
        // tier-multiplied — same shape as the pickup quote/earn path.
        const totalSen = Number(order.total ?? 0);
        const sstSen = Number(order.sst_amount ?? 0);
        const netSen = Math.max(0, totalSen - sstSen);
        const { data: setting } = await supabase
          .from("app_settings")
          .select("value")
          .eq("key", "points_per_rm")
          .maybeSingle();
        const pointsPerRm = Number((setting?.value as { rate?: number } | null)?.rate ?? 1) || 1;
        const basePoints = Math.floor((netSen / 100) * pointsPerRm);
        const points = Math.round(basePoints * tierMul);
        if (points > 0) {
          const { error: rpcErr } = await supabase.rpc("add_loyalty_points", {
            p_member_id: member_id,
            p_brand_id: BRAND_ID,
            p_points: points,
            p_outlet_id: order.outlet_id ?? "",
            p_order_id: order_id,
            p_multiplier: tierMul,
            p_description: "Points earned for in-store order",
          });
          if (rpcErr) {
            console.warn("[pos/loyalty/complete] add_loyalty_points failed:", rpcErr.message);
          } else {
            pointsAwarded = points;
            // Stamp the order so reports/audit show what was earned.
            await supabase.from("pos_orders").update({ loyalty_points_earned: points }).eq("id", order_id);
            // Tier re-eval so a member who just crossed a threshold bumps now.
            await supabase.rpc("evaluate_member_tier", { p_member_id: member_id, p_brand_id: BRAND_ID }).then(
              () => {},
              () => {},
            );
          }
        }
      }
    } catch (e) {
      console.warn("[pos/loyalty/complete] beans step failed", e);
    }

    // ── Mystery Bean (idempotent on order_id) ────────────────────────
    try {
      const { data: existingDrop } = await supabase
        .from("mystery_drops")
        .select("id")
        .eq("order_id", order_id)
        .limit(1)
        .maybeSingle();
      if (!existingDrop) {
        mysterySpawned = await spawnMysteryDrop(supabase, {
          memberId: member_id,
          orderId: order_id,
          memberTier: tierSlug,
          birthdayMonth,
        });
      }
    } catch (e) {
      console.warn("[pos/loyalty/complete] mystery step failed", e);
    }

    return NextResponse.json({ ok: true, points_awarded: pointsAwarded, mystery_spawned: mysterySpawned, reward_burned: rewardBurned });
  } catch (err) {
    console.error("[pos/loyalty/complete] error:", err);
    return NextResponse.json({ error: "complete hooks failed" }, { status: 500 });
  }
}
