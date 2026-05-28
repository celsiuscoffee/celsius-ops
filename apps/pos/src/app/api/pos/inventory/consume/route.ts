import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { applyRecipeStock } from "@/lib/inventory";

/**
 * POST /api/pos/inventory/consume
 *
 * Deplete (on sale) or restore (on void/cancel) ingredient stock for an
 * order, driven by each line's catalog recipe (BOM). Best-effort: the POS
 * fires this without awaiting, so a stock failure never blocks the register.
 *
 * Body: { order_id: string, direction?: "deplete" | "restore" }
 */

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
);

export async function POST(req: NextRequest) {
  try {
    const body = (await req.json()) as { order_id?: string; direction?: "deplete" | "restore" };
    const orderId = body.order_id;
    const direction = body.direction === "restore" ? "restore" : "deplete";
    if (!orderId) {
      return NextResponse.json({ error: "order_id required" }, { status: 400 });
    }

    const { data: order } = await supabase
      .from("pos_orders")
      .select("id, outlet_id, refund_of_order_id")
      .eq("id", orderId)
      .maybeSingle();
    if (!order) {
      return NextResponse.json({ error: "order not found" }, { status: 404 });
    }
    // Refund rows carry negative quantities and are reconciled by the refund
    // route itself; never let one flow through here.
    if (order.refund_of_order_id) {
      return NextResponse.json({ ok: true, skipped: "refund_row" });
    }

    const { data: items } = await supabase
      .from("pos_order_items")
      .select("product_id, quantity")
      .eq("order_id", orderId);

    const lines = (items ?? []).map((i) => ({
      productId: i.product_id as string,
      qty: Math.abs(Number(i.quantity) || 0),
    }));

    const result = await applyRecipeStock({
      outletRef: order.outlet_id as string,
      lines,
      direction,
    });
    return NextResponse.json(result);
  } catch (err) {
    console.error("[inventory/consume] uncaught:", err);
    const msg = err instanceof Error ? err.message : "consume failed";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
