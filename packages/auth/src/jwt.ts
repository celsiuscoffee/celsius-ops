/**
 * @celsius/auth — JWT token creation and verification (jose HS256)
 */

import { SignJWT, jwtVerify } from "jose";
import { getJwtSecret, SESSION_MAX_AGE } from "./constants";
import type { SessionUser } from "./types";

export async function createToken(user: SessionUser): Promise<string> {
  return new SignJWT({
    id: user.id,
    name: user.name,
    role: user.role,
    outletId: user.outletId,
    outletName: user.outletName ?? null,
  })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt() // explicit iat — used by verifyTokenWithFreshness for revocation
    .setExpirationTime(`${SESSION_MAX_AGE}s`)
    .sign(getJwtSecret());
}

export async function verifyToken(token: string): Promise<SessionUser | null> {
  try {
    const { payload } = await jwtVerify(token, getJwtSecret());
    return payload as unknown as SessionUser;
  } catch {
    return null;
  }
}

/**
 * Verify token AND check it wasn't issued before the user revoked all
 * sessions. Pass a function that fetches the user's tokenRevokedAt.
 * Returns null if token is invalid OR was issued before revocation.
 *
 * Use this on sensitive endpoints (logout-all, change password,
 * delete account, view sensitive data) to give users a "panic
 * button" — hitting /api/auth/sign-out-all bumps tokenRevokedAt and
 * every existing session for that user 401s on the next request.
 */
export async function verifyTokenWithFreshness(
  token: string,
  getUserRevokedAt: (userId: string) => Promise<Date | null>,
): Promise<SessionUser | null> {
  try {
    const { payload } = await jwtVerify(token, getJwtSecret());
    const user = payload as unknown as SessionUser & { iat?: number };
    const iat = user.iat;
    if (!iat) return null; // tokens predating setIssuedAt — reject

    const revokedAt = await getUserRevokedAt(user.id);
    if (revokedAt && iat * 1000 < revokedAt.getTime()) {
      return null; // token issued before user revoked all sessions
    }
    return user;
  } catch {
    return null;
  }
}
