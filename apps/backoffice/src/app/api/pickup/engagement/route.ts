import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/loyalty/supabase";
import { requireAuth } from "@/lib/auth";

// GET /api/pickup/engagement?range=7d|30d|90d
//
// Aggregates engagement metrics for the pickup app from existing tables
// (we don't have App Store / Play Console / Amplitude wired into the
// backoffice yet). Acquisition is approximated from member-with-order
// counts since the members table doesn't store a signup-source.
//
// Response shape:
// {
//   range, sinceIso,
//   acquisition: { newMembersByDay: [{date, count}], totalNew, totalActive, repeatRate, avgOrdersPerActive },
//   activity:    { dauByDay: [{date, count}], dauMauRatio, mau, wau, dau },
//   cohorts:     { weeks: [{label, size, retention: [pct, pct, pct, pct]}] },  // 8 most recent weeks
//   tiers:       [{ tier, count, pct }],
//   rewards:     { issued, used, expired, active, redemptionRate, byReward: [{ name, issued, used, redeemed }] }
// }

const RANGE_DAYS: Record<string, number> = { "7d": 7, "30d": 30, "90d": 90 };

const BRAND_ID = "brand-celsius";

function isoDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

function startOfDay(d: Date): Date {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x;
}

function startOfIsoWeek(d: Date): Date {
  const x = startOfDay(d);
  const day = x.getDay();
  const offset = (day + 6) % 7; // Monday = 0
  x.setDate(x.getDate() - offset);
  return x;
}

