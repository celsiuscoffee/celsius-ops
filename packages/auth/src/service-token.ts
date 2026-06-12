/**
 * @celsius/auth — short-lived tokens for server-to-server calls between
 * the Celsius apps (e.g. backoffice → order app "release Maybank QR").
 *
 * Replaces the pattern of passing SUPABASE_SERVICE_ROLE_KEY in an
 * `x-service-key` header: the service-role key unlocks the entire
 * database, so it must never transit per-request where a proxy log,
 * Sentry breadcrumb, or debug dump can capture it. These tokens are
 * signed with the JWT_SECRET both apps already share, carry a `scope`
 * naming the one action they authorize, and expire in seconds — a
 * captured token is near-worthless.
 */

import { SignJWT, jwtVerify } from "jose";
import { getJwtSecret } from "./constants";

/** Audience claim separating these from user session tokens — a stolen
 *  staff session can never be replayed as a service token or vice versa. */
const SERVICE_AUDIENCE = "celsius-service";

const DEFAULT_TTL_SECONDS = 60;

/** Mint a token authorizing one named server-to-server action.
 *  `scope` is a dot-separated action id, e.g. "order.confirm-maybank-qr". */
export async function createServiceToken(
  scope: string,
  ttlSeconds: number = DEFAULT_TTL_SECONDS,
): Promise<string> {
  return new SignJWT({ scope })
    .setProtectedHeader({ alg: "HS256" })
    .setAudience(SERVICE_AUDIENCE)
    .setIssuedAt()
    .setExpirationTime(`${ttlSeconds}s`)
    .sign(getJwtSecret());
}

/** Verify a service token for the expected scope. Returns false on any
 *  failure (bad signature, expired, wrong audience, wrong scope). */
export async function verifyServiceToken(
  token: string,
  expectedScope: string,
): Promise<boolean> {
  try {
    const { payload } = await jwtVerify(token, getJwtSecret(), {
      audience: SERVICE_AUDIENCE,
    });
    return payload.scope === expectedScope;
  } catch {
    return false;
  }
}
