"use client";

/**
 * Wrapper around fetch that automatically attaches the current session token.
 * For the backoffice app this is a simple passthrough — the backoffice already
 * has its own auth layer, so we just forward cookies.
 */
export async function adminFetch(
  url: string,
  options: RequestInit = {}
): Promise<Response> {
  return fetch(url, { ...options, credentials: "same-origin" });
}
