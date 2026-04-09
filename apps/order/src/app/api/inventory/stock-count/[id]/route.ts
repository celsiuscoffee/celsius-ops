import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase/server";

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const supabase = getSupabaseAdmin();
  const { id } = await params;

  const { data, error } = await supabase
    .from("stock_counts")
    .select(`
      *,
      stock_count_items(
        *,
        ingredients(name, unit, ingredient_categories(name))
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
  const body = await req.json() as { items: { id: string; counted_qty: number; notes?: string }[] };

  if (!body.items?.length) return NextResponse.json({ error: "No items provided" }, { status: 400 });

  const updates = body.items.map((item) =>
    supabase
      .from("stock_count_items")
      .update({ counted_qty: item.counted_qty, notes: item.notes ?? null })
      .eq("id", item.id)
      .eq("stock_count_id", id)
  );

  const results = await Promise.all(updates);
  const failed  = results.filter((r) => r.error);
  if (failed.length > 0) {
    return NextResponse.json({ error: "Some items failed to update" }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}
