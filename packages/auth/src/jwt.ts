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
