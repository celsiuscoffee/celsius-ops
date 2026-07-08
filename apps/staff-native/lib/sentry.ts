import * as Sentry from "@sentry/react-native";
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
    initialScope: {
      tags: { channel: RELEASE_CHANNEL, app: "staff-native" },
    },
    dist: "staff-native",
  });
}

export { Sentry };
