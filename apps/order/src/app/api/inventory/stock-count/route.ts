import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase/server";

export async function GET(req: NextRequest) {
  const supabase  = getSupabaseAdmin();
  const store_id  = req.nextUrl.searchParams.get("store_id");

  let query = supabase
    .from("stock_counts")
    .select("*, stock_count_items(count)")
    .order("created_at", { ascending: false });

  if (store_id) query = query.eq("store_id", store_id);

  const { data, error } = await query;
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json(data);
}

export async function POST(req: NextRequest) {
  const supabase = getSupabaseAdmin();
  const body = await req.json() as { store_id: string; counted_by?: string };

  if (!body.store_id) return NextResponse.json({ error: "Missing store_id" }, { status: 400 });

  // Create the stock count session
  const { data: count, error: countErr } = await supabase
    .from("stock_counts")
    .insert({
      store_id:   body.store_id,
      counted_by: body.counted_by ?? null,
      status:     "draft",
    })
    .select()
    .single();

  if (countErr) return NextResponse.json({ error: countErr.message }, { status: 500 });

  // Pre-populate items from active ingredients + current stock levels
  const { data: ingredients } = await supabase
    .from("ingredients")
    .select("id")
    .eq("is_active", true);

  if (ingredients && ingredients.length > 0) {
    // Fetch current stock levels for this store
    const { data: levels } = await supabase
      .from("stock_levels")
      .select("ingredient_id, quantity")
      .eq("store_id", body.store_id);

    const levelMap: Record<string, number> = {};
    for (const l of (levels ?? [])) {
      levelMap[l.ingredient_id] = parseFloat(l.quantity) ?? 0;
    }

    const items = ingredients.map((ing) => ({
      stock_count_id: count.id,
      ingredient_id:  ing.id,
      expected_qty:   levelMap[ing.id] ?? 0,
      counted_qty:    null,
      notes:          null,
    }));

    await supabase.from("stock_count_items").insert(items);
  }

  return NextResponse.json({ ok: true, id: count.id });
}
