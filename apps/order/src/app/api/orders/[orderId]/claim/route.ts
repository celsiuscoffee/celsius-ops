import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase/server";
import type { OrderRow } from "@/lib/supabase/types";

// POST /api/orders/[orderId]/claim
// Called by the customer when they swipe to collect their order.
// Marks the order as "completed" — no further status changes needed.
export async function POST(
  _request: NextRequest,
  { params }: { params: Promise<{ orderId: string }> }
) {
  try {
    const { orderId } = await params;
    const supabase    = getSupabaseAdmin();

    const { data, error: fetchError } = await supabase
      .from("orders")
      .select("status")
      .eq("id", orderId)
      .single();

    if (fetchError || !data) {
      return NextResponse.json({ error: "Order not found" }, { status: 404 });
    }

    const order = data as Pick<OrderRow, "status">;

    // Already completed — idempotent
    if (order.status === "completed") {
      return NextResponse.json({ ok: true, status: "completed" });
    }

    if (!["paid", "preparing", "ready"].includes(order.status)) {
      return NextResponse.json(
        { error: `Cannot claim order with status: ${order.status}` },
        { status: 422 }
      );
    }

    const { error: updateError } = await supabase
      .from("orders")
      .update({ status: "completed" })
      .eq("id", orderId);

    if (updateError) {
      return NextResponse.json({ error: "Update failed" }, { status: 500 });
    }

    return NextResponse.json({ ok: true, status: "completed" });
  } catch (err) {
    console.error("Claim order error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
