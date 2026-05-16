import "../global.css";
import { Stack, router } from "expo-router";
import { StatusBar } from "expo-status-bar";
import { SafeAreaProvider } from "react-native-safe-area-context";
import { GestureHandlerRootView } from "react-native-gesture-handler";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { StripeProvider } from "@/lib/stripe-shim";
import { useEffect, useState } from "react";
import { Platform, Text, TextInput, View } from "react-native";
import * as SplashScreen from "expo-splash-screen";
import * as SystemUI from "expo-system-ui";
import * as Notifications from "expo-notifications";
import { useFonts } from "expo-font";
import { SplashPoster } from "../components/SplashPoster";
import { LogoIntro } from "../components/LogoIntro";
import { MaintenanceBanner } from "../components/MaintenanceBanner";
import { StripeUrlHandler } from "../components/StripeUrlHandler";
import { RootErrorBoundary } from "../components/RootErrorBoundary";
import { Toast } from "../components/Toast";
import { registerForPush, trackNotificationOpen } from "../lib/notifications";
import { useApp } from "../lib/store";
import { initAnalytics, identifyMember, clearMember } from "../lib/analytics";
import { fetchRewards, fetchTier, fetchOrderHistory } from "../lib/rewards";
import {
  SpaceGrotesk_400Regular,
  SpaceGrotesk_500Medium,
  SpaceGrotesk_600SemiBold,
  SpaceGrotesk_700Bold,
} from "@expo-google-fonts/space-grotesk";

SplashScreen.preventAutoHideAsync();

// Sentry — crash + error reporting. DSN is sourced from
// EXPO_PUBLIC_SENTRY_DSN at build time and baked into the JS bundle.
// init() is a no-op when DSN is unset, so dev builds without a DSN
// don't crash and forks of the project don't accidentally report to
// this org's Sentry. tracesSampleRate is conservative in prod to keep
// the free-tier event budget intact; bump if you start using perf.
import * as Sentry from "@sentry/react-native";

const SENTRY_DSN = process.env.EXPO_PUBLIC_SENTRY_DSN ?? "";
if (SENTRY_DSN) {
  Sentry.init({
    dsn:                  SENTRY_DSN,
    environment:          __DEV__ ? "development" : "production",
    enableNative:         true,
    tracesSampleRate:     __DEV__ ? 1.0 : 0.1,
    profilesSampleRate:   0,
    // Capture the runtime / OTA channel so a regression introduced by
    // an OTA can be traced back to a specific update group ID.
    initialScope: {
      tags: {
        channel: process.env.EXPO_PUBLIC_RELEASE_CHANNEL ?? "preview",
      },
    },
  });
}

const queryClient = new QueryClient({
  defaultOptions: {
    queries: { staleTime: 60_000, retry: 1 },
  },
});

// Peachi is the brand voice — default font for every Text/TextInput.
// Use Space Grotesk explicitly on body/long-form text for readability.
//
// Also caps text scaling at 1.3× (instead of unlimited) so layouts don't
// shatter when customers have iOS Larger Accessibility Text turned on.
// 1.3 still respects the user's preference noticeably, but our cards,
// pills, and tier-hero overlays were designed against 1.0–1.2× and
// start clipping past that.
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
  TextAny.defaultProps.maxFontSizeMultiplier = 1.3;
  InputAny.defaultProps.maxFontSizeMultiplier = 1.3;
}

