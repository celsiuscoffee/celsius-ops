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
import {
  clearSession,
  loadSession,
  saveSession,
  type StaffSession,
} from "../lib/session";
import { API_BASE_URL } from "../lib/env";
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
    // Two-phase session boot:
    //   1) Load the cached session from disk so the UI can render
    //      immediately without a network round-trip blocking the
    //      splash screen.
    //   2) In the background, hit /api/auth/me to re-fetch the
    //      authoritative role, outletId, outletName, and moduleAccess
    //      from the DB and merge them in. Token stays the same.
    //
    //   Without (2), stale local sessions would persist forever:
    //   role/outlet/moduleAccess changes made in backoffice wouldn't
    //   reach the staff app until the user manually signed out and
    //   back in. That manifests as "wrong data, restart fixes it"
    //   from the user's POV.
    //
    //   401 here means the cached token is dead — clear everything
    //   and let the layout route to /login on next render.
    loadSession()
      .then(async (cached) => {
        setSession(cached);
        if (!cached?.token) return;
        try {
          const res = await fetch(`${API_BASE_URL}/api/auth/me`, {
            headers: { Authorization: `Bearer ${cached.token}` },
          });
          if (res.status === 401) {
            await clearSession();
            setSession(null);
            return;
          }
          if (!res.ok) return;
          const me = (await res.json()) as {
            id?: string;
            role?: string;
            outletId?: string | null;
            outletName?: string | null;
            moduleAccess?: Record<string, unknown>;
          };
          const merged: StaffSession = {
            ...cached,
            role: me.role ?? cached.role,
            outletId: me.outletId ?? cached.outletId,
            outletName: me.outletName ?? cached.outletName,
            moduleAccess: me.moduleAccess ?? cached.moduleAccess,
          };
          await saveSession(merged);
          setSession(merged);
        } catch {
          // Network down → keep the cached session; UI still works
          // against cached state, and the next successful request
          // will re-trigger this on the next launch.
        }
      })
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
