import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/pickup/supabase";
import { requireAuth } from "@/lib/auth";

/**
 * GET /api/pos/maybank-qr-orders
 *
 * Lists pending Maybank-static-QR orders that are waiting for a staff
 * member to verify the payment and release them. Backs the
 * /pos/maybank-qr page used by the counter staff at each outlet.
 *
 * The order app's gateway-driven flows (Stripe / Revenue Monster) self-
 * confirm via webhook. Maybank static QR has no such webhook, so the
 * order stays as `pending + payment_method=maybank_qr` until somebody
 * here releases it (POST /api/pos/maybank-qr-orders/[id]/release).
 */
export async function GET(request: NextRequest) {
  const auth = await requireAuth(request);
  if (auth.error) return auth.error;

  const supabase = getSupabaseAdmin();
  const { data, error } = await supabase
    .from("orders")
    .select(
      "id, order_number, store_id, status, payment_method, total, customer_name, customer_phone, created_at",
    )
    .eq("status", "pending")
    .eq("payment_method", "maybank_qr")
    .order("created_at", { ascending: true });

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json(data ?? []);
}
