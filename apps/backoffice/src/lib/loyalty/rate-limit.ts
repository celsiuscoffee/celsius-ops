// Re-export from shared — the Supabase-backed version was identical to the
// backoffice/loyalty in-memory version for the config + RATE_LIMITS part.
// The actual Supabase rate_limits table is only used by the order app.
export { checkRateLimit, RATE_LIMITS } from "@celsius/shared";
export type { RateLimitConfig } from "@celsius/shared";
