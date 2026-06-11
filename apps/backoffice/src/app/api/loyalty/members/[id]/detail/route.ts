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

  // ── Purchase history ──────────────────────────────────────────────────
  // Line items for this member's orders. We only fetch items for the orders
  // pulled above (capped per source), so this stays bounded. order_items +
  // pos_order_items both carry product_name/quantity/item_total, so no join
  // to a products table is needed. Aggregate into a top-products ranking
  // (by quantity) and a flat recent-items list for the drawer.
  const pickupOrderIds = ((pickupRes.data ?? []) as { id: string }[]).map((o) => o.id);
  const posOrderIds = ((posRes.data ?? []) as { id: string }[]).map((o) => o.id);

  const [pickupItemsRes, posItemsRes] = await Promise.all([
    pickupOrderIds.length
      ? supabaseAdmin
          .from("order_items")
          .select("order_id, product_id, product_name, variant_name, quantity, item_total, created_at")
          .in("order_id", pickupOrderIds)
      : Promise.resolve({ data: [] as Record<string, unknown>[] }),
    posOrderIds.length
      ? supabaseAdmin
          .from("pos_order_items")
          .select("order_id, product_id, product_name, variant_name, quantity, item_total, created_at")
          .in("order_id", posOrderIds)
      : Promise.resolve({ data: [] as Record<string, unknown>[] }),
  ]);

  type RawItem = { product_id: string | null; product_name: string | null; variant_name: string | null; quantity: number | null; item_total: number | null; created_at: string | null };
  const allItems: RawItem[] = [
    ...((pickupItemsRes.data ?? []) as RawItem[]),
    ...((posItemsRes.data ?? []) as RawItem[]),
  ];

  // Top products by total quantity (then spend), keyed by product_id (falling
  // back to name for legacy rows with no id).
  const productAgg = new Map<string, { product_id: string | null; product_name: string; quantity: number; spend: number }>();
  for (const it of allItems) {
    const key = it.product_id ?? `name:${it.product_name ?? "Unknown"}`;
    const prev = productAgg.get(key) ?? { product_id: it.product_id ?? null, product_name: it.product_name ?? "Unknown", quantity: 0, spend: 0 };
    prev.quantity += it.quantity ?? 0;
    prev.spend += it.item_total ?? 0;
    productAgg.set(key, prev);
  }
  const topProducts = [...productAgg.values()]
    .sort((a, b) => b.quantity - a.quantity || b.spend - a.spend)
    .slice(0, 12);

  const recentItems = allItems
    .filter((it) => it.created_at)
    .sort((a, b) => (String(a.created_at) < String(b.created_at) ? 1 : -1))
    .slice(0, 20)
    .map((it) => ({
      product_name: it.product_name ?? "Unknown",
      variant_name: it.variant_name ?? null,
      quantity: it.quantity ?? 0,
      item_total: it.item_total ?? 0,
      created_at: it.created_at,
    }));

  return NextResponse.json({
    member,
    brand: mbRes.data ?? null,
    orders,
    ledger: ledgerRes.data ?? [],
    redemptions: redemptionRes.data ?? [],
    purchaseHistory: { topProducts, recentItems, totalItems: allItems.length },
  });
}
