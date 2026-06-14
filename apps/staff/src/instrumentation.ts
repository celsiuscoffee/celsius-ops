import * as Sentry from "@sentry/nextjs";
import { checkEnvAtBoot, scrubSentryEvent } from "@celsius/shared";

export function register() {
  // Env check first. Development: throws on missing REQUIRED vars
  // (fail fast on a bad .env). Production: logs one loud block and the
  // report is forwarded to Sentry below — never fatal at runtime.
  const envCheck = checkEnvAtBoot("staff", {
    required: [
      "DATABASE_URL",
      "JWT_SECRET",
      "NEXT_PUBLIC_SUPABASE_URL",
      "NEXT_PUBLIC_SUPABASE_ANON_KEY",
      "SUPABASE_SERVICE_ROLE_KEY",
    ],
    recommended: [
      "SENTRY_DSN",
      "ANTHROPIC_API_KEY",
      "BACKOFFICE_INTERNAL_URL",
    ],
  });

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

  // Only escalate to Sentry when a REQUIRED var is missing. Recommended
  // gaps are non-fatal and already logged to the runtime logs — paging
  // them at error level on every cold start just buries real errors.
  if (envCheck.hasRequiredProblems) Sentry.captureMessage(envCheck.report, "error");
}

export const onRequestError = Sentry.captureRequestError;
