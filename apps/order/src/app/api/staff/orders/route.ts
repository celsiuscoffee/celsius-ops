import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase/server";

// GET /api/staff/orders?store=shah-alam&from=2024-01-01T00:00:00.000Z
export async function GET(request: NextRequest) {
  const storeId = request.nextUrl.searchParams.get("store");
  const from    = request.nextUrl.searchParams.get("from");

  if (!storeId) return NextResponse.json({ error: "Missing store" }, { status: 400 });

  const supabase = getSupabaseAdmin();
  let query = supabase
    .from("orders")
    .select("id, status, total, created_at, order_items(product_name, quantity)")
    .eq("store_id", storeId)
    .order("created_at", { ascending: false });

  if (from) query = query.gte("created_at", from);

  const { data, error } = await query;
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json(data ?? []);
}
