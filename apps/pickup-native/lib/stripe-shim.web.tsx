// Web counterpart of @stripe/stripe-react-native — exposes the same
// `useStripe()` API surface used by app/checkout.tsx and app/order/[id].tsx
// so call-sites don't have to branch on Platform.OS.
//
// Native uses Stripe's PaymentSheet (Apple Pay / Google Pay native UI).
// Web mounts a Stripe.js Elements modal with a PaymentElement inside a
// portal-style overlay. The shim translates the imperative
// initPaymentSheet/presentPaymentSheet pair into Promise-resolving
// imperative handles that the overlay component listens to.

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import type { ReactNode } from "react";
import { Elements, PaymentElement, useElements, useStripe as useStripeJs } from "@stripe/react-stripe-js";
import { loadStripe, type Stripe } from "@stripe/stripe-js";

type InitArgs = {
  merchantDisplayName?: string;
  paymentIntentClientSecret: string;
  applePay?: unknown;
  googlePay?: unknown;
  defaultBillingDetails?: { phone?: string; email?: string; name?: string };
  returnURL?: string;
  allowsDelayedPaymentMethods?: boolean;
};

type PresentResult =
  | { error: undefined; paymentOption?: unknown }
  | { error: { code: string; message: string }; paymentOption?: undefined };

type ShimState = {
  init: (args: InitArgs) => void;
  present: () => Promise<PresentResult>;
};

const ShimContext = createContext<ShimState | null>(null);

const PUBLISHABLE_KEY = process.env.EXPO_PUBLIC_STRIPE_PUBLISHABLE_KEY ?? "";
let stripePromise: Promise<Stripe | null> | null = null;
function getStripe(): Promise<Stripe | null> {
  if (!stripePromise) {
    stripePromise = PUBLISHABLE_KEY ? loadStripe(PUBLISHABLE_KEY) : Promise.resolve(null);
  }
  return stripePromise;
}

export function StripeProvider({
  children,
}: {
  children: ReactNode;
  // Native StripeProvider props — accepted and ignored on web; the
  // publishable key is read straight from EXPO_PUBLIC_STRIPE_PUBLISHABLE_KEY
  // by Stripe.js's loadStripe call.
  publishableKey?: string;
  merchantIdentifier?: string;
  urlScheme?: string;
}) {
  const [pendingInit, setPendingInit] = useState<InitArgs | null>(null);
  const [isOpen, setIsOpen] = useState(false);
  const resolverRef = useRef<((r: PresentResult) => void) | null>(null);

  const init = useCallback((args: InitArgs) => {
    setPendingInit(args);
  }, []);

  const present = useCallback((): Promise<PresentResult> => {
    return new Promise((resolve) => {
      if (!pendingInit) {
        resolve({ error: { code: "Failed", message: "PaymentSheet not initialised" } });
        return;
      }
      resolverRef.current = resolve;
      setIsOpen(true);
    });
  }, [pendingInit]);

  const handleResult = useCallback((result: PresentResult) => {
    setIsOpen(false);
    const r = resolverRef.current;
    resolverRef.current = null;
    setPendingInit(null);
    r?.(result);
  }, []);

  const ctx = useMemo<ShimState>(() => ({ init, present }), [init, present]);

  return (
    <ShimContext.Provider value={ctx}>
      {children}
      {isOpen && pendingInit ? (
        <WebPaymentOverlay args={pendingInit} onResult={handleResult} />
      ) : null}
    </ShimContext.Provider>
  );
}

export function useStripe() {
  const ctx = useContext(ShimContext);
  return useMemo(
    () => ({
      // Mirrors initPaymentSheet — fire-and-forget; resolves immediately.
      initPaymentSheet: async (args: InitArgs) => {
        ctx?.init(args);
        return { error: undefined as undefined | { code: string; message: string } };
      },
      // Opens the modal; resolves when the user completes or cancels.
      presentPaymentSheet: async (): Promise<PresentResult> => {
        if (!ctx) return { error: { code: "Failed", message: "Stripe shim unmounted" } };
        return ctx.present();
      },
      confirmPaymentSheetPayment: async (): Promise<PresentResult> => {
        return { error: undefined };
      },
      handleURLCallback: async () => false,
      confirmPayment: async () => ({
        error: { message: "confirmPayment not supported on web — use the payment sheet" },
        paymentIntent: undefined,
      }),
    }),
    [ctx],
  );
}

// ── Overlay implementation ─────────────────────────────────────────────

