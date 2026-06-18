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
    // Reusing the celsius-ops project (which also holds web/backoffice events),
    // so tag every native event with app=staff-native for clean filtering, and
    // set dist so RN crashes group apart from web releases sharing a version.
    initialScope: {
      tags: { channel: RELEASE_CHANNEL, app: "staff-native" },
    },
    dist: "staff-native",
  });
}

export { Sentry };
