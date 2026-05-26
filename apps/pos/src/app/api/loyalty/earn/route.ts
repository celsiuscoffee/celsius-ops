import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

// Service-role required: member_brands writes + mystery_drops insert
// are RLS-locked. With anon they silently no-op which was hiding two
// bugs at once — points sometimes not landing on member_brands and
// mystery drops never being created for POS orders.
const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
);

const BRAND_ID = "brand-celsius";

// ─── Mystery drop generation ─────────────────────────────────
// Ported from apps/order/src/lib/loyalty/v2.ts generateMysteryDrop()
// so POS orders trigger the same Mystery Bag flow pickup orders do.
// Without this, paid POS orders never insert a mystery_drops row → the
// customer-display's Thank You screen polls snapshot and finds no
// pending mystery → the MysteryBox tap-to-reveal card never appears.

type MysteryPoolEntry = {
  id: string;
  outcome_type: string;
  multiplier_value: number | null;
  flat_beans_value: number | null;
  voucher_template_id: string | null;
  weight: number;
  min_tier: string | null;
  birthday_month_boost: boolean;
  label: string;
  reveal_emoji: string | null;
};

const TIER_RANK: Record<string, number> = {
  bronze: 1, silver: 2, gold: 3, elite: 4,
  "arba-staff": 5, "black-card": 5,
};
const MYSTERY_VOUCHER_WIN_CAP = 3;
const MYSTERY_VOUCHER_WINDOW_DAYS = 7;

async function spawnMysteryDrop(args: {
  memberId: string;
  orderId: string;
  memberTierSlug: string | null;
  birthdayMonth: number | null;
}): Promise<string | null> {
  try {
    const { data: poolRaw } = await supabase
      .from("mystery_pool")
      .select("id, outcome_type, multiplier_value, flat_beans_value, voucher_template_id, weight, min_tier, birthday_month_boost, label, reveal_emoji")
      .eq("brand_id", BRAND_ID)
      .eq("is_active", true);
    const pool = (poolRaw ?? []) as MysteryPoolEntry[];
    if (pool.length === 0) return null;

    // Tier-gate by rank — higher tiers see everything available to
    // lower tiers, not just exact-match outcomes.
    const memberRank = args.memberTierSlug ? (TIER_RANK[args.memberTierSlug] ?? 1) : 1;
    const eligible = pool.filter((e) => {
      if (!e.min_tier) return true;
      const need = TIER_RANK[e.min_tier] ?? 99;
      return memberRank >= need;
    });
    if (eligible.length === 0) return null;

    // Birthday boost — double weight when birthday_month_boost AND
    // birthday month matches current month.
    const currentMonth = new Date().getMonth() + 1;
    const birthdayBoost = args.birthdayMonth !== null && args.birthdayMonth === currentMonth;
    const weights = eligible.map((e) =>
      e.birthday_month_boost && birthdayBoost ? e.weight * 2 : e.weight,
    );
    const totalWeight = weights.reduce((a, b) => a + b, 0);
    if (totalWeight === 0) return null;

    // Weighted random pick.
    let r = Math.random() * totalWeight;
    let pick: MysteryPoolEntry = eligible[0];
    for (let i = 0; i < eligible.length; i++) {
      r -= weights[i];
      if (r <= 0) { pick = eligible[i]; break; }
    }

    // Per-member voucher cap — heavy users / testers get throttled
    // to "no_bonus" instead of unlimited voucher wins.
    if (pick.outcome_type === "voucher") {
      const windowStart = new Date(
        Date.now() - MYSTERY_VOUCHER_WINDOW_DAYS * 86_400_000,
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
        member_id:          args.memberId,
        order_id:           args.orderId,
        pool_entry_id:      pick.id,
        outcome_type:       pick.outcome_type,
        multiplier_applied: pick.outcome_type === "beans_multiplier" ? pick.multiplier_value : null,
        beans_awarded:      pick.outcome_type === "flat_beans" ? pick.flat_beans_value : null,
        voucher_id:         null, // populated on reveal if voucher outcome
      })
      .select("id")
      .single();

    if (error || !data) {
      console.warn("[POS earn] mystery drop insert failed:", error?.message);
      return null;
    }
    return data.id as string;
  } catch (e) {
    console.warn("[POS earn] mystery drop spawn error:", e);
    return null;
  }
}

/**
 * POST /api/loyalty/earn
 * Body: { member_id, outlet_id, amount_rm, order_id, order_number }
 *
 * Awards loyalty points based on order total.
 * Points = floor(amount_rm * points_per_rm)
 * Respects daily earning limit from brand settings.
 */
