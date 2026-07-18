import "../global.css";
import "@/lib/register-customer-display";
import CustomerDisplayNative from "@/modules/customer-display";
import { Stack } from "expo-router";
import { StatusBar } from "expo-status-bar";
import { SafeAreaProvider } from "react-native-safe-area-context";
import { GestureHandlerRootView } from "react-native-gesture-handler";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useEffect } from "react";
import { Text, TextInput, View } from "react-native";
import * as SplashScreen from "expo-splash-screen";
import * as SystemUI from "expo-system-ui";
import * as NavigationBar from "expo-navigation-bar";
import { useKeepAwake } from "expo-keep-awake";
import { useFonts } from "expo-font";
import {
  SpaceGrotesk_400Regular,
  SpaceGrotesk_500Medium,
  SpaceGrotesk_600SemiBold,
  SpaceGrotesk_700Bold,
} from "@expo-google-fonts/space-grotesk";
import * as Sentry from "@sentry/react-native";

// Crash + error reporting for the till. Crashes/errors from any outlet's
// register report to the dashboard with app + OTA channel tagged, so a
// regression from a specific update group is traceable.
//
// DSN precedence: a build-time EXPO_PUBLIC_SENTRY_DSN wins; otherwise we fall
// back to an embedded DSN so crash capture WORKS over OTA without depending on
// an EAS secret (which had never been set — Sentry.init was a permanent no-op,
// so the till reported nothing). Sentry DSNs are publishable — they ship in
// every client bundle — so embedding one is safe.
//
// INTERIM: the fallback points at the shared `celsius-ops` project (events are
// tagged app:pos-native below, so they filter cleanly). Creating a dedicated
// `celsius-pos-native` project is org-owner-only; once it exists, swap its DSN
// in here or set EXPO_PUBLIC_SENTRY_DSN in the EAS build.
const FALLBACK_SENTRY_DSN =
  "https://37f0a20903a2e28f4f7ec19b46ff5931@o4511247029043200.ingest.us.sentry.io/4511247091630080";
// Dev / Expo Go must NOT fall back — red-box errors and 100%-sampled dev traces
// would land in the shared production project. Dev only reports when a DSN is
// deliberately provided via env.
const SENTRY_DSN = process.env.EXPO_PUBLIC_SENTRY_DSN ?? (__DEV__ ? "" : FALLBACK_SENTRY_DSN);
if (SENTRY_DSN) {
  Sentry.init({
    dsn:                SENTRY_DSN,
    environment:        __DEV__ ? "development" : "production",
    enableNative:       true,
    tracesSampleRate:   __DEV__ ? 1.0 : 0.1,
    profilesSampleRate: 0,
    initialScope: {
      tags: {
        app:     "pos-native",
        channel: process.env.EXPO_PUBLIC_RELEASE_CHANNEL ?? "production",
      },
    },
  });
}

SplashScreen.preventAutoHideAsync();
SystemUI.setBackgroundColorAsync("#160800");

const queryClient = new QueryClient({
  defaultOptions: { queries: { staleTime: 60_000, retry: 1 } },
});

// Default every Text/TextInput to Space Grotesk (the POS reads as a
// data-dense till — numerals + labels want the grotesk, not the Peachi
// display face which we apply explicitly on headings). Also pins text
// scaling at 1.0 — a fixed-layout register must not reflow when the
// device font size is bumped.
function applyDefaultFont() {
  const TextAny = Text as any;
  const InputAny = TextInput as any;
  TextAny.defaultProps = TextAny.defaultProps || {};
  InputAny.defaultProps = InputAny.defaultProps || {};
  TextAny.defaultProps.style = [{ fontFamily: "SpaceGrotesk_400Regular" }, TextAny.defaultProps.style];
  TextAny.defaultProps.allowFontScaling = false;
  InputAny.defaultProps.allowFontScaling = false;
}

function RootLayout() {
  // Register hardware must never sleep mid-shift.
  useKeepAwake();

  const [fontsLoaded] = useFonts({
    "Peachi-Bold": require("../assets/fonts/Peachi-Bold.otf"),
    "Peachi-Medium": require("../assets/fonts/Peachi-Medium.otf"),
    "Peachi-Regular": require("../assets/fonts/Peachi-Regular.otf"),
    SpaceGrotesk_400Regular,
    SpaceGrotesk_500Medium,
    SpaceGrotesk_600SemiBold,
    SpaceGrotesk_700Bold,
  });

  // Kiosk: hide the Android navigation bar so the POS owns the full
  // screen (the SUNMI taskbar + nav buttons otherwise eat the bottom
  // ~90px and clip the keypad). overlay-swipe lets staff swipe it back
  // temporarily if they ever need Android, then it auto-hides.
  useEffect(() => {
    NavigationBar.setVisibilityAsync("hidden").catch(() => {});
    NavigationBar.setBehaviorAsync("overlay-swipe").catch(() => {});
  }, []);

  useEffect(() => {
    if (fontsLoaded) {
      applyDefaultFont();
      SplashScreen.hideAsync();
      // Mount the customer-facing screen on the SUNMI's secondary display
      // (no-op on single-screen devices / where the module isn't present).
      // Small delay lets the React host settle before we spin a 2nd surface.
      setTimeout(() => { CustomerDisplayNative?.present().catch(() => {}); }, 800);
    }
  }, [fontsLoaded]);

  if (!fontsLoaded) {
    return <View className="flex-1 bg-espresso" />;
  }

  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <SafeAreaProvider>
        <QueryClientProvider client={queryClient}>
          <StatusBar hidden style="light" />
          <Stack
            screenOptions={{
              headerShown: false,
              contentStyle: { backgroundColor: "#160800" },
              animation: "fade",
            }}
          />
        </QueryClientProvider>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}

// Sentry.wrap captures uncaught errors in the React tree + ties them to the
// active session. No-op when no DSN is configured.
export default Sentry.wrap(RootLayout);
