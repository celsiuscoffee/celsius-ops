export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";
import Stripe from "stripe";
import { getSupabaseAdmin } from "@/lib/supabase/server";
import { earnLoyaltyPoints, deductLoyaltyPoints } from "@/lib/loyalty/points";
import { checkCronAuth } from "@celsius/shared";

// Runs every minute. Finds "pending" orders between 2 and 55 minutes old and
// reconciles them against Stripe — covers wallet cancels where confirm-stripe
// and the Stripe webhook both never fired. Older rows are left to
// /api/cron/expire-orders, which fails them at the 60-minute mark.

function getStripe() {
  const key = process.env.STRIPE_SECRET_KEY?.trim();
  if (!key) return null;
  return new Stripe(key, { apiVersion: "2026-03-25.dahlia" });
}

type OrderLite = {
  id: string;
  order_number: string;
  store_id: string;
  loyalty_id: string | null;
  loyalty_points_earned: number | null;
  reward_id: string | null;
};

export async function GET(request: NextRequest) {
  const cronAuth = checkCronAuth(request.headers);
  if (!cronAuth.ok) return NextResponse.json({ error: cronAuth.error }, { status: cronAuth.status });

  const stripe = getStripe();
  if (!stripe) {
    return NextResponse.json({ error: "Stripe not configured" }, { status: 500 });
  }

  const supabase = getSupabaseAdmin();
  const now      = Date.now();
  const olderThan  = new Date(now - 2  * 60 * 1000).toISOString();
  const youngerThan = new Date(now - 55 * 60 * 1000).toISOString();

  const { data: pending, error } = await supabase
    .from("orders")
    .select("id, order_number, store_id, loyalty_id, loyalty_points_earned, reward_id")
    .eq("status", "pending")
    .lt("created_at", olderThan)
    .gt("created_at", youngerThan);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  const orders = (pending ?? []) as OrderLite[];
  const result = { checked: orders.length, advanced: 0, failed: 0, unresolved: 0 };

  for (const order of orders) {
    try {
      // Stripe indexes metadata for search within a few seconds of intent creation.
      const search = await stripe.paymentIntents.search({
        query: `metadata['orderId']:'${order.id}'`,
        limit: 1,
      });
      const intent = search.data[0];

      if (!intent) {
        result.unresolved += 1;
        continue;
      }

      if (intent.status === "succeeded") {
        const { data: updated } = await supabase
          .from("orders")
          .update({
            status: "preparing",
            payment_provider_ref: intent.id,
          } as Record<string, unknown>)
          .eq("id", order.id)
          .eq("status", "pending")
          .select("id")
          .maybeSingle();

        if (updated) {
          if (order.loyalty_id) {
            if ((order.loyalty_points_earned ?? 0) > 0) {
              earnLoyaltyPoints(order.loyalty_id, order.id, order.loyalty_points_earned ?? 0, order.store_id);
            }
            if (order.reward_id) {
              deductLoyaltyPoints(order.loyalty_id, order.reward_id, order.store_id);
            }
          }
          result.advanced += 1;
        }
      } else if (intent.status === "canceled" || intent.status === "requires_payment_method") {
        // requires_payment_method after a failed attempt means the wallet /
        // card rejected — treat as failed so the KDS stops seeing a ghost row.
        await supabase
          .from("orders")
          .update({ status: "failed" } as Record<string, unknown>)
          .eq("id", order.id)
          .eq("status", "pending");
        result.failed += 1;
      } else {
        result.unresolved += 1;
      }
    } catch (err) {
      console.error("[reconcile-pending]", order.order_number, err);
      result.unresolved += 1;
    }
  }

  return NextResponse.json(result);
}
