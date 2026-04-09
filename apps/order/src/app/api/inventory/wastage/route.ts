import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase/server";

export async function GET(req: NextRequest) {
  const supabase = getSupabaseAdmin();
  const store_id = req.nextUrl.searchParams.get("store_id");

  let query = supabase
    .from("wastage_logs")
    .select("*, ingredients(name, unit)")
    .order("created_at", { ascending: false });

  if (store_id) query = query.eq("store_id", store_id);

  const { data, error } = await query;
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json(data);
}

export async function POST(req: NextRequest) {
  const supabase = getSupabaseAdmin();
  const body = await req.json() as {
    store_id:      string;
    ingredient_id: string;
    quantity:      number;
    reason:        string;
    notes?:        string;
    logged_by?:    string;
  };

  if (!body.store_id || !body.ingredient_id) {
    return NextResponse.json({ error: "Missing required fields" }, { status: 400 });
  }

  // Create wastage log
  const { error: insertErr } = await supabase
    .from("wastage_logs")
    .insert({
      store_id:      body.store_id,
      ingredient_id: body.ingredient_id,
      quantity:      body.quantity,
      reason:        body.reason,
      notes:         body.notes      ?? null,
      logged_by:     body.logged_by  ?? null,
    });

  if (insertErr) return NextResponse.json({ error: insertErr.message }, { status: 500 });

  // Adjust stock level (negative delta)
  const { error: rpcErr } = await supabase.rpc("adjust_stock_level", {
    p_ingredient_id: body.ingredient_id,
    p_store_id:      body.store_id,
    p_delta:         -parseFloat(String(body.quantity)),
  });

  if (rpcErr) return NextResponse.json({ error: rpcErr.message }, { status: 500 });

  return NextResponse.json({ ok: true });
}
