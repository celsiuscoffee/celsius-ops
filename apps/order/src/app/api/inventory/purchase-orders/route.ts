import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase/server";

export async function GET(req: NextRequest) {
  const supabase = getSupabaseAdmin();
  const store_id = req.nextUrl.searchParams.get("store_id");

  let query = supabase
    .from("purchase_orders")
    .select("*, purchase_order_items(count)")
    .order("created_at", { ascending: false });

  if (store_id) query = query.eq("store_id", store_id);

  const { data, error } = await query;
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json(data);
}

export async function POST(req: NextRequest) {
  const supabase = getSupabaseAdmin();
  const body = await req.json() as {
    store_id:    string;
    supplier_id?: string;
    notes?:      string;
    created_by?: string;
  };

  if (!body.store_id) return NextResponse.json({ error: "Missing store_id" }, { status: 400 });

  const { data, error } = await supabase
    .from("purchase_orders")
    .insert({
      store_id:    body.store_id,
      supplier_id: body.supplier_id ?? null,
      notes:       body.notes       ?? null,
      created_by:  body.created_by  ?? null,
      status:      "draft",
    })
    .select()
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true, id: data.id });
}
