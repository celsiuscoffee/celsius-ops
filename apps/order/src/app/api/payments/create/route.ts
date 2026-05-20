import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase/server";
import { createPayment } from "@/lib/revenue-monster/client";
import type { OrderRow } from "@/lib/supabase/types";

export async function POST(request: NextRequest) {
  try {
    const {
      orderId,
      paymentMethod,
      // Optional override — the native pickup app passes a custom-scheme
      // URL like "celsiuscoffee://rm-return" so WebBrowser.openAuthSession
      // can dismiss the in-app browser when RM redirects back. Browser-
      // based flows omit this and get the default web order page.
      redirectUrl: redirectUrlOverride,
    } = await request.json();

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
    // .trim() guards against accidental trailing newlines in the
    // Vercel env var textarea — without it the resulting notifyUrl
    // would contain a \n and RM rejects with "The notifyUrl format
    // is invalid".
    const baseUrl = (process.env.NEXT_PUBLIC_BASE_URL || "http://localhost:3001").trim();

    const paymentUrl = await createPayment({
      orderId:       order.id,
      orderNumber:   order.order_number,
      storeId:       order.store_id,
      amountSen:     order.total,
      paymentMethod,
      redirectUrl:   redirectUrlOverride || `${baseUrl}/order/${order.id}?payment=done`,
      notifyUrl:     `${baseUrl}/api/payments/webhook`,
    });

    return NextResponse.json({ paymentUrl });
  } catch (err) {
    // Surface the real cause to the caller. Native app shows whatever
    // string we return in the "Couldn't place order" alert, so a
    // specific message ("RM token failed: 401 invalid_client") is far
    // more actionable than the old "Payment initiation failed" stub.
    const msg = err instanceof Error ? err.message : "Payment initiation failed";
    console.error("Create payment error:", err);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
