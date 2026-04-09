import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase/server";

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const supabase = getSupabaseAdmin();
  const { id } = await params;

  const { data, error } = await supabase
    .from("purchase_orders")
    .select(`
      *,
      suppliers(name),
      purchase_order_items(
        *,
        ingredients(name, unit)
      )
    `)
    .eq("id", id)
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json(data);
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const supabase = getSupabaseAdmin();
  const { id } = await params;
  const body = await req.json() as {
    items?: { ingredient_id: string; quantity: number; unit_cost: number; notes?: string }[];
    notes?: string;
    supplier_id?: string;
  };

  // Update PO metadata if provided
  if (body.notes !== undefined || body.supplier_id !== undefined) {
    const patch: Record<string, unknown> = {};
    if (body.notes       !== undefined) patch.notes       = body.notes;
    if (body.supplier_id !== undefined) patch.supplier_id = body.supplier_id;
    await supabase.from("purchase_orders").update(patch).eq("id", id);
  }

  // Replace line items if provided
  if (body.items) {
    // Delete existing items
    await supabase.from("purchase_order_items").delete().eq("purchase_order_id", id);

    if (body.items.length > 0) {
      const rows = body.items.map((item) => ({
        purchase_order_id: id,
        ingredient_id:     item.ingredient_id,
        quantity:          item.quantity,
        unit_cost:         item.unit_cost,
        notes:             item.notes ?? null,
      }));
      const { error } = await supabase.from("purchase_order_items").insert(rows);
      if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    }
  }

  return NextResponse.json({ ok: true });
}
