// Sentry client-side initialization. Imported automatically by Next.js
// at the start of every browser bundle. Captures unhandled exceptions,
// React rendering errors (when paired with error.tsx / global-error.tsx),
// and provides Sentry.captureException() to call sites.
//
// SENTRY_DSN comes from env. When unset (local dev) Sentry is a no-op
// so we don't pay the bundle / network cost during development.

import * as Sentry from "@sentry/nextjs";

const dsn = process.env.NEXT_PUBLIC_SENTRY_DSN;

if (dsn) {
  Sentry.init({
    dsn,
    environment: process.env.NODE_ENV,
    // Sample 10% of traces in prod, 100% in dev for a clearer picture.
    tracesSampleRate: process.env.NODE_ENV === "production" ? 0.1 : 1.0,
    // Capture replays for 10% of sessions and 100% of error sessions.
    replaysSessionSampleRate: 0.0,
    replaysOnErrorSampleRate: process.env.NODE_ENV === "production" ? 1.0 : 0.0,
    // The default integrations cover global error / unhandled rejection.
    //
    // Mobile Safari throws "SecurityError: The operation is insecure." when
    // Supabase Realtime (@supabase/phoenix) reopens its WebSocket while the
    // page is being backgrounded (visibilitychange); the reconnect succeeds
    // once the tab returns to the foreground, so these events are pure noise
    // (CELSIUS-OPS-4, ~550 events since May). Drop only that exact
    // signature — any other SecurityError still reports.
    beforeSend(event) {
      const ex = event.exception?.values?.[0];
      if (ex?.type === "SecurityError") {
        const frames = ex.stacktrace?.frames ?? [];
        const fromRealtimeReconnect = frames.some(
          (f) =>
            f.filename?.includes("@supabase/phoenix") ||
            f.function?.includes("transportConnect"),
        );
        if (fromRealtimeReconnect) return null;
      }
      return event;
    },
  });
}

// Required for Next.js navigation transactions to be captured.
export const onRouterTransitionStart = Sentry.captureRouterTransitionStart;
