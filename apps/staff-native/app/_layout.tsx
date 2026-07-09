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
import { ErrorBoundary } from "../components/ErrorBoundary";
import {
  clearSession,
  loadSession,
  saveSession,
  type StaffSession,
} from "../lib/session";
import { API_BASE_URL } from "../lib/env";
import { useStaff } from "../lib/store";
import { registerForPush } from "../lib/push";
import { useOtaAutoUpdate } from "../lib/use-ota-auto-update";
import { useColorScheme } from "nativewind";
import { themes, loadColorSchemePref } from "../lib/theme";

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

  // Self-apply OTA updates on foreground so staff devices that stay resident
  // for days don't keep running a stale JS bundle (e.g. an old Sales screen
  // showing a frozen total). Mirrors the pos-native till hook.
  useOtaAutoUpdate();

  // Restore the saved appearance preference (light/dark/system) on
  // launch so the user's choice persists across app restarts.
  const { colorScheme, setColorScheme } = useColorScheme();
  useEffect(() => {
    loadColorSchemePref()
      .then((p) => setColorScheme(p))
      .catch(() => {});
  }, [setColorScheme]);
  const scheme = colorScheme === "dark" ? "dark" : "light";

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
    //   401 here means the cached token is dead, clear everything
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
          // Trust the server response as the source of truth, a null
          // outletId from /api/auth/me is meaningful (means the user
          // had their outlet assignment removed), so we must NOT use
          // nullish coalescing to fall back to the cached value here.
          // We do still keep `cached.token / userId / staffNo / name`
          // because the /api/auth/me payload doesn't include those.
          const merged: StaffSession = {
            ...cached,
            ...(me.role !== undefined ? { role: me.role } : {}),
            ...(me.outletId !== undefined ? { outletId: me.outletId } : {}),
            ...(me.outletName !== undefined
              ? { outletName: me.outletName }
              : {}),
            ...(me.moduleAccess !== undefined
              ? { moduleAccess: me.moduleAccess }
              : {}),
          };
          await saveSession(merged);
          setSession(merged);
        } catch {
          // Network down → keep the cached session; UI still works
          // against cached state, and the next successful request
          // will re-trigger this on the next launch.
        }
      })
      .catch(() => setSession(null))
      .finally(() => setSessionHydrated(true));
  }, [setSession]);

  useEffect(() => {
    if (loaded) {
      applyDefaultFont();
      SystemUI.setBackgroundColorAsync(
        scheme === "dark" ? "#1A0200" : "#FFFFFF",
      ).catch(() => {});
    }
  }, [loaded, scheme]);

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
      const kind = data?.kind;
      if (!kind) return;
      if (kind === "geofence_enter" || kind === "geofence_exit") {
        router.push("/(staff)/clock");
        return;
      }
      // Ops-workspace notifications (mirrors of the WhatsApp ops pulse, tagged by
      // classifyPush in backoffice ops-pulse/sender). Open the most relevant
      // screen; the full detail lives in WhatsApp + the ops inbox.
      switch (kind) {
        case "scoreboard":
          router.push("/(staff)/sales");
          return;
        case "audit":
          router.push("/(staff)/audit");
          return;
        case "reminder":
        case "instruction":
        case "digest":
        case "escalation":
        case "nudge":
        case "ops":
          router.push("/(staff)/home");
          return;
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
    <GestureHandlerRootView style={[{ flex: 1 }, themes[scheme]]}>
      <SafeAreaProvider>
        <QueryClientProvider client={queryClient}>
          <StatusBar style={scheme === "dark" ? "light" : "dark"} />
          <ErrorBoundary>
            <Stack
              screenOptions={{
                headerShown: false,
                contentStyle: {
                  backgroundColor: scheme === "dark" ? "#1A0200" : "#FFFFFF",
                },
                animation: "slide_from_right",
              }}
            />
          </ErrorBoundary>
        </QueryClientProvider>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}

// Outer boundary so a throw in RootLayout's OWN render (fonts, boot wiring)
// during launch shows the recoverable card instead of a white-screen crash.
// the inner boundary around <Stack> only covers the screens below it.
function RootLayoutWithBoundary() {
  return (
    <ErrorBoundary>
      <RootLayout />
    </ErrorBoundary>
  );
}

export default Sentry.wrap(RootLayoutWithBoundary);
