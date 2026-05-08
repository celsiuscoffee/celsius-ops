import { useEffect } from "react";
import { View } from "react-native";
import { router, useLocalSearchParams } from "expo-router";
import { useStripe } from "@stripe/stripe-react-native";
import { CelsiusLoader } from "../components/CelsiusLoader";

/**
 * Stripe redirect interceptor.
 *
 * After an FPX / 3DS bank flow approves a payment, Stripe sends the
 * customer back to `celsiuscoffee://stripe-redirect?payment_intent=...
 * &redirect_status=succeeded`. Without an explicit route for this path,
 * expo-router renders its [+not-found] fallback ("Unmatched Route") and
 * the user thinks payment failed.
 *
 * This component:
 *   1. Hands the URL to the Stripe SDK so PaymentSheet's awaiting
 *      promise resolves on the previous screen (handleURLCallback also
 *      runs in StripeUrlHandler at the root, so this is belt-and-braces).
 *   2. Navigates the user to the orders list — when payment_intent
 *      succeeded, their just-paid order will be visible there as
 *      "preparing". Cancel / failure also routes there so they can
 *      retry from order detail if needed.
 */
export default function StripeRedirect() {
  const params = useLocalSearchParams<{ redirect_status?: string }>();
  const { handleURLCallback } = useStripe();

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        // Reconstruct the original URL so the Stripe SDK can parse it.
        const search = new URLSearchParams(
          Object.entries(params).reduce<Record<string, string>>((acc, [k, v]) => {
            if (typeof v === "string") acc[k] = v;
            return acc;
          }, {})
        ).toString();
        const url = `celsiuscoffee://stripe-redirect${search ? `?${search}` : ""}`;
        await handleURLCallback(url);
      } catch {
        // Stripe SDK rejects unknown payloads — fine, we still route home.
      }
      if (cancelled) return;
      router.replace("/orders");
    })();
    return () => {
      cancelled = true;
    };
  }, [params, handleURLCallback]);

  return (
    <View style={{ flex: 1, alignItems: "center", justifyContent: "center", backgroundColor: "#FFFFFF" }}>
      <CelsiusLoader size="md" />
    </View>
  );
}
