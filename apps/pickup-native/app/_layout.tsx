import "../global.css";
import { Stack, router } from "expo-router";
import { StatusBar } from "expo-status-bar";
import { SafeAreaProvider } from "react-native-safe-area-context";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { StripeProvider } from "@stripe/stripe-react-native";
import { useEffect, useState } from "react";
import { Text, TextInput, View } from "react-native";
import * as SplashScreen from "expo-splash-screen";
import * as SystemUI from "expo-system-ui";
import * as Notifications from "expo-notifications";
import { useFonts } from "expo-font";
import { SplashPoster } from "../components/SplashPoster";
import { MaintenanceBanner } from "../components/MaintenanceBanner";
import { registerForPush } from "../lib/notifications";
import { useApp } from "../lib/store";
import {
  SpaceGrotesk_400Regular,
  SpaceGrotesk_500Medium,
  SpaceGrotesk_600SemiBold,
  SpaceGrotesk_700Bold,
} from "@expo-google-fonts/space-grotesk";

SplashScreen.preventAutoHideAsync();

const queryClient = new QueryClient({
  defaultOptions: {
    queries: { staleTime: 60_000, retry: 1 },
  },
});

// Peachi is the brand voice — default font for every Text/TextInput.
// Use Space Grotesk explicitly on body/long-form text for readability.
function applyDefaultFont() {
  const TextAny = Text as any;
  const InputAny = TextInput as any;
  TextAny.defaultProps = TextAny.defaultProps || {};
  InputAny.defaultProps = InputAny.defaultProps || {};
  TextAny.defaultProps.style = [
    { fontFamily: "Peachi-Medium" },
    TextAny.defaultProps.style,
  ];
  InputAny.defaultProps.style = [
    { fontFamily: "Peachi-Medium" },
    InputAny.defaultProps.style,
  ];
}

export default function RootLayout() {
  const [loaded] = useFonts({
    "Peachi-Regular": require("../assets/fonts/Peachi-Regular.otf"),
    "Peachi-Medium": require("../assets/fonts/Peachi-Medium.otf"),
    "Peachi-Bold": require("../assets/fonts/Peachi-Bold.otf"),
    SpaceGrotesk_400Regular,
    SpaceGrotesk_500Medium,
    SpaceGrotesk_600SemiBold,
    SpaceGrotesk_700Bold,
  });

  // Show the backoffice-managed promo poster on cold launch only.
  // Mounts immediately (covers font + JS bundle load), dismisses after
  // duration_ms or on user tap.
  const [showSplash, setShowSplash] = useState(true);

  useEffect(() => {
    // Hand off from native iOS launch screen to our JS splash as fast as
    // possible — the poster image renders fine without fonts loaded.
    SplashScreen.hideAsync().catch(() => {});
  }, []);

  useEffect(() => {
    if (loaded) {
      applyDefaultFont();
      SystemUI.setBackgroundColorAsync("#f5f5f5");
    }
  }, [loaded]);

  // Push notifications: register the device with the server so order-ready
  // pushes can target this user. Re-runs whenever the signed-in phone
  // changes; cached fingerprint inside registerForPush prevents redundant
  // network calls. Subscribe to taps so notifications deep-link into the
  // order page.
  const phone = useApp((s) => s.phone);
  const member = useApp((s) => s.member);
  useEffect(() => {
    registerForPush({ phone, memberId: member?.id ?? null }).catch(() => {});
  }, [phone, member?.id]);

  useEffect(() => {
    const sub = Notifications.addNotificationResponseReceivedListener((res) => {
      const data = res.notification.request.content.data as { orderId?: string } | undefined;
      if (data?.orderId) {
        router.push({ pathname: "/order/[id]", params: { id: data.orderId } });
      }
    });
    return () => sub.remove();
  }, []);

  return (
    <SafeAreaProvider>
      <StripeProvider
        publishableKey={process.env.EXPO_PUBLIC_STRIPE_PUBLISHABLE_KEY ?? ""}
        merchantIdentifier={process.env.EXPO_PUBLIC_STRIPE_MERCHANT_IDENTIFIER}
        urlScheme="celsiuscoffee"
      >
        <QueryClientProvider client={queryClient}>
          <StatusBar style="light" />
          <View style={{ flex: 1, backgroundColor: "#160800" }}>
            {loaded && (
              <>
                <Stack
                  screenOptions={{
                    headerShown: false,
                    contentStyle: { backgroundColor: "#f5f5f5" },
                    animation: "slide_from_right",
                  }}
                />
                <MaintenanceBanner />
              </>
            )}
            {showSplash && <SplashPoster onDone={() => setShowSplash(false)} />}
          </View>
        </QueryClientProvider>
      </StripeProvider>
    </SafeAreaProvider>
  );
}
