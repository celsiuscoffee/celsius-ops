"use client";

import { getSupabaseClient } from "./supabase/client";

/**
 * Wrapper around fetch that automatically attaches the current Supabase admin
 * session token as an Authorization header.  Use in all backoffice API calls.
 */
export async function adminFetch(
  url: string,
  options: RequestInit = {}
): Promise<Response> {
  const { data: { session } } = await getSupabaseClient().auth.getSession();

  const headers = new Headers(options.headers as HeadersInit | undefined);
  if (session?.access_token) {
    headers.set("Authorization", `Bearer ${session.access_token}`);
  }

  return fetch(url, { ...options, headers });
}