export async function GET(request: NextRequest) {
  const auth = await requireAuth(request);
  if (auth.error) return auth.error;

  const { searchParams } = new URL(request.url);
  const range = searchParams.get("range") ?? "30d";
  const days = RANGE_DAYS[range] ?? 30;

  const now = new Date();
  const since = new Date(now);
  since.setDate(since.getDate() - days + 1);
  since.setHours(0, 0, 0, 0);

  try {
    // ── Acquisition / activity ────────────────────────────────
    // Pull every order with a loyalty_id in the range. That's our
    // working set for "active app members during the period".
    // For the cohort retention table we need first-order dates further
    // back, so we ALSO pull all orders for members who have an order
    // in the cohort window (8 weeks). Those two queries are kept
    // separate for clarity and to bound payload size.

    const cohortWindow = new Date(now);
    cohortWindow.setDate(cohortWindow.getDate() - 8 * 7);
    cohortWindow.setHours(0, 0, 0, 0);

    const [
      { data: rangeOrders },
      { data: cohortOrders },
      { data: allMemberBrands },
      { data: tierCatalog },
      { data: rewardsCatalog },
      { data: issuedSinceCount },
      { data: usedSinceCount },
      { data: issuedAllTime },
      { data: redemptionsRange },
    ] = await Promise.all([
      // Range-bound orders for DAU / repeat-rate / acquisition charts
      supabaseAdmin
        .from("orders")
        .select("id, loyalty_id, created_at, total")
        .gte("created_at", since.toISOString())
        .not("status", "in", "(pending,failed)")
        .not("loyalty_id", "is", null),

      // 8-week cohort window — only id + loyalty_id + created_at
      supabaseAdmin
        .from("orders")
        .select("loyalty_id, created_at")
        .gte("created_at", cohortWindow.toISOString())
        .not("status", "in", "(pending,failed)")
        .not("loyalty_id", "is", null),

      // Tier distribution snapshot — current state, not range-bound.
      supabaseAdmin
        .from("member_brands")
        .select("member_id, current_tier_id")
        .eq("brand_id", BRAND_ID),

      // Tier catalog for nice labels.
      supabaseAdmin
        .from("tiers")
        .select("id, name, slug, sort_order")
        .eq("brand_id", BRAND_ID)
        .order("sort_order", { ascending: true }),

      // Reward catalog for the per-reward breakdown.
      supabaseAdmin
        .from("rewards")
        .select("id, name, reward_type, auto_issue")
        .eq("brand_id", BRAND_ID)
        .eq("is_active", true),

      // Range-bound issued voucher counts (per reward).
      supabaseAdmin
        .from("issued_rewards")
        .select("reward_id, status")
        .eq("brand_id", BRAND_ID)
        .gte("issued_at", since.toISOString()),

      // Range-bound used voucher counts (separate query so we can match
      // by status update). Using the same issued_at window keeps the
      // funnel consistent — "vouchers issued in this period and what
      // happened to them since".
      supabaseAdmin
        .from("issued_rewards")
        .select("reward_id")
        .eq("brand_id", BRAND_ID)
        .eq("status", "used")
        .gte("issued_at", since.toISOString()),

      // All-time issued counts for the lifetime metrics.
      supabaseAdmin
        .from("issued_rewards")
        .select("status")
        .eq("brand_id", BRAND_ID),

      // Range-bound redemptions (any reward) for redemption funnel.
      supabaseAdmin
        .from("redemptions")
        .select("reward_id, member_id, created_at")
        .eq("brand_id", BRAND_ID)
        .gte("created_at", since.toISOString()),
    ]);

    type OrderLite = {
      id?: string;
      loyalty_id: string;
      created_at: string;
      total?: number;
    };
    const rOrders = (rangeOrders ?? []) as OrderLite[];
    const cOrders = (cohortOrders ?? []) as OrderLite[];

    // ── Build daily acquisition + DAU series ──────────────────
    // First-time appearance (per member) drives the new-members curve.
    // It approximates "first pickup-app order date" since we don't
    // track signup source on members.
    const memberFirstSeen = new Map<string, string>(); // member -> earliest created_at iso date
    for (const o of cOrders) {
      const d = isoDate(new Date(o.created_at));
      const cur = memberFirstSeen.get(o.loyalty_id);
      if (!cur || d < cur) memberFirstSeen.set(o.loyalty_id, d);
    }

    const dailyMap = new Map<string, { date: string; new: number; active: number }>();
    for (let i = 0; i < days; i++) {
      const d = new Date(now);
      d.setDate(d.getDate() - days + 1 + i);
      const k = isoDate(d);
      dailyMap.set(k, { date: k, new: 0, active: 0 });
    }
    const activeMembersInRange = new Set<string>();
    const ordersByMember = new Map<string, number>();
    for (const o of rOrders) {
      const k = isoDate(new Date(o.created_at));
      if (dailyMap.has(k)) {
        dailyMap.get(k)!.active += 1;
      }
      activeMembersInRange.add(o.loyalty_id);
      ordersByMember.set(o.loyalty_id, (ordersByMember.get(o.loyalty_id) ?? 0) + 1);
    }
    for (const [mid, fseen] of memberFirstSeen) {
      if (dailyMap.has(fseen) && new Date(fseen) >= since) {
        dailyMap.get(fseen)!.new += 1;
      }
      // Reference mid to satisfy the no-unused-vars convention without
      // changing semantics.
      void mid;
    }

    const dailySeries = Array.from(dailyMap.values());
    const totalNew = dailySeries.reduce((s, d) => s + d.new, 0);
    const totalActive = activeMembersInRange.size;
    let repeatCount = 0;
    let totalOrdersInRange = 0;
    for (const c of ordersByMember.values()) {
      totalOrdersInRange += c;
      if (c >= 2) repeatCount += 1;
    }
    const repeatRate = totalActive > 0 ? repeatCount / totalActive : 0;
    const avgOrdersPerActive = totalActive > 0 ? totalOrdersInRange / totalActive : 0;

    // ── DAU/WAU/MAU on the most recent calendar windows ──────
    // We compute these against rOrders so they're always within the
    // selected range. dauMauRatio uses a 30-day window if range >= 30,
    // else falls back to range size for both numerator and denominator.
    function uniqueMembersInLastDays(n: number): number {
      const cutoff = new Date(now);
      cutoff.setDate(cutoff.getDate() - n);
      const set = new Set<string>();
      for (const o of rOrders) {
        if (new Date(o.created_at) >= cutoff) set.add(o.loyalty_id);
      }
      return set.size;
    }
    const dau = uniqueMembersInLastDays(1);
    const wau = uniqueMembersInLastDays(7);
    const mau = uniqueMembersInLastDays(Math.min(30, days));
    const dauMauRatio = mau > 0 ? dau / mau : 0;

    // ── Cohort retention (last 8 weeks) ───────────────────────
    // Cohort = the iso-week of a member's first observed order in the
    // window. retention[i] = % of cohort members who placed any order
    // in week (cohortStart + i+1).
    const memberFirstWeek = new Map<string, string>();
    for (const [mid, fseen] of memberFirstSeen) {
      const wk = isoDate(startOfIsoWeek(new Date(fseen)));
      memberFirstWeek.set(mid, wk);
    }
    // Build weekly buckets
    const cohorts = new Map<string, Set<string>>();
    for (const [mid, wk] of memberFirstWeek) {
      if (!cohorts.has(wk)) cohorts.set(wk, new Set());
      cohorts.get(wk)!.add(mid);
    }
    // Per (cohort, week-offset) seen members
    const seenInWeek = new Map<string, Set<string>>(); // key: `${cohortWk}::${offset}`
    for (const o of cOrders) {
      const orderWk = isoDate(startOfIsoWeek(new Date(o.created_at)));
      const cohortWk = memberFirstWeek.get(o.loyalty_id);
      if (!cohortWk) continue;
      const offset = Math.round(
        (new Date(orderWk).getTime() - new Date(cohortWk).getTime()) / (7 * 24 * 60 * 60 * 1000),
      );
      if (offset <= 0 || offset > 4) continue;
      const key = `${cohortWk}::${offset}`;
      if (!seenInWeek.has(key)) seenInWeek.set(key, new Set());
      seenInWeek.get(key)!.add(o.loyalty_id);
    }
    const cohortWeeks = Array.from(cohorts.keys())
      .sort()
      .slice(-8)
      .map((wk) => {
        const cohortMembers = cohorts.get(wk)!;
        const size = cohortMembers.size;
        const retention = [1, 2, 3, 4].map((offset) => {
          const seen = seenInWeek.get(`${wk}::${offset}`)?.size ?? 0;
          return size > 0 ? seen / size : 0;
        });
        return { label: wk, size, retention };
      });

    // ── Tier distribution snapshot ────────────────────────────
    type MB = { member_id: string; current_tier_id: string | null };
    const mbs = (allMemberBrands ?? []) as MB[];
    const tcat = (tierCatalog ?? []) as { id: string; name: string; slug: string; sort_order: number | null }[];
    const tierMap = new Map(tcat.map((t) => [t.id, t]));
    const tierCounts = new Map<string, number>();
    let untiered = 0;
    for (const mb of mbs) {
      const t = mb.current_tier_id ? tierMap.get(mb.current_tier_id) : null;
      if (!t) {
        untiered += 1;
        continue;
      }
      tierCounts.set(t.id, (tierCounts.get(t.id) ?? 0) + 1);
    }
    const tierTotal = mbs.length;
    const tierDistribution = tcat.map((t) => {
      const c = tierCounts.get(t.id) ?? 0;
      return {
        tier: t.name,
        slug: t.slug,
        count: c,
        pct: tierTotal > 0 ? c / tierTotal : 0,
      };
    });
    if (untiered > 0) {
      tierDistribution.push({
        tier: "Untiered",
        slug: "untiered",
        count: untiered,
        pct: tierTotal > 0 ? untiered / tierTotal : 0,
      });
    }

    // ── Reward engagement ─────────────────────────────────────
    type IR = { reward_id: string; status?: string };
    const issuedRows = (issuedSinceCount ?? []) as IR[];
    const usedRowsRange = (usedSinceCount ?? []) as IR[];
    const issuedAll = (issuedAllTime ?? []) as { status: string }[];
    const redemptions = (redemptionsRange ?? []) as { reward_id: string; member_id: string; created_at: string }[];

    const lifetimeIssued = issuedAll.length;
    const lifetimeUsed = issuedAll.filter((r) => r.status === "used").length;
    const lifetimeActive = issuedAll.filter((r) => r.status === "active").length;
    const lifetimeExpired = issuedAll.filter((r) => r.status === "expired").length;

    const rcat = (rewardsCatalog ?? []) as { id: string; name: string; reward_type: string; auto_issue: boolean }[];
    const rewardMap = new Map(rcat.map((r) => [r.id, r]));
    const issuedByReward = new Map<string, number>();
    const usedByReward = new Map<string, number>();
    const redeemedByReward = new Map<string, number>();
    for (const r of issuedRows) issuedByReward.set(r.reward_id, (issuedByReward.get(r.reward_id) ?? 0) + 1);
    for (const r of usedRowsRange) usedByReward.set(r.reward_id, (usedByReward.get(r.reward_id) ?? 0) + 1);
    for (const r of redemptions) redeemedByReward.set(r.reward_id, (redeemedByReward.get(r.reward_id) ?? 0) + 1);

    const allRewardIds = new Set<string>([
      ...issuedByReward.keys(),
      ...redeemedByReward.keys(),
    ]);
    const byReward = Array.from(allRewardIds)
      .map((id) => {
        const r = rewardMap.get(id);
        return {
          rewardId: id,
          name: r?.name ?? id,
          rewardType: r?.reward_type ?? "unknown",
          autoIssue: r?.auto_issue ?? false,
          issued: issuedByReward.get(id) ?? 0,
          used: usedByReward.get(id) ?? 0,
          redeemed: redeemedByReward.get(id) ?? 0,
        };
      })
      .sort((a, b) => (b.issued + b.redeemed) - (a.issued + a.redeemed));

    return NextResponse.json({
      range,
      sinceIso: since.toISOString(),
      acquisition: {
        newMembersByDay: dailySeries,
        totalNew,
        totalActive,
        repeatRate,
        avgOrdersPerActive,
        totalOrdersInRange,
      },
      activity: {
        dau,
        wau,
        mau,
        dauMauRatio,
      },
      cohorts: {
        weeks: cohortWeeks,
      },
      tiers: tierDistribution,
      rewards: {
        lifetimeIssued,
        lifetimeUsed,
        lifetimeActive,
        lifetimeExpired,
        rangeIssued: issuedRows.length,
        rangeUsed: usedRowsRange.length,
        rangeRedemptions: redemptions.length,
        redemptionRate: lifetimeIssued > 0 ? lifetimeUsed / lifetimeIssued : 0,
        byReward,
      },
    });
  } catch (err) {
    console.error("[pickup engagement]", err);
    return NextResponse.json({ error: "Failed to compute engagement" }, { status: 500 });
  }
}
