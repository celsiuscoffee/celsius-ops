import { NextRequest, NextResponse } from "next/server";
import { after } from "next/server";
import Stripe from "stripe";
import { getSupabaseAdmin } from "@/lib/supabase/server";
import { earnLoyaltyPoints, deductLoyaltyPoints } from "@/lib/loyalty/points";
import { applyOrderToMission, generateMysteryDrop, maybeRewardReferralOnFirstOrder } from "@/lib/loyalty/v2";
import { notifyOrderPreparing } from "@/lib/push/templates";

export const preferredRegion = "iad1";

function getStripe() {
  const key = process.env.STRIPE_SECRET_KEY?.trim();
  if (!key) throw new Error("STRIPE_SECRET_KEY is not set");
  return new Stripe(key, { apiVersion: "2026-03-25.dahlia" });
}

export async function POST(request: NextRequest) {
  const body      = await request.text();
  const signature = request.headers.get("stripe-signature") ?? "";
  const secret    = process.env.STRIPE_WEBHOOK_SECRET ?? "";

  let event: Stripe.Event;
  try {
    event = getStripe().webhooks.constructEvent(body, signature, secret);
  } catch (err) {
    console.error("Stripe webhook signature error:", err);
    return NextResponse.json({ error: "Invalid signature" }, { status: 400 });
  }

  const supabase = getSupabaseAdmin();

  if (event.type === "payment_intent.succeeded") {
    const intent  = event.data.object as Stripe.PaymentIntent;
    const orderId = intent.metadata?.orderId;
    if (orderId) {
      const { data: order } = await supabase
        .from("orders")
        .update({
          status:               "preparing",
          payment_provider_ref: intent.id,
        } as Record<string, unknown>)
        .eq("id", orderId)
        .eq("status", "pending")
        .select("loyalty_id, loyalty_points_earned, reward_id, wallet_voucher_id, store_id, order_number, customer_phone, created_at")
        .single();

      if (order?.loyalty_id) {
        const outletId = order.store_id as string;
        // Awaited so Vercel doesn't kill the function mid-write —
        // returning the 200 to Stripe before the points actually
        // persist used to leave silent ledger gaps. The order-row
        // update above is gated on status="pending" so duplicate
        // webhook deliveries skip these calls (idempotent).
        if ((order.loyalty_points_earned as number) > 0) {
          await earnLoyaltyPoints(
            order.loyalty_id,
            orderId,
            order.loyalty_points_earned as number,
            outletId,
          );
        }
        if (order.reward_id) {
          const ok = await deductLoyaltyPoints(
            order.loyalty_id,
            order.reward_id as string,
            outletId,
          );
          if (!ok) {
            console.error(
              `[loyalty] Stripe webhook: FAILED to deduct points for order=${orderId} reward=${order.reward_id} — RECONCILE MANUALLY`,
            );
          }
        }

        // Wallet voucher redemption — mark the issued_rewards row
        // consumed. Doesn't deduct Beans (wallet vouchers cost nothing).
        // Runs in after() because the 200 to Stripe is more urgent than
        // the redemption flag, and the row is uniquely keyed on
        // (id, member_id) so it's safe to defer.
        if (order.wallet_voucher_id) {
          const voucherId = order.wallet_voucher_id as string;
          after(async () => {
            await supabase
              .from("issued_rewards")
              .update({ status: "redeemed", redeemed_at: new Date().toISOString() })
              .eq("id", voucherId)
              .eq("member_id", order.loyalty_id as string);
          });
        }

        // ─── Rewards v2 hooks ────────────────────────────────────────
        // Mirror of the fallback confirm-stripe route — without these
        // on the webhook (which is the PRIMARY production path),
        // missions never progress and no mystery drops generate.
        // Both run in after() so they don't block returning 200 to
        // Stripe.
        const loyaltyId = order.loyalty_id as string;
        const orderCreatedAt = (order.created_at as string) ?? new Date().toISOString();
        after(async () => {
          try {
            const { data: items } = await supabase
              .from("order_items")
              .select("product_id, quantity")
              .eq("order_id", orderId);
            const itemIds = (items ?? []).map((i) => i.product_id as string);
            const itemCount = (items ?? []).reduce((sum, i) => sum + ((i.quantity as number) ?? 0), 0);

            await applyOrderToMission({
              memberId: loyaltyId,
              order: {
                id: orderId,
                outlet_id: outletId,
                item_ids: itemIds,
                item_count: itemCount,
                total_sen: 0,
                created_at: orderCreatedAt,
              },
            });
          } catch (e) {
            console.warn("[v2] applyOrderToMission failed (webhook)", e);
          }

          try {
            const [{ data: memberBrand }, { data: memberRow }] = await Promise.all([
              supabase
                .from("member_brands")
                .select("tiers(slug)")
                .eq("member_id", loyaltyId)
                .eq("brand_id", "brand-celsius")
                .single(),
              supabase
                .from("members")
                .select("brand_data")
                .eq("id", loyaltyId)
                .single(),
            ]);
            const tierSlug = (memberBrand as { tiers?: { slug?: string } | null } | null)?.tiers?.slug ?? null;
            const bdayIso = (memberRow?.brand_data as { birthday?: string | null } | null)?.birthday ?? null;
            const birthdayMonth = bdayIso ? new Date(bdayIso).getMonth() + 1 : null;

            await generateMysteryDrop({
              memberId: loyaltyId,
              orderId,
              memberTier: tierSlug,
              birthdayMonth,
            });
          } catch (e) {
            console.warn("[v2] generateMysteryDrop failed (webhook)", e);
          }

          try {
            await maybeRewardReferralOnFirstOrder({
              memberId: loyaltyId,
              orderId,
            });
          } catch (e) {
            console.warn("[v2] maybeRewardReferralOnFirstOrder failed (webhook)", e);
          }
        });
      }

      // "Brewing now ☕" push at the payment-confirmed moment. Before
      // this, customers got NO push between paying and the order being
      // marked ready — payment-success was silent because the webhook
      // bypasses the status PATCH route (which is where the preparing
      // push already fires for cash / manual flows). after() keeps the
      // Vercel invocation alive until the Expo fetch completes.
      // Gated on the row actually transitioning (data !== null) so a
      // duplicate webhook delivery doesn't re-fire the push.
      if (order) {
        const orderRow = order as { order_number: string; customer_phone: string | null };
        after(async () => {
          await notifyOrderPreparing({
            orderId,
            orderNumber:   orderRow.order_number,
            customerPhone: orderRow.customer_phone,
          }).catch((e) => console.warn("[push] order_preparing webhook", e));
        });
      }
    }
  }

  if (event.type === "payment_intent.payment_failed" || event.type === "payment_intent.canceled") {
    const intent  = event.data.object as Stripe.PaymentIntent;
    const orderId = intent.metadata?.orderId;
    if (orderId) {
      await supabase
        .from("orders")
        .update({ status: "failed" } as Record<string, unknown>)
        .eq("id", orderId)
        .eq("status", "pending");
    }
  }

  return NextResponse.json({ received: true });
}
