import { NextRequest, NextResponse } from "next/server";
import { after } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase/server";
import { notifyTierUpgrade } from "@/lib/push/templates";

// .trim() guards against accidental trailing newlines in env var values
const LOYALTY_BASE = (process.env.LOYALTY_BASE_URL ?? "https://loyalty.celsiuscoffee.com").trim();
const BRAND_ID     = (process.env.LOYALTY_BRAND_ID  ?? "brand-celsius").trim();

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

// GET /api/loyalty/member-tier?member_id=xxx
// Proxies to the loyalty app's /api/member-tier so the pickup app can
// surface the tier badge, multiplier, and progress-to-next-tier.
//
// Side effect: when the response shows the customer is now at a
// HIGHER tier than they were before the proxy call (the RPC updates
// current_tier_id atomically inside the loyalty app), fire a
// tier-upgrade push. Fire-and-forget — a push miss never fails the
// API call.
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

    const res = await fetch(
      `${LOYALTY_BASE}/api/member-tier?member_id=${encodeURIComponent(memberId)}&brand_id=${BRAND_ID}`,
      { headers: { "Content-Type": "application/json" } }
    );
    const data = await res.json();
    if (!res.ok) {
      return NextResponse.json(data, { status: res.status });
    }

    // Tier-upgrade detection. Compare sort_order so we only push on
    // a real promotion (not a same-tier re-evaluation, not a demote).
    const newTierId   = (data as { tier_id?: string | null }).tier_id ?? null;
    const newTierName = (data as { tier_name?: string | null }).tier_name ?? null;
    const newTierMul  = Number((data as { tier_multiplier?: number | null }).tier_multiplier ?? 1);

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
