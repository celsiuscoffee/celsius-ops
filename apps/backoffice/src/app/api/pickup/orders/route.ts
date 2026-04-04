import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/pickup/supabase";

function normalisePhone(phone: string): string {
  const digits = phone.replace(/\D/g, "");
  if (digits.startsWith("60")) return `+${digits}`;
  if (digits.startsWith("0"))  return `+6${digits}`;
  return `+60${digits}`;
}

// GET /api/pickup/orders
// Query params: from, to, store, status, phone
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = request.nextUrl;
    const from   = searchParams.get("from");
    const to     = searchParams.get("to");
    const store  = searchParams.get("store");
    const status = searchParams.get("status");
    const phone  = searchParams.get("phone");

    const supabase = getSupabaseAdmin();

    let query = supabase
      .from("orders")
      .select("*, order_items(*)")
      .order("created_at", { ascending: false })
      .limit(200);

    if (from   && from   !== "")    query = query.gte("created_at", new Date(from).toISOString());
    if (to     && to     !== "")    query = query.lte("created_at", new Date(to + "T23:59:59").toISOString());
    if (store  && store  !== "all") query = query.eq("store_id", store);
    if (status && status !== "all") query = query.eq("status", status);
    if (phone  && phone  !== "")    query = query.eq("customer_phone", normalisePhone(phone));

    const { data, error } = await query;

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json(data ?? []);
  } catch (err) {
    console.error("Pickup orders error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
