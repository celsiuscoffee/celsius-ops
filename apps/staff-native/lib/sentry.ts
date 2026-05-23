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
    initialScope: {
      tags: { channel: RELEASE_CHANNEL },
    },
  });
}

export { Sentry };
