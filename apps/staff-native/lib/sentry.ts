import * as Sentry from "@sentry/react-native";
import * as Updates from "expo-updates";
import { RELEASE_CHANNEL, SENTRY_DSN } from "./env";

export function initSentry() {
  if (!SENTRY_DSN) return;
  Sentry.init({
    dsn: SENTRY_DSN,
    environment: __DEV__ ? "development" : "production",
    enableNative: true,
    tracesSampleRate: __DEV__ ? 1.0 : 0.1,
    profilesSampleRate: 0,
    // Shared celsius-ops project also holds the web apps' events, so tag every
    // native event app=staff-native + set dist so RN crashes filter apart.
    //
    // channel: prefer the RUNTIME expo-updates channel over the build-time env
    // var. RELEASE_CHANNEL is inlined at bundle time and silently falls back to
    // "preview" when EXPO_PUBLIC_RELEASE_CHANNEL is missing from the publish
    // environment, which mislabelled production crashes as preview (seen on the
    // Jul 8 AllowanceBar event). Updates.channel is what the device is actually
    // subscribed to; it's null in dev/embedded launches, where the env fallback
    // is fine.
    initialScope: {
      tags: { channel: Updates.channel ?? RELEASE_CHANNEL, app: "staff-native" },
    },
    dist: "staff-native",
  });
}

export { Sentry };
