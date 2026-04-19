import * as Sentry from "@sentry/nextjs";
// Side-effect import: validates env at server startup.
import "./env";

export function register() {
  const dsn = process.env.SENTRY_DSN;
  if (!dsn) return;

  Sentry.init({
    dsn,
    environment: process.env.NODE_ENV,
    tracesSampleRate: process.env.NODE_ENV === "production" ? 0.1 : 1.0,
  });
}

export const onRequestError = Sentry.captureRequestError;
