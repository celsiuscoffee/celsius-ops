import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase/server";

export async function POST(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const supabase = getSupabaseAdmin();
  const { id } = await params;

  // Fetch PO + items
  const { data: po, error: poErr } = await supabase
    .from("purchase_orders")
    .select("*, purchase_order_items(ingredient_id, quantity)")
    .eq("id", id)
    .single();

  if (poErr) return NextResponse.json({ error: poErr.message }, { status: 500 });
  if (po.status === "received") {
    return NextResponse.json({ error: "PO already received" }, { status: 400 });
  }

  // Mark as received
  const { error: updateErr } = await supabase
    .from("purchase_orders")
    .update({ status: "received", received_at: new Date().toISOString() })
    .eq("id", id);

  if (updateErr) return NextResponse.json({ error: updateErr.message }, { status: 500 });

  // Adjust stock levels (positive delta for each item)
  const rpcs = (po.purchase_order_items ?? []).map(
    (item: { ingredient_id: string; quantity: number }) =>
      supabase.rpc("adjust_stock_level", {
        p_ingredient_id: item.ingredient_id,
        p_store_id:      po.store_id,
        p_delta:         parseFloat(String(item.quantity)),
      })
  );

  await Promise.all(rpcs);

  return NextResponse.json({ ok: true });
}
