export const API_BASE_URL =
  process.env.EXPO_PUBLIC_STAFF_API_URL ?? "https://staff.celsiuscoffee.com";

// Backoffice base. Sales is served bridge-free from the backoffice's
// /api/sales/native-dashboard (migration: staff-native backend → backoffice).
export const BACKOFFICE_URL =
  process.env.EXPO_PUBLIC_BACKOFFICE_URL ?? "https://backoffice.celsiuscoffee.com";

export const SUPABASE_URL =
  process.env.EXPO_PUBLIC_SUPABASE_URL ?? "";

export const SUPABASE_ANON_KEY =
  process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY ?? "";

export const SENTRY_DSN = process.env.EXPO_PUBLIC_SENTRY_DSN ?? "";

export const RELEASE_CHANNEL =
  process.env.EXPO_PUBLIC_RELEASE_CHANNEL ?? "preview";
