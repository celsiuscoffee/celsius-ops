/**
 * Server-side Supabase client for BO routes that need direct DB access.
 *
 * Used by the Grab partner-to-server endpoints (/api/pos/grab/*). These are
 * called by Grab's backend — no browser cookie, no session. So we use the
 * service-role admin client (same pattern as lib/pickup/supabase.ts and
 * lib/loyalty-snapshot.ts).
 *
 * Kept as `async createClient()` to preserve the call shape from when this
 * was an SSR cookie-aware client; the route handlers `await createClient()`.
 */
import { createSupabaseAdmin } from "@celsius/shared";

export async function createClient() {
  const url =
    process.env.NEXT_PUBLIC_LOYALTY_SUPABASE_URL ||
    process.env.NEXT_PUBLIC_SUPABASE_URL ||
    "";
  const key =
    process.env.LOYALTY_SUPABASE_SERVICE_ROLE_KEY ||
    process.env.SUPABASE_SERVICE_ROLE_KEY ||
    "";
  return createSupabaseAdmin(url, key);
}
