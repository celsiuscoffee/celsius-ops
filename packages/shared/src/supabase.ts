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
  return createClient(url, serviceKey || anonKeyFallback || "", {
    auth: { persistSession: false },
  });
}
