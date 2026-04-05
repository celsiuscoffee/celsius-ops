/**
 * @celsius/auth — Constants
 */

export const COOKIE_NAME = "celsius-session";

export const SESSION_MAX_AGE = 60 * 60 * 24 * 7; // 7 days

export function getJwtSecret(): Uint8Array {
  const secret = process.env.JWT_SECRET;
  if (!secret) {
    console.error("[auth] JWT_SECRET is not set! Using fallback (unsafe in production).");
  }
  return new TextEncoder().encode(secret || "celsius-inventory-secret-key-2024");
}

/**
 * Cookie domain for cross-subdomain sharing.
 * Set AUTH_COOKIE_DOMAIN=.celsiuscoffee.com in production.
 * Leave unset for localhost development.
 */
export function getCookieDomain(): string | undefined {
  return process.env.AUTH_COOKIE_DOMAIN || undefined;
}
