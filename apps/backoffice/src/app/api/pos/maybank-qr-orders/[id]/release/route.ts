import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/pickup/supabase";
import { requireAuth } from "@/lib/auth";

/**
 * POST /api/pos/maybank-qr-orders/[id]/release
 *
 * Staff confirms the Maybank transfer landed and releases the order
 * to the kitchen. Flips `orders.status` from `pending` → `preparing`
 * which:
 *   - Is the canonical "accepted / sent-to-kitchen" marker.
 *   - Triggers the existing realtime kitchen-docket print on the POS
 *     register (apps/pos/src/lib/use-pickup-printer.ts).
 *   - Stamps `paid_at` so reconciliation can split Maybank takings
 *     from gateway takings later.
 *
 * Guarded so it only releases orders that are actually `pending` AND
 * `payment_method=maybank_qr` — no accidental "release" of a gateway
 * order that's mid-confirmation.
 *
 * Customer push notification is deliberately skipped here — the
 * customer is at the counter when paying via static QR, so they're
 * already aware. Loyalty earning hooks live in apps/order and can be
 * folded in later by routing through that app's confirm path.
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const auth = await requireAuth(request);
  if (auth.error) return auth.error;

  const { id } = await params;
  if (!id) return NextResponse.json({ error: "Missing order id" }, { status: 400 });

  const supabase = getSupabaseAdmin();

  // Atomic transition: only flips if the order is still pending +
  // maybank_qr. Returns the updated row so the UI can confirm.
  const { data, error } = await supabase
    .from("orders")
    .update({
      status: "preparing",
      paid_at: new Date().toISOString(),
    })
    .eq("id", id)
    .eq("status", "pending")
    .eq("payment_method", "maybank_qr")
    .select("id, order_number, status")
    .maybeSingle();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  if (!data) {
    return NextResponse.json(
      { error: "Order not found, not pending, or not a Maybank QR order" },
      { status: 409 },
    );
  }

  return NextResponse.json({ ok: true, order: data });
}
