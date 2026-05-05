import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase/server";

// .trim() guards against accidental trailing newlines in env var values
const LOYALTY_BASE = (process.env.LOYALTY_BASE_URL ?? "https://loyalty.celsiuscoffee.com").trim();
const BRAND_ID     = (process.env.LOYALTY_BRAND_ID  ?? "brand-celsius").trim();

interface LoyaltyReward {
  id: string;
  brand_id: string;
  name: string;
  description: string | null;
  points_required: number;
  category: string;
  stock: number | null;
  is_active: boolean;
  image_url: string | null;
  reward_type: string;
  validity_days: number | null;
  max_redemptions_per_member: number | null;
  auto_issue: boolean;
  discount_type: string | null;
  discount_value: number | null;
  max_discount_value: number | null;
  min_order_value: number | null;
  applicable_products: string[] | null;
  applicable_categories: string[] | null;
  free_product_ids: string[] | null;
  free_product_name: string | null;
  bogo_buy_qty: number;
  bogo_free_qty: number;
  fulfillment_type: string | null;
}

// Normalise phone so +60xxx, 60xxx and 0xxx all work
function normalisePhone(phone: string): string {
  const digits = phone.replace(/\D/g, "");
  if (digits.startsWith("60")) return `+${digits}`;
  if (digits.startsWith("0")) return `+6${digits}`;
  return `+60${digits}`;
}

export async function GET(request: NextRequest) {
  const phone = request.nextUrl.searchParams.get("phone");

  try {
    // Fetch loyalty rewards + our DB configs in parallel
    const [rewardsRes, supabase] = await Promise.all([
      fetch(`${LOYALTY_BASE}/api/rewards?brand_id=${BRAND_ID}`, {
        headers: { "Content-Type": "application/json" }, next: { revalidate: 120 },
      }),
      Promise.resolve(getSupabaseAdmin()),
    ]);

    if (!rewardsRes.ok) {
      return NextResponse.json({ error: "Failed to fetch rewards" }, { status: 502 });
    }
    const allRewards: LoyaltyReward[] = await rewardsRes.json();

    // Load reward configs from DB
    const { data: configs } = await supabase.from("reward_configs").select("*");
    const configMap = new Map((configs ?? []).map((c) => [String(c.reward_id), c]));

    // Filter to only active rewards
    const activeRewards = (Array.isArray(allRewards) ? allRewards : []).filter((r) => r.is_active);

    // Merge config into each reward (config takes priority over name-based heuristics)
    const rewards = activeRewards.map((raw) => {
      const config = configMap.get(String(raw.id));
      if (config) {
        return { ...raw, discount_type: config.discount_type, discount_value: config.discount_value };
      }
      // Fallback heuristic for unconfigured rewards
      const name     = String(raw.name ?? "").trim();
      const category = String(raw.category ?? "").toLowerCase();
      const rmMatch  = name.match(/RM\s*(\d+(?:\.\d+)?)/i);
      if (rmMatch) return { ...raw, discount_type: "flat",      discount_value: Math.round(parseFloat(rmMatch[1]) * 100) };
      if (category === "drink" || name.toLowerCase().includes("free drink") || name.toLowerCase().includes("free coffee"))
        return { ...raw, discount_type: "free_item" };
      const pctMatch = name.match(/(\d+(?:\.\d+)?)\s*%/);
      if (pctMatch) return { ...raw, discount_type: "percent",  discount_value: parseFloat(pctMatch[1]) };
      return { ...raw, discount_type: "none" };
    });

    // No phone — return all rewards without member context
    if (!phone) {
      return NextResponse.json({ memberId: null, pointsBalance: null, rewards });
    }

    // Phone provided — fetch member to get their balance
    const normPhone = normalisePhone(phone);
    const memberRes = await fetch(
      `${LOYALTY_BASE}/api/members?brand_id=${BRAND_ID}&phone=${encodeURIComponent(normPhone)}`,
      { headers: { "Content-Type": "application/json" } }
    );
    const members = await memberRes.json();
    const member = Array.isArray(members) && members.length > 0 ? members[0] : null;

    if (!member) {
      // Member not found — still return all rewards, no balance
      return NextResponse.json({ memberId: null, pointsBalance: null, rewards });
    }

    const brandData = member.brand_data ?? {};
    const pointsBalance: number = brandData.points_balance ?? 0;

    // Hydrate eligibility from our DB rewards table (loyalty service can
    // omit some columns) and attach a per-member redemption count so the
    // client can enforce max_redemptions_per_member without an extra trip.
    const rewardIds = rewards.map((r) => r.id);
    const [{ data: dbRewards }, { data: redemptions }] = await Promise.all([
      supabase
        .from("rewards")
        .select(
          "id, valid_from, valid_until, stock, max_redemptions_per_member, fulfillment_type"
        )
        .in("id", rewardIds),
      supabase
        .from("redemptions")
        .select("reward_id")
        .eq("member_id", member.id)
        .in("reward_id", rewardIds),
    ]);
    const dbMap = new Map((dbRewards ?? []).map((r) => [r.id as string, r]));
    const redemptionCounts = new Map<string, number>();
    for (const r of redemptions ?? []) {
      const k = r.reward_id as string;
      redemptionCounts.set(k, (redemptionCounts.get(k) ?? 0) + 1);
    }

    const rewardsWithEligibility = rewards.map((r) => {
      const db = dbMap.get(r.id) as Record<string, unknown> | undefined;
      return {
        ...r,
        valid_from:                 db?.valid_from ?? null,
        valid_until:                db?.valid_until ?? null,
        stock:                      (db?.stock as number | null) ?? r.stock ?? null,
        max_redemptions_per_member: (db?.max_redemptions_per_member as number | null) ?? r.max_redemptions_per_member ?? null,
        fulfillment_type:           db?.fulfillment_type ?? r.fulfillment_type ?? null,
        redemption_count:           redemptionCounts.get(r.id) ?? 0,
      };
    });

    return NextResponse.json({
      memberId: member.id,
      pointsBalance,
      rewards: rewardsWithEligibility,
    });
  } catch (err) {
    console.error("Loyalty rewards fetch error:", err);
    return NextResponse.json({ error: "Failed to fetch rewards" }, { status: 500 });
  }
}
