import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/loyalty/supabase";
import { requireAuth } from "@/lib/auth";

const BRAND_ID = "brand-celsius";

/**
 * GET /api/loyalty/members/[id]/detail
 *
 * Customer-360 payload for the Members drawer: identity + brand stats, plus
 * the member's recent orders (pickup `orders` by loyalty_id + counter
 * `pos_orders` by loyalty_phone, merged), points ledger, and redemptions.
 * Read-only, service-role (RLS-bypass), capped per source.
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const auth = await requireAuth(request);
  if (auth.error) return auth.error;

  const { id: memberId } = await params;

  const { data: member } = await supabaseAdmin
    .from("members")
    .select("id, phone, name, email, birthday, tags, created_at")
    .eq("id", memberId)
    .maybeSingle<{ id: string; phone: string; name: string | null; email: string | null; birthday: string | null; tags: string[] | null; created_at: string }>();

  if (!member) {
    return NextResponse.json({ error: "Member not found" }, { status: 404 });
  }

  const phone = member.phone ?? "";

  const [mbRes, pickupRes, posRes, ledgerRes, redemptionRes] = await Promise.all([
    supabaseAdmin
      .from("member_brands")
      .select("points_balance, total_spent, total_visits, current_tier_id, tier_evaluated_at, tier_locked_until, last_visit_at, joined_at")
      .eq("member_id", memberId)
      .eq("brand_id", BRAND_ID)
      .maybeSingle(),
    supabaseAdmin
      .from("orders")
      .select("id, order_number, total, sst_amount, status, created_at, order_type")
      .eq("loyalty_id", memberId)
      .order("created_at", { ascending: false })
      .limit(15),
    phone
      ? supabaseAdmin
          .from("pos_orders")
          .select("id, order_number, total, sst_amount, status, created_at, order_type")
          .eq("loyalty_phone", phone)
          .order("created_at", { ascending: false })
          .limit(15)
      : Promise.resolve({ data: [] as Record<string, unknown>[] }),
    supabaseAdmin
      .from("point_transactions")
      .select("id, type, points, balance_after, description, created_at")
      .eq("member_id", memberId)
      .eq("brand_id", BRAND_ID)
      .order("created_at", { ascending: false })
      .limit(20),
    supabaseAdmin
      .from("redemptions")
      .select("id, reward_id, points_spent, status, code, created_at")
      .eq("member_id", memberId)
      .eq("brand_id", BRAND_ID)
      .order("created_at", { ascending: false })
      .limit(10),
  ]);

  const orders = [
    ...((pickupRes.data ?? []) as Record<string, unknown>[]).map((o) => ({ ...o, source: "Pickup" })),
    ...((posRes.data ?? []) as Record<string, unknown>[]).map((o) => ({ ...o, source: "Counter" })),
  ]
    .sort((a, b) => (String((a as { created_at?: string }).created_at) < String((b as { created_at?: string }).created_at) ? 1 : -1))
    .slice(0, 20);

  return NextResponse.json({
    member,
    brand: mbRes.data ?? null,
    orders,
    ledger: ledgerRes.data ?? [],
    redemptions: redemptionRes.data ?? [],
  });
}
