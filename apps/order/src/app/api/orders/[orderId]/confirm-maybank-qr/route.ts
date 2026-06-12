import { NextRequest, NextResponse } from "next/server";
import { after } from "next/server";
import { verifyServiceToken } from "@celsius/auth";
import { getSupabaseAdmin } from "@/lib/supabase/server";
import { earnLoyaltyPoints, deductLoyaltyPoints } from "@/lib/loyalty/points";
import { applyOrderV2Hooks } from "@/lib/loyalty/v2";
import { notifyOrderPreparing } from "@/lib/push/templates";
import { shouldHoldForScheduled } from "@/lib/revenue-monster/order-status";

/**
 * POST /api/orders/[orderId]/confirm-maybank-qr
 *
 * Server-to-server release for a Maybank static QR order. Called by the
 * backoffice "Mark paid & release" action (apps/backoffice → /pos/maybank-qr)
 * after a staff member visually verifies the Maybank transfer.
 *
 * Mirrors confirm-stripe's post-payment side-effects so a Maybank-QR
 * customer earns loyalty points, redeems wallet vouchers, etc. on parity
 * with gateway-paid customers — the only difference is the upstream
 * trust check (Stripe's PaymentIntent ↔ a staff member's eyes).
 *
 * Auth: a short-lived scoped service token (Bearer) signed with the
 * JWT_SECRET both apps share — see @celsius/auth createServiceToken.
 * The legacy `x-service-key` (raw service-role key) is still accepted
 * during the deploy transition; remove that branch once both apps run
 * the token version. Accepting it grants nothing extra — anyone holding
 * the service-role key already owns the database — the point of the
 * migration is that backoffice stops SENDING it over the wire.
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ orderId: string }> },
) {
  const { orderId } = await params;
  if (!orderId) {
    return NextResponse.json({ error: "Missing orderId" }, { status: 400 });
  }

  const bearer = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "").trim() ?? "";
  const tokenOk = bearer
    ? await verifyServiceToken(bearer, "order.confirm-maybank-qr")
    : false;
  if (!tokenOk) {
    // Legacy transition path — see route doc above. Remove after both
    // apps are deployed on the token flow.
    const expected = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim();
    const provided = request.headers.get("x-service-key")?.trim() ?? "";
    if (!expected || !provided || expected !== provided) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
  }

  try {
    const supabase = getSupabaseAdmin();

    // Peek for scheduled-pickup hold logic — same as confirm-stripe.
    const { data: peek } = await supabase
      .from("orders")
      .select("store_id, pickup_at, payment_method, status")
      .eq("id", orderId)
      .maybeSingle();
    const peekRow = peek as
      | { store_id?: string | null; pickup_at?: string | null; payment_method?: string | null; status?: string | null }
      | null;
    if (!peekRow) {
      return NextResponse.json({ error: "Order not found" }, { status: 404 });
    }
    if (peekRow.payment_method !== "maybank_qr") {
      return NextResponse.json({ error: "Not a Maybank QR order" }, { status: 409 });
    }
    if (peekRow.status !== "pending") {
      // Idempotent — already released, nothing to do.
      return NextResponse.json({ confirmed: true, alreadyReleased: true });
    }

    let prepTimeMins = 10;
    if (peekRow.store_id) {
      const { data: outlet } = await supabase
        .from("outlet_settings")
        .select("pickup_time_mins")
        .eq("store_id", peekRow.store_id)
        .maybeSingle();
      const ptm = (outlet as { pickup_time_mins?: number } | null)?.pickup_time_mins;
      if (typeof ptm === "number" && ptm > 0) prepTimeMins = ptm;
    }
    const scheduled = shouldHoldForScheduled(peekRow.pickup_at ?? null, prepTimeMins);
    const nextStatus = scheduled ? "paid" : "preparing";

    // Idempotent update: only flips if the order is still pending +
    // payment_method=maybank_qr. Same select shape confirm-stripe uses
    // so the loyalty handoff below matches its parity. orders has no
    // paid_at column — writing one here used to make this update error
    // silently and the route report alreadyReleased without releasing.
    const { data: updated, error: updateError } = await supabase
      .from("orders")
      .update({ status: nextStatus } as Record<string, unknown>)
      .eq("id", orderId)
      .eq("status", "pending")
      .eq("payment_method", "maybank_qr")
      .select("loyalty_id, loyalty_points_earned, reward_id, wallet_voucher_id, store_id, order_number, customer_phone, created_at")
      .maybeSingle();

    if (updateError) {
      // A DB error is NOT "already released" — surface it so the staff
      // member retries instead of walking away from an unreleased order.
      console.error("confirm-maybank-qr update failed:", updateError);
      return NextResponse.json({ error: "Failed to release order" }, { status: 500 });
    }
    if (!updated) {
      // Raced with another release; nothing to do.
      return NextResponse.json({ confirmed: true, alreadyReleased: true });
    }

    // ── Loyalty earn / deduct (parity with confirm-stripe) ────────
    if (updated.loyalty_id) {
      const outletId = updated.store_id as string;
      const loyaltyId = updated.loyalty_id as string;
      const pointsEarned = (updated.loyalty_points_earned as number) ?? 0;
      const rewardId = (updated.reward_id as string | null) ?? null;
      const orderCreatedAt = (updated.created_at as string) ?? new Date().toISOString();
      const walletVoucherId = (updated.wallet_voucher_id as string | null) ?? null;

      // Loyalty earn/deduct + v2 hooks — all post-response via after()
      // so the staff release UI doesn't wait, but AWAITED inside it:
      // these were fire-and-forget promises before (unobserved
      // rejections; serverless freeze could drop the write).
      after(async () => {
        try {
          if (pointsEarned > 0) {
            await earnLoyaltyPoints(loyaltyId, orderId, pointsEarned, outletId);
          }
          if (rewardId) {
            await deductLoyaltyPoints(loyaltyId, rewardId, outletId);
          }
        } catch (e) {
          console.error(`[confirm-maybank-qr] loyalty earn/deduct failed for order=${orderId}`, e);
        }
        await applyOrderV2Hooks({
          memberId: loyaltyId,
          orderId,
          outletId,
          orderCreatedAt,
          walletVoucherId,
        });
      });
    }

    // ── "Brewing now" push (skip for scheduled — promote-scheduled
    //     cron handles those at brew-window-open time). ────────────
    if (!scheduled) {
      const orderRow = updated as { order_number: string; customer_phone: string | null };
      after(async () => {
        await notifyOrderPreparing({
          orderId,
          orderNumber: orderRow.order_number,
          customerPhone: orderRow.customer_phone,
        }).catch((e) => console.warn("[push] order_preparing confirm-maybank-qr", e));
      });
    }

    return NextResponse.json({ confirmed: true, status: nextStatus });
  } catch (err) {
    console.error("confirm-maybank-qr error:", err);
    return NextResponse.json({ error: "Failed to confirm" }, { status: 500 });
  }
}
