export const API_BASE_URL =
  process.env.EXPO_PUBLIC_STAFF_API_URL ?? "https://staff.celsiuscoffee.com";

export const SUPABASE_URL =
  process.env.EXPO_PUBLIC_SUPABASE_URL ?? "";

export const SUPABASE_ANON_KEY =
  process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY ?? "";

// celsius-ops project DSN (a public client value — it ships in the app bundle
// regardless). Hardcoded as a prod fallback so crash reporting works on the CI
// OTA even though no EXPO_PUBLIC_SENTRY_DSN is set in the EAS environment; dev
// stays Sentry-dark to avoid local noise.
export const SENTRY_DSN =
  process.env.EXPO_PUBLIC_SENTRY_DSN ??
  (__DEV__
    ? ""
    : "https://37f0a20903a2e28f4f7ec19b46ff5931@o4511247029043200.ingest.us.sentry.io/4511247091630080");

export const RELEASE_CHANNEL =
  process.env.EXPO_PUBLIC_RELEASE_CHANNEL ?? "preview";
