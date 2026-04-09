"use client";

import { useState, useCallback } from "react";
import { useRouter } from "next/navigation";
import { X, Loader2, ShieldCheck } from "lucide-react";
import { StripePaymentForm } from "./stripe-payment-form";

interface StripePaymentSheetProps {
  clientSecret:  string;
  orderId:       string;
  paymentMethod: string;
  total:         number;   // in RM (e.g. 12.50)
  onSuccess:     () => void;
  onClose:       () => void;
}

const METHOD_LABELS: Record<string, string> = {
  fpx:        "FPX Online Banking",
  apple_pay:  "Apple Pay",
  google_pay: "Google Pay",
  card:       "Credit / Debit Card",
};

export function StripePaymentSheet({
  clientSecret,
  orderId,
  paymentMethod,
  total,
  onSuccess,
  onClose,
}: StripePaymentSheetProps) {
  const router = useRouter();

  const [confirmFn, setConfirmFn] = useState<(() => Promise<{ error?: { message?: string } }>) | null>(null);
  const [loading, setLoading]     = useState(false);
  const [error, setError]         = useState<string | null>(null);

  const handleReady = useCallback(
    (fn: () => Promise<{ error?: { message?: string } }>) => { setConfirmFn(() => fn); },
    []
  );

  async function handlePay() {
    if (!confirmFn) return;
    setLoading(true);
    setError(null);

    const result = await confirmFn();

    if (result.error) {
      setError(result.error.message ?? "Payment failed. Please try again.");
      setLoading(false);
      return;
    }

    // Inline success (card / Apple Pay / Google Pay) — clear cart and navigate.
    // FPX always redirects to the bank, so confirmPayment() never resolves here for FPX;
    // cart is cleared on the order page once we confirm payment status is not failed.
    onSuccess();
    router.push(`/order/${orderId}?payment=done`);
  }

  const methodLabel = METHOD_LABELS[paymentMethod] ?? "Payment";

  return (
    <div className="fixed inset-0 z-50 flex flex-col justify-end">
      {/* Backdrop */}
      <div
        className="absolute inset-0 bg-black/50"
        onClick={!loading ? onClose : undefined}
      />

      {/* Sheet */}
      <div className="relative bg-white rounded-t-3xl max-h-[92vh] flex flex-col max-w-[430px] mx-auto w-full shadow-2xl">

        {/* Handle bar */}
        <div className="flex justify-center pt-3 pb-1 shrink-0">
          <div className="w-10 h-1 bg-gray-200 rounded-full" />
        </div>

        {/* Header */}
        <div className="flex items-center justify-between px-5 pt-2 pb-4 shrink-0 relative z-10">
          <div>
            <h3 className="font-bold text-lg text-[#160800]">Complete Payment</h3>
            <p className="text-xs text-muted-foreground mt-0.5">{methodLabel}</p>
          </div>
          {!loading && (
            <button
              onClick={onClose}
              className="p-2 rounded-full hover:bg-gray-100 transition-colors"
            >
              <X className="h-5 w-5 text-muted-foreground" />
            </button>
          )}
        </div>

        {/* Stripe Elements */}
        <div className="flex-1 overflow-y-auto px-5">
          <StripePaymentForm
            clientSecret={clientSecret}
            paymentMethod={paymentMethod}
            orderId={orderId}
            onReady={handleReady}
          />

          {/* Error */}
          {error && (
            <div className="mt-3 bg-red-50 border border-red-200 rounded-2xl px-4 py-3 text-sm text-red-600">
              {error}
            </div>
          )}
        </div>

        {/* Pay button + security badge */}
        <div className="px-5 pt-3 pb-8 shrink-0 border-t bg-white">
          <button
            onClick={handlePay}
            disabled={!confirmFn || loading}
            className="w-full bg-[#160800] text-white rounded-full py-4 font-bold text-base disabled:opacity-50 flex items-center justify-center gap-2 transition-opacity"
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
          <div className="flex items-center justify-center gap-1.5 mt-3 text-xs text-muted-foreground">
            <ShieldCheck className="h-3.5 w-3.5" />
            <span>Secured by Stripe · SSL encrypted</span>
          </div>
        </div>

      </div>
    </div>
  );
}
