import * as Sentry from "@sentry/nextjs";
import { scrubSentryEvent } from "@celsius/shared";

export function register() {
  const dsn = process.env.SENTRY_DSN;
  if (!dsn) {
    // Deliberately loud: a prod deploy without a DSN means errors are
    // invisible until a customer complains. Not a throw — a missing
    // var must not take the app down with it.
    if (process.env.NODE_ENV === "production") {
      console.error(
        "[sentry] SENTRY_DSN is not set — production errors are NOT being tracked.",
      );
    }
    return;
  }

  Sentry.init({
    dsn,
    environment: process.env.NODE_ENV,
    tracesSampleRate: process.env.NODE_ENV === "production" ? 0.1 : 1.0,
    // Strip JWTs (Supabase keys, session/service tokens) and Stripe
    // keys before anything leaves the process — rls-strategy.md item.
    beforeSend: (event) => scrubSentryEvent(event),
    beforeBreadcrumb: (breadcrumb) => scrubSentryEvent(breadcrumb),
  });
}

export const onRequestError = Sentry.captureRequestError;
