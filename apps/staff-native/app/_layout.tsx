import "../global.css";
import "../lib/hr/tasks";
import { Stack, router } from "expo-router";
import { StatusBar } from "expo-status-bar";
import { SafeAreaProvider } from "react-native-safe-area-context";
import { GestureHandlerRootView } from "react-native-gesture-handler";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { Text, TextInput, View } from "react-native";
import * as SplashScreen from "expo-splash-screen";
import * as SystemUI from "expo-system-ui";
import * as Notifications from "expo-notifications";
import { useFonts } from "expo-font";
import {
  SpaceGrotesk_400Regular,
  SpaceGrotesk_500Medium,
  SpaceGrotesk_600SemiBold,
  SpaceGrotesk_700Bold,
} from "@expo-google-fonts/space-grotesk";
import { initSentry, Sentry } from "../lib/sentry";
import { loadSession } from "../lib/session";
import { useStaff } from "../lib/store";
import { registerForPush } from "../lib/push";

SplashScreen.preventAutoHideAsync().catch(() => {});
initSentry();

const queryClient = new QueryClient({
  defaultOptions: { queries: { staleTime: 30_000, retry: 1 } },
});

function applyDefaultFont() {
  const TextAny = Text as unknown as { defaultProps?: Record<string, unknown> };
  const InputAny = TextInput as unknown as {
    defaultProps?: Record<string, unknown>;
  };
  TextAny.defaultProps = TextAny.defaultProps ?? {};
  InputAny.defaultProps = InputAny.defaultProps ?? {};
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

function RootLayout() {
  const [loaded] = useFonts({
    "Peachi-Regular": require("../assets/fonts/Peachi-Regular.otf"),
    "Peachi-Medium": require("../assets/fonts/Peachi-Medium.otf"),
    "Peachi-Bold": require("../assets/fonts/Peachi-Bold.otf"),
    SpaceGrotesk_400Regular,
    SpaceGrotesk_500Medium,
    SpaceGrotesk_600SemiBold,
    SpaceGrotesk_700Bold,
  });

  const setSession = useStaff((s) => s.setSession);
  const [sessionHydrated, setSessionHydrated] = useState(false);

  useEffect(() => {
    SplashScreen.hideAsync().catch(() => {});
  }, []);

  useEffect(() => {
    loadSession()
      .then((s) => setSession(s))
      .finally(() => setSessionHydrated(true));
  }, [setSession]);

  useEffect(() => {
    if (loaded) {
      applyDefaultFont();
      SystemUI.setBackgroundColorAsync("#FFFFFF").catch(() => {});
    }
  }, [loaded]);

  const sessionUserId = useStaff((s) => s.session?.userId ?? null);
  useEffect(() => {
    if (!sessionUserId) return;
    registerForPush().catch(() => {});
  }, [sessionUserId]);

  useEffect(() => {
    function routeFromNotification(res: Notifications.NotificationResponse) {
      const data = res.notification.request.content.data as
        | { kind?: string }
        | undefined;
      if (!data) return;
      if (data.kind === "geofence_enter" || data.kind === "geofence_exit") {
        router.push("/(staff)/clock");
      }
    }
    const sub = Notifications.addNotificationResponseReceivedListener(
      routeFromNotification,
    );
    Notifications.getLastNotificationResponseAsync()
      .then((res) => {
        if (res) routeFromNotification(res);
      })
      .catch(() => {});
    return () => sub.remove();
  }, []);

  if (!loaded || !sessionHydrated) {
    return <View style={{ flex: 1, backgroundColor: "#1A0200" }} />;
  }

  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <SafeAreaProvider>
        <QueryClientProvider client={queryClient}>
          <StatusBar style="dark" />
          <Stack
            screenOptions={{
              headerShown: false,
              contentStyle: { backgroundColor: "#FFFFFF" },
              animation: "slide_from_right",
            }}
          />
        </QueryClientProvider>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}

export default Sentry.wrap(RootLayout);
