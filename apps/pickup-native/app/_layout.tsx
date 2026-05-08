import "../global.css";
import { Stack, router } from "expo-router";
import { StatusBar } from "expo-status-bar";
import { SafeAreaProvider } from "react-native-safe-area-context";
import { GestureHandlerRootView } from "react-native-gesture-handler";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { StripeProvider } from "@stripe/stripe-react-native";
import { useEffect, useState } from "react";
import { Text, TextInput, View } from "react-native";
import * as SplashScreen from "expo-splash-screen";
import * as SystemUI from "expo-system-ui";
import * as Notifications from "expo-notifications";
import { useFonts } from "expo-font";
import { SplashPoster } from "../components/SplashPoster";
import { LogoIntro } from "../components/LogoIntro";
import { MaintenanceBanner } from "../components/MaintenanceBanner";
import { StripeUrlHandler } from "../components/StripeUrlHandler";
import { RootErrorBoundary } from "../components/RootErrorBoundary";
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

  // Cold-launch sequence:
  //   1. <LogoIntro />     ← brand animation (~1.7s)
  //   2. <SplashPoster />  ← backoffice-managed promo image
  //   3. App content
  const [showLogo, setShowLogo] = useState(true);
  const [showSplash, setShowSplash] = useState(true);

  useEffect(() => {
    // Hand off from native iOS launch screen to our JS splash as fast as
    // possible — the poster image renders fine without fonts loaded.
    SplashScreen.hideAsync().catch(() => {});
  }, []);

  // Eager OTA fetch + reload on cold launch.
  //
  // Expo's default ON_LOAD behavior fetches the new bundle in the
  // background and applies it on the NEXT cold launch — meaning users
  // need to restart the app twice after a publish to see changes. That
  // confuses customers and turned shipping iterations into a "cold-launch
  // twice" call-and-response. With this hook, we proactively check on
  // mount, fetch if there's a newer bundle, then reload so the user
  // boots into the new code on this same launch.
  //
  // Lazy require + try/catch keeps dev / Expo Go safe (no native module).
  // RootErrorBoundary handles the "new bundle is broken" case by reverting.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const Updates = require("expo-updates") as typeof import("expo-updates");
        if (__DEV__) return;
        const check = await Updates.checkForUpdateAsync();
        if (cancelled || !check.isAvailable) return;
        const fetched = await Updates.fetchUpdateAsync();
        if (cancelled || !fetched.isNew) return;
        await Updates.reloadAsync();
      } catch {
        // No expo-updates available / network down / etc. — fall back to
        // Expo's default ON_LOAD behavior which applies on next cold launch.
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (loaded) {
      applyDefaultFont();
      SystemUI.setBackgroundColorAsync("#FFFFFF");
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
    <GestureHandlerRootView style={{ flex: 1 }}>
    <SafeAreaProvider>
      <StripeProvider
        publishableKey={process.env.EXPO_PUBLIC_STRIPE_PUBLISHABLE_KEY ?? ""}
        merchantIdentifier={
          process.env.EXPO_PUBLIC_STRIPE_MERCHANT_IDENTIFIER ??
          "merchant.com.celsiuscoffee.pickup"
        }
        urlScheme="celsiuscoffee"
      >
        <StripeUrlHandler />
        <QueryClientProvider client={queryClient}>
          <RootErrorBoundary>
            <StatusBar style="light" />
            <View style={{ flex: 1, backgroundColor: "#160800" }}>
              {loaded && (
                <>
                  <Stack
                    screenOptions={{
                      headerShown: false,
                      contentStyle: { backgroundColor: "#FFFFFF" },
                      animation: "slide_from_right",
                    }}
                  >
                    {/* Bottom-tab roots cross-fade — sibling routes shouldn't
                        slide as if hierarchical. Drill-down pushes (product
                        detail, order detail, etc.) keep the default slide. */}
                    <Stack.Screen name="index" options={{ animation: "fade" }} />
                    <Stack.Screen name="menu" options={{ animation: "fade" }} />
                    <Stack.Screen name="orders" options={{ animation: "fade" }} />
                    <Stack.Screen name="rewards" options={{ animation: "fade" }} />
                    <Stack.Screen name="account" options={{ animation: "fade" }} />
                  </Stack>
                  <MaintenanceBanner />
                </>
              )}
              {!showLogo && showSplash && (
                <SplashPoster onDone={() => setShowSplash(false)} />
              )}
              {showLogo && <LogoIntro onDone={() => setShowLogo(false)} />}
            </View>
          </RootErrorBoundary>
        </QueryClientProvider>
      </StripeProvider>
    </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}
