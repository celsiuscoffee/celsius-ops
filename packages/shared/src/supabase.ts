/**
 * Supabase client factory functions.
 * Each app passes its own env vars — the shared package provides
 * the creation logic to avoid duplicating boilerplate.
 */
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

/**
 * Create a browser/anon Supabase client.
 * Returns null-cast if url is empty (SSR safety).
 */
export function createSupabaseClient(
  url: string,
  anonKey: string,
): SupabaseClient {
  if (!url) {
    return null as unknown as SupabaseClient;
  }
  return createClient(url, anonKey);
}

/**
 * Create a service-role admin client (server-side only).
 * Falls back to anonKey when serviceKey is missing (dev convenience).
 */
export function createSupabaseAdmin(
  url: string,
  serviceKey: string,
  anonKeyFallback?: string,
): SupabaseClient {
  if (!url) {
    return null as unknown as SupabaseClient;
  }
  if (!serviceKey) {
    // An "admin" client built on the anon key silently runs every server
    // route under RLS as `anon`: reads come back empty, writes 42501, and
    // nothing says why. Say why. (Not thrown: preview deploys without the
    // key must still boot.)
    console.error(
      "[supabase] createSupabaseAdmin called without SUPABASE_SERVICE_ROLE_KEY — falling back to the anon key; server routes will run under RLS as anon.",
    );
  }
  return createClient(url, serviceKey || anonKeyFallback || "", {
    auth: { persistSession: false },
  });
}
