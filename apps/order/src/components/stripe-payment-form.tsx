"use client";

import { useState, useCallback, useEffect } from "react";
import {
  Elements,
  PaymentElement,
  useStripe,
  useElements,
} from "@stripe/react-stripe-js";
import { loadStripe } from "@stripe/stripe-js";
import { Loader2 } from "lucide-react";

// Singleton — created once, outside of renders
let stripePromise: ReturnType<typeof loadStripe> | null = null;
function getStripePromise() {
  const key = process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY;
  if (!key) return null;
  if (!stripePromise) stripePromise = loadStripe(key);
  return stripePromise;
}

// ─── Inner form (must be inside <Elements>) ──────────────────────────────────

interface InnerFormProps {
  paymentMethod: string;
  orderId:       string;
  onConfirmReady: (confirmFn: () => Promise<{ error?: { message?: string } }>) => void;
  onElementReady: () => void;
}

function InnerForm({ paymentMethod, orderId, onConfirmReady, onElementReady }: InnerFormProps) {
  const stripe   = useStripe();
  const elements = useElements();

  useEffect(() => {
    if (!stripe || !elements) return;
    onConfirmReady(async () => {
      const result = await stripe.confirmPayment({
        elements,
        confirmParams: {
          return_url: `${window.location.origin}/order/${orderId}?payment=done`,
        },
        // "if_required": wallets + cards complete inline (no redirect).
        // FPX always redirects to the bank regardless of this setting.
        redirect: "if_required",
      });

      // For inline payments (Apple Pay, Google Pay, card) confirmPayment resolves
      // here with a paymentIntent on success — no redirect, so redirect_status never
      // appears in the URL and the order-page fallback can't fire.
      // Confirm server-side immediately so the order advances to "preparing" before
      // the user navigates to the order page.
      if (!result.error && result.paymentIntent?.id) {
        try {
          await fetch(`/api/orders/${orderId}/confirm-stripe`, {
            method:  "POST",
            headers: { "Content-Type": "application/json" },
            body:    JSON.stringify({ paymentIntentId: result.paymentIntent.id }),
          });
        } catch { /* non-fatal — webhook is the backstop */ }
      }

      return { error: result.error ? { message: result.error.message } : undefined };
    });
  }, [stripe, elements, onConfirmReady, orderId, paymentMethod]);

  // apple_pay / google_pay → accordion showing only the relevant wallet button
  // card / fpx             → tabs (FPX tab shows the bank picker)
  const isWallet = paymentMethod === "apple_pay" || paymentMethod === "google_pay";
  const layout   = isWallet ? "accordion" : "tabs";

  return (
    <PaymentElement
      options={{
        layout,
        defaultValues: { billingDetails: { address: { country: "MY" } } },
        wallets: paymentMethod === "apple_pay"
          ? { applePay: "auto",  googlePay: "never" }
          : paymentMethod === "google_pay"
          ? { applePay: "never", googlePay: "auto"  }
          : { applePay: "never", googlePay: "never" },
      }}
      onReady={onElementReady}
    />
  );
}

// ─── Public wrapper ───────────────────────────────────────────────────────────

interface StripePaymentFormProps {
  clientSecret:  string;
  paymentMethod: string;
  orderId:       string;
  onReady: (confirmFn: () => Promise<{ error?: { message?: string } }>) => void;
}

export function StripePaymentForm({ clientSecret, paymentMethod, orderId, onReady }: StripePaymentFormProps) {
  const stripe = getStripePromise();

  const [confirmFn, setConfirmFn]       = useState<(() => Promise<{ error?: { message?: string } }>) | null>(null);
  const [elementReady, setElementReady] = useState(false);

  const handleConfirmReady = useCallback(
    (fn: () => Promise<{ error?: { message?: string } }>) => { setConfirmFn(() => fn); },
    []
  );
  const handleElementReady = useCallback(() => { setElementReady(true); }, []);

  // Only propagate ready to the parent once both stripe instance + element are ready
  useEffect(() => {
    if (confirmFn && elementReady) onReady(confirmFn);
  }, [confirmFn, elementReady, onReady]);

  if (!stripe) {
    return (
      <p className="text-xs text-red-500 p-3">
        Stripe is not configured. Add NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY to your env.
      </p>
    );
  }

  return (
    <Elements
      stripe={stripe}
      options={{
        clientSecret,
        appearance: {
          theme: "flat",
          variables: {
            colorPrimary:      "#160800",
            colorBackground:   "#ffffff",
            colorText:         "#160800",
            colorDanger:       "#ef4444",
            fontFamily:        "var(--font-space-grotesk), system-ui, sans-serif",
            borderRadius:      "12px",
            fontSizeBase:      "14px",
            spacingUnit:       "4px",
          },
          rules: {
            ".Input": {
              border:     "1.5px solid #e5e7eb",
              padding:    "12px 14px",
              fontSize:   "14px",
              boxShadow:  "none",
            },
            ".Input:focus": {
              border:    "1.5px solid #160800",
              boxShadow: "none",
              outline:   "none",
            },
            ".Label": {
              fontSize:     "11px",
              fontWeight:   "600",
              color:        "#6b7280",
              marginBottom: "6px",
              textTransform: "uppercase",
              letterSpacing: "0.05em",
            },
            ".Tab": {
              border:       "1.5px solid #e5e7eb",
              borderRadius: "12px",
              padding:      "10px 16px",
              boxShadow:    "none",
            },
            ".Tab--selected": {
              border:          "1.5px solid #160800",
              backgroundColor: "#160800",
              color:           "#ffffff",
              boxShadow:       "none",
            },
            ".Tab:hover:not(.Tab--selected)": {
              border:    "1.5px solid #160800",
              color:     "#160800",
              boxShadow: "none",
            },
            ".TabIcon--selected": {
              fill: "#ffffff",
            },
            ".TabLabel--selected": {
              color: "#ffffff",
            },
            ".Block": {
              borderRadius: "12px",
              border:       "1.5px solid #e5e7eb",
            },
          },
        },
      }}
    >
      <div className="pt-1 pb-2">
        {!elementReady && (
          <div className="flex items-center justify-center py-8">
            <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
          </div>
        )}
        <InnerForm
          paymentMethod={paymentMethod}
          orderId={orderId}
          onConfirmReady={handleConfirmReady}
          onElementReady={handleElementReady}
        />
      </div>
    </Elements>
  );
}
