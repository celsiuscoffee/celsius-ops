import "../global.css";
import "@/lib/register-customer-display";
import CustomerDisplayNative from "@/modules/customer-display";
import { PickupPrinterMount } from "@/lib/pickup-printer";
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

export default function RootLayout() {
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
          <PickupPrinterMount />
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
