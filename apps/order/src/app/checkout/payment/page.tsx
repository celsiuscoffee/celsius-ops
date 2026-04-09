"use client";

import { Suspense } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { loadStripe } from "@stripe/stripe-js";
import {
  Elements,
  PaymentElement,
  useStripe,
  useElements,
} from "@stripe/react-stripe-js";
import { ArrowLeft, Loader2, ShieldCheck } from "lucide-react";
import { useState } from "react";

const stripePromise = loadStripe(process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY!);

function PaymentForm({ orderId, total }: { orderId: string; total: number }) {
  const stripe = useStripe();
  const elements = useElements();
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!stripe || !elements) return;

    setLoading(true);
    setError(null);

    const baseUrl =
      process.env.NEXT_PUBLIC_BASE_URL || window.location.origin;

    const { error: stripeError } = await stripe.confirmPayment({
      elements,
      confirmParams: {
        return_url: `${baseUrl}/order/${orderId}?payment=stripe`,
      },
    });

    // confirmPayment only resolves here if it fails (Stripe redirects on success)
    if (stripeError) {
      setError(stripeError.message ?? "Payment failed. Please try again.");
      setLoading(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-5">
      <PaymentElement
        options={{
          layout: "tabs",
          paymentMethodOrder: ["fpx", "card", "grabpay"],
        }}
      />

      {error && (
        <div className="bg-red-50 border border-red-200 rounded-xl px-4 py-3 text-sm text-red-600">
          {error}
        </div>
      )}

      <button
        type="submit"
        disabled={!stripe || loading}
        className="w-full bg-[#160800] text-white rounded-full py-4 font-semibold text-base disabled:opacity-60 flex items-center justify-center gap-2 transition-opacity"
      >
        {loading ? (
          <>
            <Loader2 className="h-4 w-4 animate-spin" />
            Processing...
          </>
        ) : (
          `Pay RM ${total.toFixed(2)}`
        )}
      </button>

      <div className="flex items-center justify-center gap-1.5 text-xs text-muted-foreground">
        <ShieldCheck className="h-3.5 w-3.5" />
        <span>Secured by Stripe</span>
      </div>
    </form>
  );
}

function PaymentPageContent() {
  const searchParams = useSearchParams();
  const router = useRouter();

  const clientSecret = searchParams.get("clientSecret");
  const orderId = searchParams.get("orderId");
  const totalStr = searchParams.get("total");
  const total = totalStr ? parseFloat(totalStr) : 0;

  if (!clientSecret || !orderId) {
    router.replace("/cart");
    return null;
  }

  return (
    <div className="flex flex-col min-h-dvh bg-[#f5f5f5]">
      <header className="bg-white px-4 pt-12 pb-3 flex items-center gap-3 sticky top-0 z-10 border-b">
        <button onClick={() => router.back()} className="p-1">
          <ArrowLeft className="h-5 w-5" />
        </button>
        <h1 className="text-base font-semibold flex-1 text-center">
          Complete Payment
        </h1>
        <div className="w-7" />
      </header>

      <main className="flex-1 px-4 py-6 max-w-[430px] mx-auto w-full">
        <div className="bg-white rounded-2xl p-5 shadow-sm">
          <p className="text-sm text-muted-foreground mb-5 text-center">
            Choose your preferred payment method
          </p>
          <Elements
            stripe={stripePromise}
            options={{
              clientSecret,
              appearance: {
                theme: "stripe",
                variables: {
                  colorPrimary: "#160800",
                  colorBackground: "#ffffff",
                  fontFamily: "Space Grotesk, system-ui, sans-serif",
                  borderRadius: "12px",
                },
              },
              locale: "en",
            }}
          >
            <PaymentForm orderId={orderId} total={total} />
          </Elements>
        </div>
      </main>
    </div>
  );
}

export default function PaymentPage() {
  return (
    <Suspense
      fallback={<div className="flex flex-col min-h-dvh bg-[#f5f5f5]" />}
    >
      <PaymentPageContent />
    </Suspense>
  );
}
