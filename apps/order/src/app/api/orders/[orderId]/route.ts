import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase/server";

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ orderId: string }> }
) {
  try {
    const { orderId } = await params;
    const supabase    = getSupabaseAdmin();

    const { data, error } = await supabase
      .from("orders")
      .select("*, order_items(*)")
      .eq("id", orderId)
      .single();

    if (error || !data) {
      return NextResponse.json({ error: "Order not found" }, { status: 404 });
    }

    // Join outlet display name + address from outlet_settings so the
    // customer's order page can show "Celsius Coffee Putrajaya · Lot 15…"
    // without a second round-trip. Cheap — single row by store_id —
    // and the order page polls this every 5s so the cost matters.
    let store_name: string | null    = null;
    let store_address: string | null = null;
    const storeId = (data as { store_id?: string | null }).store_id;
    if (storeId) {
      const { data: outlet } = await supabase
        .from("outlet_settings")
        .select("name, address")
        .eq("store_id", storeId)
        .maybeSingle();
      if (outlet) {
        store_name    = (outlet as { name?: string | null }).name ?? null;
        store_address = (outlet as { address?: string | null }).address ?? null;
      }
    }

    return NextResponse.json({ ...data, store_name, store_address });
  } catch (err) {
    console.error("Get order error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