function WebPaymentOverlay({
  args,
  onResult,
}: {
  args: InitArgs;
  onResult: (r: PresentResult) => void;
}) {
  const [stripeInstance, setStripeInstance] = useState<Stripe | null>(null);
  useEffect(() => {
    let mounted = true;
    getStripe().then((s) => {
      if (mounted) setStripeInstance(s);
    });
    return () => {
      mounted = false;
    };
  }, []);

  // Lock body scroll while the modal is open — RN-web's <ScrollView>
  // host element doesn't block native scrolling otherwise.
  useEffect(() => {
    if (typeof document === "undefined") return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prev;
    };
  }, []);

  if (!stripeInstance) {
    return (
      <div style={overlayStyle}>
        <div style={cardStyle}>
          <div style={{ color: "#fff", textAlign: "center", padding: 24 }}>
            Loading payment…
          </div>
        </div>
      </div>
    );
  }

  return (
    <div style={overlayStyle}>
      <div style={cardStyle}>
        <Elements
          stripe={stripeInstance}
          options={{
            clientSecret: args.paymentIntentClientSecret,
            appearance: {
              theme: "night",
              variables: {
                colorPrimary: "#A2492C",
                colorBackground: "#1A0200",
                colorText: "#ffffff",
                fontFamily:
                  "SpaceGrotesk_400Regular, -apple-system, system-ui, sans-serif",
                borderRadius: "12px",
              },
            },
            paymentMethodCreation: "manual",
          }}
        >
          <PaymentForm args={args} onResult={onResult} />
        </Elements>
      </div>
    </div>
  );
}

function PaymentForm({
  args,
  onResult,
}: {
  args: InitArgs;
  onResult: (r: PresentResult) => void;
}) {
  const stripe = useStripeJs();
  const elements = useElements();
  const [submitting, setSubmitting] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [ready, setReady] = useState(false);

  const handleClose = () => {
    if (submitting) return;
    onResult({ error: { code: "Canceled", message: "User cancelled" } });
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!stripe || !elements) return;
    setSubmitting(true);
    setErrorMessage(null);
    try {
      const submit = await elements.submit();
      if (submit.error) {
        setErrorMessage(submit.error.message ?? "Please check your payment details.");
        setSubmitting(false);
        return;
      }
      const { error, paymentIntent } = await stripe.confirmPayment({
        elements,
        clientSecret: args.paymentIntentClientSecret,
        confirmParams: {
          return_url: args.returnURL?.startsWith("http")
            ? args.returnURL
            : (typeof window !== "undefined"
                ? `${window.location.origin}/stripe-redirect`
                : "https://order.celsiuscoffee.com/stripe-redirect"),
          payment_method_data: args.defaultBillingDetails?.phone
            ? { billing_details: { phone: args.defaultBillingDetails.phone } }
            : undefined,
        },
        redirect: "if_required",
      });
      if (error) {
        if (error.type === "validation_error") {
          setErrorMessage(error.message ?? "Please check your payment details.");
          setSubmitting(false);
          return;
        }
        onResult({
          error: {
            code: error.code ?? "Failed",
            message: error.message ?? "Payment failed",
          },
        });
        return;
      }
      if (paymentIntent && (paymentIntent.status === "succeeded" || paymentIntent.status === "processing")) {
        onResult({ error: undefined });
        return;
      }
      onResult({
        error: { code: "Failed", message: "Payment did not complete" },
      });
    } catch (err: any) {
      onResult({
        error: { code: "Failed", message: err?.message ?? "Payment error" },
      });
    }
  };

  return (
    <form onSubmit={handleSubmit} style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <div style={{ color: "#fff", fontWeight: 600, fontSize: 18 }}>Pay</div>
        <button
          type="button"
          onClick={handleClose}
          disabled={submitting}
          style={{
            background: "transparent",
            border: "none",
            color: "#fff",
            fontSize: 22,
            cursor: submitting ? "not-allowed" : "pointer",
            opacity: submitting ? 0.4 : 1,
          }}
          aria-label="Close"
        >
          ×
        </button>
      </div>
      <PaymentElement
        onReady={() => setReady(true)}
        options={{ layout: "tabs" }}
      />
      {errorMessage ? (
        <div style={{ color: "#ff8b78", fontSize: 14 }}>{errorMessage}</div>
      ) : null}
      <button
        type="submit"
        disabled={!stripe || !elements || !ready || submitting}
        style={{
          background: "#A2492C",
          color: "#fff",
          fontWeight: 600,
          fontSize: 16,
          padding: "14px 0",
          borderRadius: 12,
          border: "none",
          cursor: submitting ? "wait" : "pointer",
          opacity: !stripe || !elements || !ready || submitting ? 0.6 : 1,
          marginTop: 4,
        }}
      >
        {submitting ? "Processing…" : "Pay now"}
      </button>
    </form>
  );
}

const overlayStyle: React.CSSProperties = {
  position: "fixed",
  inset: 0,
  background: "rgba(0,0,0,0.7)",
  display: "flex",
  alignItems: "flex-end",
  justifyContent: "center",
  zIndex: 99999,
  padding: 16,
};

const cardStyle: React.CSSProperties = {
  background: "#1A0200",
  borderRadius: 16,
  padding: 24,
  width: "100%",
  maxWidth: 480,
  maxHeight: "85vh",
  overflowY: "auto",
  boxShadow: "0 -8px 32px rgba(0,0,0,0.6)",
};
