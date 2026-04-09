import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase/server";

export async function POST(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const supabase = getSupabaseAdmin();
  const { id } = await params;

  // Fetch count + items
  const { data: count, error: countErr } = await supabase
    .from("stock_counts")
    .select("*, stock_count_items(ingredient_id, counted_qty)")
    .eq("id", id)
    .single();

  if (countErr) return NextResponse.json({ error: countErr.message }, { status: 500 });
  if (count.status !== "draft") {
    return NextResponse.json({ error: "Count is not in draft status" }, { status: 400 });
  }

  // Update status to submitted
  const { error: updateErr } = await supabase
    .from("stock_counts")
    .update({ status: "submitted", submitted_at: new Date().toISOString() })
    .eq("id", id);

  if (updateErr) return NextResponse.json({ error: updateErr.message }, { status: 500 });

  // Call set_stock_level() for each item that has a counted_qty
  const items = (count.stock_count_items ?? []).filter(
    (item: { counted_qty: number | null }) => item.counted_qty !== null
  );

  const rpcs = items.map((item: { ingredient_id: string; counted_qty: number }) =>
    supabase.rpc("set_stock_level", {
      p_ingredient_id: item.ingredient_id,
      p_store_id:      count.store_id,
      p_quantity:      item.counted_qty,
    })
  );

  await Promise.all(rpcs);

  return NextResponse.json({ ok: true });
}
