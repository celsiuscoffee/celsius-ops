import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase/server";
import { createPayment } from "@/lib/revenue-monster/client";
import type { OrderRow } from "@/lib/supabase/types";

export async function POST(request: NextRequest) {
  try {
    const { orderId, paymentMethod } = await request.json();

    if (!orderId || !paymentMethod) {
      return NextResponse.json({ error: "Missing orderId or paymentMethod" }, { status: 400 });
    }

    const supabase = getSupabaseAdmin();
    const { data, error } = await supabase
      .from("orders")
      .select("id, order_number, store_id, total")
      .eq("id", orderId)
      .single();

    if (error || !data) {
      return NextResponse.json({ error: "Order not found" }, { status: 404 });
    }

    const order = data as Pick<OrderRow, "id" | "order_number" | "store_id" | "total">;
    const baseUrl = process.env.NEXT_PUBLIC_BASE_URL || "http://localhost:3001";

    const paymentUrl = await createPayment({
      orderId:       order.id,
      orderNumber:   order.order_number,
      storeId:       order.store_id,
      amountSen:     order.total,
      paymentMethod,
      redirectUrl:   `${baseUrl}/order/${order.id}?payment=done`,
      notifyUrl:     `${baseUrl}/api/payments/webhook`,
    });

    return NextResponse.json({ paymentUrl });
  } catch (err) {
    console.error("Create payment error:", err);
    return NextResponse.json({ error: "Payment initiation failed" }, { status: 500 });
  }
}
