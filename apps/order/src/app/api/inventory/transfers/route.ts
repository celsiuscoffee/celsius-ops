import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase/server";

export async function GET(req: NextRequest) {
  const supabase = getSupabaseAdmin();
  const store_id = req.nextUrl.searchParams.get("store_id");

  let query = supabase
    .from("stock_transfers")
    .select("*, stock_transfer_items(count)")
    .order("created_at", { ascending: false });

  if (store_id) {
    query = query.or(`from_store_id.eq.${store_id},to_store_id.eq.${store_id}`);
  }

  const { data, error } = await query;
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json(data);
}

export async function POST(req: NextRequest) {
  const supabase = getSupabaseAdmin();
  const body = await req.json() as {
    from_store_id:  string;
    to_store_id:    string;
    transferred_by?: string;
    notes?:          string;
    items: { ingredient_id: string; quantity: number }[];
  };

  if (!body.from_store_id || !body.to_store_id || !body.items?.length) {
    return NextResponse.json({ error: "Missing required fields" }, { status: 400 });
  }
  if (body.from_store_id === body.to_store_id) {
    return NextResponse.json({ error: "From and to stores must differ" }, { status: 400 });
  }

  // Create transfer record
  const { data: transfer, error: transferErr } = await supabase
    .from("stock_transfers")
    .insert({
      from_store_id:  body.from_store_id,
      to_store_id:    body.to_store_id,
      transferred_by: body.transferred_by ?? null,
      notes:          body.notes          ?? null,
      status:         "completed",
      transferred_at: new Date().toISOString(),
    })
    .select()
    .single();

  if (transferErr) return NextResponse.json({ error: transferErr.message }, { status: 500 });

  // Insert transfer items
  const rows = body.items.map((item) => ({
    transfer_id:   transfer.id,
    ingredient_id: item.ingredient_id,
    quantity:      item.quantity,
  }));
  await supabase.from("stock_transfer_items").insert(rows);

  // Adjust stock levels
  const rpcs = body.items.flatMap((item) => [
    // Deduct from source
    supabase.rpc("adjust_stock_level", {
      p_ingredient_id: item.ingredient_id,
      p_store_id:      body.from_store_id,
      p_delta:         -parseFloat(String(item.quantity)),
    }),
    // Add to destination
    supabase.rpc("adjust_stock_level", {
      p_ingredient_id: item.ingredient_id,
      p_store_id:      body.to_store_id,
      p_delta:         parseFloat(String(item.quantity)),
    }),
  ]);

  await Promise.all(rpcs);

  return NextResponse.json({ ok: true, id: transfer.id });
}
