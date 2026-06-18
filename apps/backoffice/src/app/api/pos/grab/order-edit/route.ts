import { NextRequest, NextResponse } from "next/server";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { isGrabConfigured, editOrder, type EditOrderItem } from "@/lib/grab";

/**
 * POST /api/pos/grab/order-edit
 * Body: { orderID: string, edits: [{ grabItemId, quantity }], onlyRecalculate?: boolean }
 *
 * Cashier-driven GrabFood order edit from the POS live-orders panel: drop an item
 * (quantity 0) or change its quantity. Builds the full Edit Order V2 payload from
 * the order's stored lines (Grab requires EVERY line, changed or not, keyed by its
 * grabItemID) and applies the requested final quantities, then calls Grab's
 * PUT /partner/v2/orders/{orderID} via editOrder().
 *
 * `onlyRecalculate:true` previews/repricings WITHOUT submitting — always preview
 * before the real submit. Modifier edits / adding replacement items are NOT
 * supported here (delete + quantity only); unchanged modifiers are omitted per
 * the Grab contract.
 *
 * Service-role + CSRF (Origin/Referer enforced by the POS middleware), same trust
 * model as /api/pos/order-status — pos-native has no staff bearer token.
 */
let cachedSupabase: SupabaseClient | null = null;
function getSupabase(): SupabaseClient {
  if (!cachedSupabase) {
    cachedSupabase = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    );
  }
  return cachedSupabase;
}

type StoredItem = { grab_item_id: string | null; quantity: number | null };

export async function POST(req: NextRequest) {
  if (!isGrabConfigured()) {
    return NextResponse.json({ error: "Grab not configured" }, { status: 400 });
  }

  let body: { orderID?: string; edits?: Array<{ grabItemId?: string; quantity?: number }>; onlyRecalculate?: boolean };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid JSON body" }, { status: 400 });
  }

  const orderID = String(body.orderID ?? "").trim();
  if (!orderID) return NextResponse.json({ error: "orderID required" }, { status: 400 });

  // Desired FINAL quantity per Grab line id (0 = remove). Lines not listed are
  // sent unchanged.
  const editMap = new Map<string, number>();
  for (const e of body.edits ?? []) {
    const id = String(e?.grabItemId ?? "").trim();
    const q = Number(e?.quantity);
    if (!id || !Number.isInteger(q) || q < 0) {
      return NextResponse.json({ error: "each edit needs grabItemId + integer quantity >= 0" }, { status: 400 });
    }
    editMap.set(id, q);
  }
  if (editMap.size === 0) {
    return NextResponse.json({ error: "no edits provided" }, { status: 400 });
  }

  const supabase = getSupabase();

  // Resolve the order + its stored lines (pos_orders.external_id = Grab orderID).
  const { data: order } = await supabase
    .from("pos_orders").select("id").eq("external_id", orderID).maybeSingle();
  if (!order) return NextResponse.json({ error: "order not found" }, { status: 404 });

  const { data: lines } = await supabase
    .from("pos_order_items").select("grab_item_id, quantity").eq("order_id", (order as { id: string }).id);
  const stored = (lines ?? []) as StoredItem[];
  if (stored.length === 0) {
    return NextResponse.json({ error: "order has no items" }, { status: 409 });
  }
  // Every line must carry its grabItemID, or we can't build a valid payload.
  if (stored.some((l) => !l.grab_item_id)) {
    return NextResponse.json(
      { error: "this order predates edit support (no Grab line ids stored) and can't be edited" },
      { status: 409 },
    );
  }
  // Every edited id must actually be on the order.
  const onOrder = new Set(stored.map((l) => l.grab_item_id as string));
  for (const id of editMap.keys()) {
    if (!onOrder.has(id)) {
      return NextResponse.json({ error: `item ${id} is not on this order` }, { status: 400 });
    }
  }

  // Build the full payload: every line, with its final quantity. Modifiers are
  // omitted (no modifier change) per the Grab contract ("if no change to the
  // item's modifiers, you don't need to provide the modifier object").
  const items: EditOrderItem[] = stored.map((l) => ({
    itemID: l.grab_item_id as string,
    quantity: editMap.has(l.grab_item_id as string) ? editMap.get(l.grab_item_id as string)! : (l.quantity ?? 1),
  }));
  // Grab rejects an order with everything removed ("can't remove all items").
  if (items.every((i) => i.quantity <= 0)) {
    return NextResponse.json({ error: "can't remove all items from the order" }, { status: 400 });
  }

  const onlyRecalculate = body.onlyRecalculate === true;
  try {
    const result = await editOrder(orderID, items, { onlyRecalculate });
    console.log(`[grab:order-edit] orderID=${orderID} edits=${editMap.size} onlyRecalculate=${onlyRecalculate} ok`);
    return NextResponse.json({ success: true, onlyRecalculate, result });
  } catch (err) {
    console.error(`[grab:order-edit] orderID=${orderID} failed:`, err instanceof Error ? err.message : err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "edit failed" },
      { status: 502 },
    );
  }
}
