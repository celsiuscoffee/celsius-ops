import * as Sentry from "@sentry/nextjs";
import { setAuditErrorReporter } from "@celsius/db";
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

  // Surface silent audit-write failures — a missing audit trail must not
  // itself be invisible.
  setAuditErrorReporter((err, context) => {
    Sentry.captureException(err, { tags: { source: "audit" }, extra: context });
  });
}

export const onRequestError = Sentry.captureRequestError;