// Sentry.wrap captures uncaught errors in the React tree and ties
// them to the active navigation stack. Wrapped at the very root so
// every screen + provider is instrumented.
const RootLayout = function RootLayout() {
  const [loaded] = useFonts({
    "Peachi-Regular": require("../assets/fonts/Peachi-Regular.otf"),
    "Peachi-Medium": require("../assets/fonts/Peachi-Medium.otf"),
    "Peachi-Bold": require("../assets/fonts/Peachi-Bold.otf"),
    SpaceGrotesk_400Regular,
    SpaceGrotesk_500Medium,
    SpaceGrotesk_600SemiBold,
    SpaceGrotesk_700Bold,
  });

  // Cold-launch sequence on native:
  //   1. <LogoIntro />     ← brand animation (~1.7s)
  //   2. <SplashPoster />  ← backoffice-managed promo image
  //   3. App content
  //
  // On web (PWA): skip both. Reanimated v4's worklet timing callbacks
  // don't fire reliably in browser worklet emulation, so LogoIntro can
  // hang full-screen forever, trapping users on the °c logo. Web users
  // also expect instant content — the dramatic intro reads as broken.
  const isWeb = Platform.OS === "web";
  const [showLogo, setShowLogo] = useState(!isWeb);
  const [showSplash, setShowSplash] = useState(!isWeb);

  useEffect(() => {
    // Hand off from native iOS launch screen to our JS splash as fast as
    // possible — the poster image renders fine without fonts loaded.
    SplashScreen.hideAsync().catch(() => {});
  }, []);

  // Amplitude init. No-ops when EXPO_PUBLIC_AMPLITUDE_API_KEY isn't set
  // (which is the case until we drop the key into EAS env vars).
  useEffect(() => {
    initAnalytics().catch(() => {});
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

  // Pre-fetch the data the rewards / account / orders tabs need the
  // moment we know who the customer is — turns "tap tab → spinner →
  // detail" into "tap tab → detail already there". Fires once when
  // phone becomes available, then again whenever the loyalty member
  // id resolves (tier needs that, not just the phone).
  //
  // staleTime is left at the per-query default for these — what we're
  // doing here is *priming* the cache, not pinning it. The tab will
  // still refetch on its own poll cadence; we just gave it a head start.
  const phoneForPrefetch = useApp((s) => s.phone);
  const loyaltyIdForPrefetch = useApp((s) => s.loyaltyId);
  useEffect(() => {
    if (!phoneForPrefetch) return;
    queryClient
      .prefetchQuery({
        queryKey: ["rewards", phoneForPrefetch],
        queryFn: () => fetchRewards(phoneForPrefetch),
      })
      .catch(() => {});
    queryClient
      .prefetchQuery({
        queryKey: ["order-history", phoneForPrefetch],
        queryFn: () => fetchOrderHistory(phoneForPrefetch, 20),
      })
      .catch(() => {});
  }, [phoneForPrefetch]);
  useEffect(() => {
    if (!loyaltyIdForPrefetch) return;
    queryClient
      .prefetchQuery({
        queryKey: ["tier", loyaltyIdForPrefetch],
        queryFn: () => fetchTier(loyaltyIdForPrefetch),
      })
      .catch(() => {});
  }, [loyaltyIdForPrefetch]);

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

  // Tie Amplitude events to the loyalty member id so cohorts /
  // retention / per-user breakdowns work. Reset when the user signs out
  // (member becomes null) so the device anon-id doesn't inherit the
  // previous user's event history.
  useEffect(() => {
    if (member?.id) {
      identifyMember(member.id, {
        name:  member.name ?? null,
        phone: phone ?? null,
      });
    } else if (!phone) {
      clearMember();
    }
  }, [member?.id, member?.name, phone]);

  // memberId is read live inside the handler via useApp.getState() so
  // it always reflects the current signed-in user — using a stale
  // closure value would mean a tap right after sign-in attributed to
  // "no member" and the open-rate stat would undercount.
  useEffect(() => {
    function handleResponse(res: Notifications.NotificationResponse) {
      const data = res.notification.request.content.data as
        | { orderId?: string; deeplink?: string; type?: string }
        | undefined;
      if (!data) return;

      // Stats: mark this campaign send as opened. Best-effort, runs in
      // parallel with deep-link routing so it never delays navigation.
      // Reads the live store snapshot so a tap right after sign-in
      // still attributes to the freshly-signed-in member.
      const liveMember = useApp.getState().member;
      void trackNotificationOpen({ data, memberId: liveMember?.id ?? null });

      // Order-status pushes carry an orderId — route to the order detail.
      if (data.orderId) {
        router.push({ pathname: "/order/[id]", params: { id: data.orderId } });
        return;
      }
      // Rewards v2 pushes carry a `deeplink` like "rewards" or "rewards/vouchers".
      // Map to known routes; everything else falls through to home.
      const link = (data.deeplink ?? "").toLowerCase();
      switch (link) {
        case "rewards":
        case "rewards/challenges":
        case "rewards/vouchers":
        case "rewards/catalog":
          router.push("/rewards" as never);
          break;
        case "referral":
          router.push("/referral" as never);
          break;
        default:
          // No explicit deeplink — fall back to home so the tap still does
          // something useful instead of silently doing nothing.
          if (data.type === "mission_completed" ||
              data.type === "voucher_expiring" ||
              data.type === "reward_expiring" ||
              data.type === "sitting_on_beans" ||
              data.type === "miss_you" ||
              data.type === "tier_at_risk" ||
              data.type === "birthday" ||
              data.type === "claimable_ready" ||
              data.type === "referral_rewarded") {
            router.push("/rewards" as never);
          }
      }
    }

    const sub = Notifications.addNotificationResponseReceivedListener(handleResponse);

    // Cold-start case: the tap that opened the app from a killed state
    // doesn't fire the listener above (the listener is registered too
    // late in the lifecycle). getLastNotificationResponseAsync returns
    // the response that triggered launch — we replay it through the
    // same handler so both the deep-link AND the open-tracking land.
    Notifications.getLastNotificationResponseAsync().then((res) => {
      if (res) handleResponse(res);
    }).catch(() => {});

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
                    {/* Bottom-tab roots — instant swap. Sibling routes
                        shouldn't animate at all; the prior fade looked
                        like lag because the new screen had to wait for
                        the cross-fade timeline before its data could
                        even start rendering. Drill-down pushes (product
                        detail, order detail, etc.) keep the default
                        slide so hierarchy still feels right. */}
                    <Stack.Screen name="index" options={{ animation: "none" }} />
                    <Stack.Screen name="menu" options={{ animation: "none" }} />
                    <Stack.Screen name="orders" options={{ animation: "none" }} />
                    <Stack.Screen name="rewards" options={{ animation: "none" }} />
                    <Stack.Screen name="account" options={{ animation: "none" }} />
                  </Stack>
                  <MaintenanceBanner />
                  {/* Global toast layer — sits above stack content but below
                      the cold-launch logo / splash so it doesn't jitter the
                      first-launch sequence. */}
                  <Toast />
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
};

export default Sentry.wrap(RootLayout);
