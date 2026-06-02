import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/pickup/supabase";
import { requireAuth } from "@/lib/auth";

// pos_orders.outlet_id ("outlet-sa") → the orders.store_id slug
// ("shah-alam") the detail page renders. Mirrors the list endpoint.
const OUTLET_ID_TO_SLUG: Record<string, string> = {
  "outlet-sa": "shah-alam",
  "outlet-con": "conezion",
  "outlet-tam": "tamarind",
  "outlet-nilai": "nilai",
};

// GET /api/pickup/orders/[id]
// Returns one order + its line items for the admin detail page. Looks in
// the customer-app `orders` table first; falls back to `pos_orders`
// (in-store / Grab) — normalised to the same {order, items} shape + a
// `channel` field — so every channel's orders are openable. Service-role
// backed so anon SELECT can stay revoked.
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const auth = await requireAuth(request);
  if (auth.error) return auth.error;

  try {
    const { id } = await params;
    const supabase = getSupabaseAdmin();

    // ── Customer-app order (pickup / web / QR) ──
    const { data: order, error: oErr } = await supabase
      .from("orders")
      .select("*")
      .eq("id", id)
      .maybeSingle();
    if (oErr) return NextResponse.json({ error: oErr.message }, { status: 500 });

    if (order) {
      const { data: items, error: iErr } = await supabase
        .from("order_items")
        .select("*")
        .eq("order_id", id);
      if (iErr) return NextResponse.json({ error: iErr.message }, { status: 500 });
      return NextResponse.json({ order: { ...order, channel: "pickup" }, items: items ?? [] });
    }

    // ── Register order (in-store / Grab) ──
    const { data: pos, error: pErr } = await supabase
      .from("pos_orders")
      .select(
        "id, order_number, outlet_id, source, order_type, status, customer_name, customer_phone, subtotal, discount_amount, sst_amount, service_charge, total, notes, created_at",
      )
      .eq("id", id)
      .maybeSingle();
    if (pErr) return NextResponse.json({ error: pErr.message }, { status: 500 });
    if (!pos) return NextResponse.json({ error: "Order not found" }, { status: 404 });

    const { data: posItems, error: piErr } = await supabase
      .from("pos_order_items")
      .select("id, product_name, quantity, item_total")
      .eq("order_id", id);
    if (piErr) return NextResponse.json({ error: piErr.message }, { status: 500 });

    const src = (pos.source as string) ?? "pos";
    const normalisedOrder = {
      id: pos.id,
      order_number: pos.order_number,
      store_id: OUTLET_ID_TO_SLUG[pos.outlet_id as string] ?? pos.outlet_id,
      status: pos.status,
      payment_method: "",
      payment_provider_ref: null,
      subtotal: pos.subtotal ?? 0,
      discount_amount: pos.discount_amount ?? 0,
      voucher_code: null,
      reward_discount_amount: 0,
      first_order_discount_amount: 0,
      reward_id: null,
      reward_name: null,
      sst_amount: pos.sst_amount ?? 0,
      total: pos.total ?? 0,
      customer_name: pos.customer_name ?? null,
      customer_phone: pos.customer_phone ?? null,
      loyalty_phone: null,
      loyalty_id: null,
      loyalty_points_earned: 0,
      notes: pos.notes ?? null,
      created_at: pos.created_at,
      updated_at: pos.created_at,
      channel: src === "grabfood" ? "grab" : src,
    };
    const normalisedItems = (posItems ?? []).map((it) => ({
      id: it.id,
      product_name: it.product_name ?? "",
      variant_name: null,
      quantity: it.quantity ?? 0,
      unit_price: 0,
      item_total: it.item_total ?? 0,
      modifiers: null,
    }));

    return NextResponse.json({ order: normalisedOrder, items: normalisedItems });
  } catch (err) {
    console.error("Order detail error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
