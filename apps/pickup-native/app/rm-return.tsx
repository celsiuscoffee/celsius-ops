import { useEffect } from "react";
import { View } from "react-native";
import { router } from "expo-router";
import { CelsiusLoader } from "../components/CelsiusLoader";

/**
 * Revenue Monster redirect interceptor.
 *
 * In Direct Payment Checkout we open the wallet's deep link via
 * `WebBrowser.openAuthSessionAsync(url, "celsiuscoffee://rm-return")`.
 * The browser is meant to dismiss itself when the redirect URL matches —
 * but on iOS (and in some Android browsers) the wallet often closes
 * itself and cold-launches the app via the custom URL scheme instead.
 * Without this route, expo-router renders its "Unmatched Route" fallback
 * and the customer thinks payment failed.
 *
 * We just route to /orders. Webhook + the 5s React Query poll on the
 * order detail screen pick up the actual status; the customer sees the
 * order move from "Awaiting payment" → "Preparing" within seconds.
 */
export default function RmReturn() {
  useEffect(() => {
    router.replace("/orders");
  }, []);

  return (
    <View
      style={{
        flex: 1,
        alignItems: "center",
        justifyContent: "center",
        backgroundColor: "#FFFFFF",
      }}
    >
      <CelsiusLoader size="md" />
    </View>
  );
}
