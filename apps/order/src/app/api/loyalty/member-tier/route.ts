import { NextRequest, NextResponse } from "next/server";
import { after } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase/server";
import { notifyTierUpgrade } from "@/lib/push/templates";

// .trim() guards against accidental trailing newlines in env var values
const BRAND_ID = (process.env.LOYALTY_BRAND_ID ?? "brand-celsius").trim();

// Sort order matters for "is the new tier HIGHER than the old one?".
// The loyalty RPC walks tiers by sort_order, so we mirror that here
// to avoid firing the upgrade push on a tier-DOWN (e.g. a customer
// rolls out of the trailing 90-day window).
async function fetchTierSortOrder(tierId: string | null): Promise<number> {
  if (!tierId) return 0;
  try {
    const supabase = getSupabaseAdmin();
    const { data } = await supabase
      .from("tiers")
      .select("sort_order")
      .eq("id", tierId)
      .maybeSingle();
    return (data as { sort_order?: number } | null)?.sort_order ?? 0;
  } catch {
    return 0;
  }
}

// Native port of the loyalty app's GET /api/member-tier — runs the
// evaluate_member_tier RPC (which updates member_brands.current_tier_id) and
// attaches the active post-purchase issued reward, reading the SAME shared
// Supabase the loyalty app uses. Part of retiring the loyalty app: removes the
// proxy hop to loyalty.celsiuscoffee.com. The order app already calls this exact
// RPC elsewhere (lib/loyalty/points.ts), so no new infra is involved.
async function evaluateMemberTierNative(memberId: string, brandId: string): Promise<Record<string, unknown>> {
  const supabase = getSupabaseAdmin();

  const { data: tierData, error: tierError } = await supabase.rpc("evaluate_member_tier", {
    p_member_id: memberId,
    p_brand_id: brandId,
  });
  if (tierError) throw new Error(`evaluate_member_tier: ${tierError.message}`);
  const tier = (tierData ?? {}) as Record<string, unknown>;

  // Active post-purchase issued reward (if any) — mirrors the loyalty endpoint.
  const now = new Date().toISOString();
  const { data: issued } = await supabase
    .from("issued_rewards")
    .select("id, expires_at, reward:rewards(name, discount_value)")
    .eq("member_id", memberId)
    .eq("brand_id", brandId)
    .eq("status", "active")
    .eq("rewards.reward_type", "post_purchase")
    .gt("expires_at", now)
    .order("expires_at", { ascending: true })
    .limit(1);

  const coupon = issued?.[0] as
    | { id: string; expires_at: string; reward: { name: string; discount_value: number | null } | null }
    | undefined;
  if (coupon?.reward) {
    const hoursRemaining = Math.max(
      0,
      Math.ceil((new Date(coupon.expires_at).getTime() - Date.now()) / (1000 * 60 * 60)),
    );
    tier.active_post_purchase = {
      id: coupon.id,
      reward_name: coupon.reward.name,
      multiplier: coupon.reward.discount_value ?? 2,
      expires_at: coupon.expires_at,
      hours_remaining: hoursRemaining,
    };
  } else {
    tier.active_post_purchase = null;
  }
  return tier;
}

// GET /api/loyalty/member-tier?member_id=xxx
// Runs the evaluate_member_tier RPC against the shared Supabase so the pickup
// app can surface the tier badge, multiplier, and progress-to-next-tier.
//
// Side effect: when the result shows the customer is now at a HIGHER tier
// than before (the RPC updates current_tier_id atomically), fire a
// tier-upgrade push. Fire-and-forget — a push miss never fails the API call.
export async function GET(request: NextRequest) {
  try {
    const memberId = request.nextUrl.searchParams.get("member_id");
    if (!memberId) {
      return NextResponse.json({ error: "member_id required" }, { status: 400 });
    }

    // Snapshot of the member's current tier BEFORE the proxy call.
    // The loyalty RPC will overwrite current_tier_id atomically.
    const supabase = getSupabaseAdmin();
    const { data: pre } = await supabase
      .from("member_brands")
      .select("current_tier_id, points_balance, total_points_earned")
      .eq("member_id", memberId)
      .eq("brand_id", BRAND_ID)
      .maybeSingle();
    const prevTierId = (pre as { current_tier_id?: string | null } | null)?.current_tier_id ?? null;
    // Live balance + lifetime earned, straight from member_brands — the SAME
    // source POS + native read. The web clients used to render a STALE
    // localStorage snapshot (e.g. 1894 while POS showed 2102); returning the
    // authoritative value here lets the home + account surfaces refresh.
    const liveBalance = (pre as { points_balance?: number | null } | null)?.points_balance ?? null;
    const liveEarned  = (pre as { total_points_earned?: number | null } | null)?.total_points_earned ?? null;

    // Resolve the tier — runs the evaluate_member_tier RPC + post-purchase
    // reward query against the shared Supabase (the same work the retired
    // loyalty app's /api/member-tier did).
    const data = await evaluateMemberTierNative(memberId, BRAND_ID);

    // Tier-upgrade detection. Compare sort_order so we only push on
    // a real promotion (not a same-tier re-evaluation, not a demote).
    const newTierId   = (data.tier_id as string | null | undefined) ?? null;
    const newTierName = (data.tier_name as string | null | undefined) ?? null;
    const newTierMul  = Number((data.tier_multiplier as number | null | undefined) ?? 1);

    if (newTierId && newTierId !== prevTierId && newTierName) {
      const [prevOrder, newOrder] = await Promise.all([
        fetchTierSortOrder(prevTierId),
        fetchTierSortOrder(newTierId),
      ]);
      if (newOrder > prevOrder) {
        // after() keeps the Vercel invocation alive until the Expo
        // fetch finishes — without it, the lambda freezes on response
        // return and the push is silently dropped.
        after(async () => {
          await notifyTierUpgrade({
            memberId,
            newTierName,
            multiplier: newTierMul,
          }).catch((e) => console.warn("[push] tier_upgrade", e));
        });
      }
    }

    return NextResponse.json({
      ...data,
      // Authoritative live values from member_brands (override anything the
      // tier proxy may have returned) so web matches POS + native.
      points_balance: liveBalance,
      total_points_earned: liveEarned,
    });
  } catch (err) {
    console.error("Loyalty member-tier fetch error:", err);
    return NextResponse.json({ error: "Failed to fetch tier" }, { status: 500 });
  }
}
