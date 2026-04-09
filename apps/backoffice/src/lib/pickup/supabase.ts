/**
 * Pickup Supabase helpers.
 * Re-uses the same Supabase project as loyalty (kqdcdhpnyuwrxqhbuyfl).
 */
import { createSupabaseClient, createSupabaseAdmin } from "@celsius/shared";

const url = process.env.NEXT_PUBLIC_LOYALTY_SUPABASE_URL || "";
const anon = process.env.NEXT_PUBLIC_LOYALTY_SUPABASE_ANON_KEY || "";

// Browser / client-component singleton
let _client: ReturnType<typeof createSupabaseClient> | null = null;

export function getSupabaseClient() {
  if (!_client) {
    _client = createSupabaseClient(url, anon);
  }
  return _client;
}

// Server / API-route admin client
export function getSupabaseAdmin() {
  return createSupabaseAdmin(
    process.env.NEXT_PUBLIC_LOYALTY_SUPABASE_URL!,
    process.env.LOYALTY_SUPABASE_SERVICE_ROLE_KEY!,
  );
}