export async function POST(req: NextRequest) {
  try {
    const { member_id, outlet_id, amount_rm, order_id, order_number } = await req.json();

    if (!member_id || !outlet_id || !amount_rm) {
      return NextResponse.json({ error: "member_id, outlet_id, amount_rm required" }, { status: 400 });
    }

    if (amount_rm <= 0) {
      return NextResponse.json({ error: "amount_rm must be positive" }, { status: 400 });
    }

    // Get brand config for points_per_rm and daily limit
    const { data: brand } = await supabase
      .from("brands")
      .select("points_per_rm, daily_earning_limit")
      .eq("id", BRAND_ID)
      .single();

    const pointsPerRm = Number(brand?.points_per_rm ?? 1);
    const dailyLimit = brand?.daily_earning_limit ?? 0; // 0 = unlimited

    // Tier multiplier — read the member's current tier and multiply
    // earned points by its multiplier (Bronze 1×, Gold 1.5×, Platinum
    // 2× …). Falls back to 1× if no tier is set on the member.
    const { data: mbForTier } = await supabase
      .from("member_brands")
      .select("current_tier_id")
      .eq("member_id", member_id)
      .eq("brand_id", BRAND_ID)
      .maybeSingle();
    let tierMultiplier = 1;
    if (mbForTier?.current_tier_id) {
      const { data: tierRow } = await supabase
        .from("tiers")
        .select("multiplier")
        .eq("id", mbForTier.current_tier_id)
        .maybeSingle();
      if (tierRow?.multiplier) tierMultiplier = Number(tierRow.multiplier);
    }

    // Calculate points to award (round once, after multiplier, so the
    // member doesn't lose fractions of a Bean on each tier-up).
    const points = Math.floor(amount_rm * pointsPerRm * tierMultiplier);
    if (points <= 0) {
      return NextResponse.json({ success: true, points_earned: 0, reason: "Order too small" });
    }

    // Check daily earning limit
    if (dailyLimit > 0) {
      const todayStart = new Date();
      todayStart.setHours(0, 0, 0, 0);

      const { count } = await supabase
        .from("point_transactions")
        .select("*", { count: "exact", head: true })
        .eq("member_id", member_id)
        .eq("brand_id", BRAND_ID)
        .eq("type", "earn")
        .gte("created_at", todayStart.toISOString());

      if (count !== null && count >= dailyLimit) {
        return NextResponse.json({
          success: true,
          points_earned: 0,
          reason: "Daily earning limit reached",
        });
      }
    }

    // Get current member_brands record
    const { data: mb, error: mbErr } = await supabase
      .from("member_brands")
      .select("*")
      .eq("member_id", member_id)
      .eq("brand_id", BRAND_ID)
      .single();

    if (mbErr || !mb) {
      return NextResponse.json({ error: "Member not found for this brand" }, { status: 404 });
    }

    const newBalance = mb.points_balance + points;

    // Update balance (optimistic concurrency)
    const { data: updated, error: updateErr } = await supabase
      .from("member_brands")
      .update({
        points_balance: newBalance,
        total_points_earned: mb.total_points_earned + points,
        total_visits: mb.total_visits + 1,
        total_spent: mb.total_spent + amount_rm,
        last_visit_at: new Date().toISOString(),
      })
      .eq("id", mb.id)
      .eq("points_balance", mb.points_balance) // optimistic lock
      .select()
      .single();

    if (updateErr || !updated) {
      // Retry once on concurrency conflict
      const { data: mb2 } = await supabase
        .from("member_brands")
        .select("*")
        .eq("member_id", member_id)
        .eq("brand_id", BRAND_ID)
        .single();

      if (!mb2) return NextResponse.json({ error: "Concurrency error" }, { status: 409 });

      const newBalance2 = mb2.points_balance + points;
      await supabase
        .from("member_brands")
        .update({
          points_balance: newBalance2,
          total_points_earned: mb2.total_points_earned + points,
          total_visits: mb2.total_visits + 1,
          total_spent: mb2.total_spent + amount_rm,
          last_visit_at: new Date().toISOString(),
        })
        .eq("id", mb2.id);
    }

    // Update preferred outlet
    await supabase
      .from("members")
      .update({ preferred_outlet_id: outlet_id })
      .eq("id", member_id);

    // Create audit trail
    const txnId = `txn-pos-${Date.now()}-${Math.floor(Math.random() * 9000 + 1000)}`;
    await supabase.from("point_transactions").insert({
      id: txnId,
      member_id,
      brand_id: BRAND_ID,
      outlet_id,
      type: "earn",
      points,
      balance_after: (updated ? newBalance : (mb.points_balance + points)),
      description: `POS Order ${order_number ?? order_id ?? ""}${tierMultiplier !== 1 ? ` (${tierMultiplier}× tier)` : ""}`.trim(),
      reference_id: order_id || null,
      multiplier: tierMultiplier,
    });

    // Mystery drop — fire on every paid order so the customer's Thank
    // You screen can surface a tap-to-reveal MysteryBox. We need the
    // member's tier slug (for the tier-rank gate) and birthday month
    // (for the boost). Best-effort: if either query fails the drop
    // still spawns (just without the boost / gate).
    let memberTierSlug: string | null = null;
    if (mbForTier?.current_tier_id) {
      const { data: t } = await supabase
        .from("tiers")
        .select("slug")
        .eq("id", mbForTier.current_tier_id)
        .maybeSingle();
      memberTierSlug = (t?.slug as string | null) ?? null;
    }
    let birthdayMonth: number | null = null;
    try {
      const { data: m } = await supabase
        .from("members")
        .select("birthday_date")
        .eq("id", member_id)
        .maybeSingle();
      const bd = m?.birthday_date as string | null | undefined;
      if (bd) {
        const parsed = new Date(bd);
        if (!isNaN(parsed.getTime())) birthdayMonth = parsed.getMonth() + 1;
      }
    } catch { /* no member birthday — skip boost */ }

    // Await so the customer-display's snapshot poll on status=complete
    // sees the new drop. The register flow awaits the whole /earn
    // before broadcasting status=complete, so this ~50ms insert lands
    // before the customer-display refetches.
    const dropId = order_id
      ? await spawnMysteryDrop({
          memberId: member_id,
          orderId: order_id,
          memberTierSlug,
          birthdayMonth,
        })
      : null;

    return NextResponse.json({
      success: true,
      points_earned: points,
      new_balance: updated ? newBalance : (mb.points_balance + points),
      tier_multiplier: tierMultiplier,
      mystery_drop_id: dropId,
    });
  } catch (err) {
    console.error("[LOYALTY] Earn points error:", err);
    return NextResponse.json({ error: "Failed to award points" }, { status: 500 });
  }
}
