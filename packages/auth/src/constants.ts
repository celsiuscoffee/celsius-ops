/**
 * @celsius/auth — Constants
 */

export const COOKIE_NAME = "celsius-session";

export const SESSION_MAX_AGE = 60 * 60 * 12; // 12 hours (one shift + buffer)

export function getJwtSecret(): Uint8Array {
  const secret = process.env.JWT_SECRET;
  if (!secret) {
    throw new Error(
      "[auth] JWT_SECRET environment variable is not set. " +
      "Set it in your .env file or Vercel environment variables."
    );
  }
  return new TextEncoder().encode(secret);
}

/**
 * Cookie domain for cross-subdomain sharing.
 * Set AUTH_COOKIE_DOMAIN=.celsiuscoffee.com in production.
 * Leave unset for localhost development.
 */
export function getCookieDomain(): string | undefined {
  return process.env.AUTH_COOKIE_DOMAIN || undefined;
}
