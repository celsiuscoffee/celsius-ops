import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/loyalty/supabase";
import { requireAuth } from "@/lib/auth";

/**
 * GET /api/loyalty/members/purchased-products
 *
 * Distinct products that have ever been sold, aggregated across pickup
 * `order_items` and counter `pos_order_items`. Feeds the "purchased product"
 * filter dropdown on the Members page — we list only products customers have
 * actually bought (not the full catalogue), so the segment options map 1:1 to
 * what `purchased_product_ids` on each member can match.
 *
 * Returns: { products: { id, name, units, orders }[] } sorted by units desc.
 * Read-only, service-role. Order/item volume is small (native POS history is
 * still young), so a full scan + in-memory aggregate is cheap.
 */
export async function GET(request: NextRequest) {
  const auth = await requireAuth(request);
  if (auth.error) return auth.error;

  const [pickupRes, posRes] = await Promise.all([
    supabaseAdmin.from("order_items").select("product_id, product_name, quantity, order_id"),
    supabaseAdmin.from("pos_order_items").select("product_id, product_name, quantity, order_id"),
  ]);

  type RawItem = { product_id: string | null; product_name: string | null; quantity: number | null; order_id: string | null };
  const rows: RawItem[] = [
    ...((pickupRes.data ?? []) as RawItem[]),
    ...((posRes.data ?? []) as RawItem[]),
  ];

  // Key by product_id, falling back to name for legacy rows with no id, so a
  // product without an id still produces a stable, matchable option.
  const agg = new Map<string, { id: string; name: string; units: number; orders: Set<string> }>();
  for (const r of rows) {
    const id = r.product_id ?? `name:${r.product_name ?? "Unknown"}`;
    const prev = agg.get(id) ?? { id, name: r.product_name ?? "Unknown", units: 0, orders: new Set<string>() };
    prev.units += r.quantity ?? 0;
    if (r.order_id) prev.orders.add(r.order_id);
    agg.set(id, prev);
  }

  const products = [...agg.values()]
    .map((p) => ({ id: p.id, name: p.name, units: p.units, orders: p.orders.size }))
    .sort((a, b) => b.units - a.units || a.name.localeCompare(b.name));

  return NextResponse.json(
    { products },
    { headers: { "Cache-Control": "private, max-age=300" } },
  );
}
