"use client";

import { useEffect, useState, useCallback, use } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { ArrowLeft, Loader2 } from "lucide-react";
import { StripePaymentForm } from "@/components/stripe-payment-form";

// Real Stripe checkout for orders created via the native pickup app or from
// any flow that posts to /api/orders directly. Fetches the order, mints a
// PaymentIntent server-side, then mounts <StripePaymentForm /> so the user
// can pay with card / Apple Pay / Google Pay / FPX inline.

type Order = {
  id:             string;
  order_number:   string;
  total:          number;          // in sen
  status:         string;
  payment_method: string | null;
  store_id:       string;
};

export default function PayPage(props: { params: Promise<{ orderId: string }> }) {
  const { orderId }    = use(props.params);
  const router         = useRouter();
  const searchParams   = useSearchParams();
  const fromApp        = searchParams.get("from") === "app";

  const [order,        setOrder]        = useState<Order | null>(null);
  const [clientSecret, setClientSecret] = useState<string | null>(null);
  const [loadError,    setLoadError]    = useState<string | null>(null);
  const [confirming,   setConfirming]   = useState(false);
  const [confirmFn,    setConfirmFn]    = useState<(() => Promise<{ error?: { message?: string } }>) | null>(null);
  const [error,        setError]        = useState<string | null>(null);

  // Step 1: fetch order so we can show the total and decide what to do.
  // If the order is already past pending we route the user straight to the
  // tracking page — no point paying twice.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(`/api/orders/${orderId}`);
        if (!res.ok) throw new Error(`Order lookup failed (${res.status})`);
        const data: Order = await res.json();
        if (cancelled) return;
        setOrder(data);

        if (data.status !== "pending") {
          router.replace(`/order/${orderId}`);
          return;
        }

        // Step 2: ask the server for a PaymentIntent for this order.
        const piRes = await fetch("/api/checkout/create-payment-intent", {
          method:  "POST",
          headers: { "Content-Type": "application/json" },
          body:    JSON.stringify({ orderId }),
        });
        if (!piRes.ok) throw new Error(`Couldn't start payment (${piRes.status})`);
        const piData = await piRes.json() as { clientSecret?: string; error?: string };
        if (!piData.clientSecret) throw new Error(piData.error || "No client secret");
        if (cancelled) return;
        setClientSecret(piData.clientSecret);
      } catch (e: unknown) {
        if (cancelled) return;
        setLoadError(e instanceof Error ? e.message : "Failed to load order");
      }
    })();
    return () => { cancelled = true; };
  }, [orderId, router]);

  const handleReady = useCallback(
    (fn: () => Promise<{ error?: { message?: string } }>) => { setConfirmFn(() => fn); },
    []
  );

  const handlePay = async () => {
    if (!confirmFn) return;
    setConfirming(true);
    setError(null);
    try {
      const result = await confirmFn();
      if (result.error?.message) {
        setError(result.error.message);
        setConfirming(false);
        return;
      }
      // Success — confirmFn already POST'd /confirm-stripe so the order is
      // already moving to "preparing". Send the user to the tracking page.
      router.replace(`/order/${orderId}?payment=done`);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Payment failed");
      setConfirming(false);
    }
  };

  // Stripe's PaymentMethod naming differs from our internal codes
  const stripeMethod = (() => {
    const m = (order?.payment_method ?? "card").toLowerCase();
    if (m === "ewallet") return "grabpay";
    return m;
  })();

  const totalRm = ((order?.total ?? 0) / 100).toFixed(2);

  return (
    <div className="flex flex-col min-h-dvh bg-[#f5f5f5]">
      <header className="bg-[#160800] text-white px-4 pt-12 pb-5">
        <div className="flex items-center gap-3">
          {!fromApp && (
            <button
              type="button"
              onClick={() => router.back()}
              className="p-1 active:opacity-60"
              aria-label="Back"
            >
              <ArrowLeft className="h-5 w-5" />
            </button>
          )}
          <div className="flex-1">
            <p className="text-[10px] uppercase tracking-widest text-white/50">Pay for order</p>
            <h1 className="text-lg font-bold mt-0.5">
              {order ? `#${order.order_number}` : "Loading…"}
            </h1>
          </div>
          <div className="text-right">
            <p className="text-[10px] uppercase tracking-widest text-white/50">Total</p>
            <p className="text-lg font-bold mt-0.5">RM{totalRm}</p>
          </div>
        </div>
      </header>

      <main className="flex-1 px-4 pt-4 pb-24">
        {loadError && (
          <div className="bg-red-50 border border-red-200 text-red-700 text-sm rounded-xl p-4">
            {loadError}
          </div>
        )}

        {!loadError && (!order || !clientSecret) && (
          <div className="flex items-center justify-center py-12 text-muted-foreground">
            <Loader2 className="h-5 w-5 animate-spin mr-2" />
            <span className="text-sm">Preparing checkout…</span>
          </div>
        )}

        {order && clientSecret && (
          <div className="bg-white rounded-2xl border border-gray-200 p-4">
            <StripePaymentForm
              clientSecret={clientSecret}
              orderId={orderId}
              paymentMethod={stripeMethod}
              onReady={handleReady}
            />
            {error && (
              <p className="mt-3 text-xs text-red-600">{error}</p>
            )}
          </div>
        )}
      </main>

      {order && clientSecret && (
        <div className="fixed bottom-0 left-0 right-0 bg-white border-t border-gray-200 px-4 pt-3 pb-6">
          <button
            type="button"
            onClick={handlePay}
            disabled={!confirmFn || confirming}
            className="w-full bg-[#160800] text-white rounded-full py-3.5 font-bold text-sm flex items-center justify-center gap-2 disabled:opacity-50"
          >
            {confirming ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin" />
                Processing…
              </>
            ) : (
              <>Pay RM{totalRm}</>
            )}
          </button>
        </div>
      )}
    </div>
  );
}
