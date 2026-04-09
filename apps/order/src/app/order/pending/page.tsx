"use client";

import { useEffect } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Loader2 } from "lucide-react";
import { loadStripe } from "@stripe/stripe-js";

// Landing page after FPX / redirect-based Stripe payments.
// Stripe appends: ?payment_intent=pi_xxx&payment_intent_client_secret=pi_xxx_sec_yyy&redirect_status=succeeded
// We retrieve the PaymentIntent to get the orderId from metadata, then redirect.
export default function PendingPage() {
  const router       = useRouter();
  const searchParams = useSearchParams();

  useEffect(() => {
    const paymentIntent       = searchParams.get("payment_intent");
    const clientSecret        = searchParams.get("payment_intent_client_secret");
    const redirectStatus      = searchParams.get("redirect_status");

    if (!paymentIntent || !clientSecret) {
      router.replace("/");
      return;
    }

    if (redirectStatus === "failed") {
      router.replace("/cart?payment=failed");
      return;
    }

    // Retrieve orderId from PaymentIntent metadata via Stripe.js
    const key = process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY;
    if (!key) { router.replace("/"); return; }

    loadStripe(key).then(async (stripe) => {
      if (!stripe) { router.replace("/"); return; }
      const { paymentIntent: pi } = await stripe.retrievePaymentIntent(clientSecret);
      const orderId = (pi as { metadata?: { orderId?: string } } | null)?.metadata?.orderId;
      if (orderId) {
        router.replace(`/order/${orderId}?payment=done`);
      } else {
        router.replace("/account/orders?tab=current");
      }
    });
  }, [searchParams, router]);

  return (
    <div className="flex flex-col min-h-dvh items-center justify-center bg-[#160800] gap-4">
      <Loader2 className="h-8 w-8 animate-spin text-white/40" />
      <p className="text-white/40 text-sm">Confirming payment…</p>
    </div>
  );
}
