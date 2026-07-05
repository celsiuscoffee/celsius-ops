/**
 * POS auth module — inlined from @celsius/auth for Vercel standalone deploy.
 *
 * Workspace packages (@celsius/auth) can't resolve on Vercel standalone builds
 * because they're not published to npm. All auth logic is inlined here.
 */

import { SignJWT, jwtVerify } from "jose";
import { cookies } from "next/headers";
import { randomBytes, scryptSync, timingSafeEqual } from "crypto";
import bcrypt from "bcryptjs";
import { NextRequest, NextResponse } from "next/server";

// ─── Types ───────────────────────────────────────────────────

export type UserRole = "OWNER" | "ADMIN" | "MANAGER" | "STAFF";

export type SessionUser = {
  id: string;
  name: string;
  role: UserRole;
  outletId: string | null;
  outletName?: string | null;
};

export class AuthError extends Error {
  status: number;
  constructor(message: string, status: number) {
    super(message);
    this.name = "AuthError";
    this.status = status;
  }
}

// ─── Constants ───────────────────────────────────────────────

// Renamed from "celsius-session" so a POS-on-backoffice deploy doesn't
// stomp the backoffice admin cookie (apps/backoffice/src/lib/auth.ts
// uses "celsius-session" for the admin session).
export const COOKIE_NAME = "celsius-pos-session";
export const SESSION_MAX_AGE = 60 * 60 * 12; // 12 hours

function getJwtSecret(): Uint8Array {
  const secret = process.env.JWT_SECRET;
  if (!secret) {
    throw new Error(
      "[auth] JWT_SECRET environment variable is not set. " +
        "Set it in your .env file or Vercel environment variables.",
    );
  }
  return new TextEncoder().encode(secret);
}

function getCookieDomain(): string | undefined {
  return process.env.AUTH_COOKIE_DOMAIN || undefined;
}

// ─── JWT ─────────────────────────────────────────────────────

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

// ─── Session ─────────────────────────────────────────────────

export async function createSession(user: SessionUser): Promise<string> {
  const token = await createToken(user);
  const cookieStore = await cookies();
  cookieStore.set(COOKIE_NAME, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    maxAge: SESSION_MAX_AGE,
    path: "/",
    ...(getCookieDomain() ? { domain: getCookieDomain() } : {}),
  });
  return token;
}

export async function getSession(): Promise<SessionUser | null> {
  const cookieStore = await cookies();
  const token = cookieStore.get(COOKIE_NAME)?.value;
  if (!token) return null;
  return verifyToken(token);
}

export async function clearSession(): Promise<void> {
  const cookieStore = await cookies();
  cookieStore.delete(COOKIE_NAME);
}

// ─── Password ────────────────────────────────────────────────

export function hashPassword(password: string): string {
  const salt = randomBytes(16).toString("hex");
  const hash = scryptSync(password, salt, 64).toString("hex");
  return `${salt}:${hash}`;
}

export async function verifyPassword(
  password: string,
  stored: string,
): Promise<boolean> {
  if (stored.startsWith("$2")) {
    return bcrypt.compare(password, stored);
  }
  const [salt, hash] = stored.split(":");
  if (!salt || !hash) return false;
  const hashBuffer = Buffer.from(hash, "hex");
  const derivedKey = scryptSync(password, salt, 64);
  return timingSafeEqual(hashBuffer, derivedKey);
}

// ─── PIN ─────────────────────────────────────────────────────

const BCRYPT_ROUNDS = 10;

export async function hashPin(pin: string): Promise<string> {
  return bcrypt.hash(pin.trim(), BCRYPT_ROUNDS);
}

export async function verifyPin(
  pin: string,
  stored: string | null | undefined,
): Promise<{ match: boolean; needsRehash: boolean }> {
  if (!stored) return { match: false, needsRehash: false };
  const trimmedPin = pin.trim();
  if (stored.startsWith("$2")) {
    const match = await bcrypt.compare(trimmedPin, stored);
    return { match, needsRehash: false };
  }
  const match = stored.trim() === trimmedPin;
  return { match, needsRehash: match };
}

// ─── Auth Helpers ────────────────────────────────────────────

export function getUserFromHeaders(headers: Headers): SessionUser | null {
  const id = headers.get("x-user-id");
  if (!id) return null;
  return {
    id,
    name: headers.get("x-user-name") || "",
    role: (headers.get("x-user-role") || "STAFF") as UserRole,
    outletId:
      headers.get("x-user-outlet") || headers.get("x-user-branch") || null,
  };
}

export async function getUserFromCookie(
  headers: Headers,
): Promise<SessionUser | null> {
  const cookieHeader = headers.get("cookie") || "";
  const match = cookieHeader.match(/celsius-session=([^;]+)/);
  if (!match) return null;
  return verifyToken(match[1]);
}

export async function getUser(
  headers: Headers,
): Promise<SessionUser | null> {
  return getUserFromHeaders(headers) || getUserFromCookie(headers);
}

export async function requireRole(
  headersOrReq: Headers | NextRequest,
  ...roles: UserRole[]
): Promise<SessionUser> {
  const headers =
    headersOrReq instanceof NextRequest ? headersOrReq.headers : headersOrReq;
  const user = await getUser(headers);
  if (!user) throw new AuthError("Unauthorized", 401);
  if (user.role === "OWNER") return user;
  if (!roles.includes(user.role)) throw new AuthError("Forbidden", 403);
  return user;
}

export async function requireAuth(
  request: NextRequest,
): Promise<
  { user: SessionUser; error: null } | { user: null; error: NextResponse }
> {
  const token = request.cookies.get(COOKIE_NAME)?.value;
  if (!token) {
    return {
      user: null,
      error: NextResponse.json({ error: "Unauthorized" }, { status: 401 }),
    };
  }
  const user = await verifyToken(token);
  if (!user) {
    return {
      user: null,
      error: NextResponse.json({ error: "Unauthorized" }, { status: 401 }),
    };
  }
  return { user, error: null };
}

// ─── POS API request auth (Bearer for native till, cookie for web register) ──
//
// The PIN login (/api/pos/auth/pin) already mints a 12h JWT via createToken and
// sets it as the httpOnly celsius-pos-session cookie. The web register replays
// that cookie automatically; the native till (apps/pos-native) can't read an
// httpOnly cookie, so it captures the token from the login response body and
// replays it as `Authorization: Bearer <token>`. Both resolve here.

/** True when POS API auth is enforced. During the rollout window this stays
 *  unset, so an unauthenticated POS call is allowed-but-logged while the native
 *  tills ship the Bearer token — flip POS_AUTH_ENFORCE=1 once every till sends
 *  it (watch the [pos-auth] warnings drop to zero first). */
export function posAuthEnforced(): boolean {
  const v = process.env.POS_AUTH_ENFORCE;
  return v === "1" || v === "true";
}

/** Resolve the POS staff session from a Bearer header (native till) or the
 *  celsius-pos-session cookie (web register). */
export async function getPosUser(
  request: NextRequest,
): Promise<SessionUser | null> {
  const bearer = (request.headers.get("authorization") ?? "").match(
    /^Bearer\s+(.+)$/i,
  );
  if (bearer) {
    const u = await verifyToken(bearer[1]);
    if (u) return u;
  }
  const cookieTok = request.cookies.get(COOKIE_NAME)?.value;
  if (cookieTok) {
    const u = await verifyToken(cookieTok);
    if (u) return u;
  }
  return null;
}

/** Guard a POS API route. When `block` is non-null the route must return it (a
 *  401). Unauthenticated calls pass through (block=null) during the rollout
 *  grace period unless POS_AUTH_ENFORCE is set — see posAuthEnforced. */
export async function requirePosApiAuth(
  request: NextRequest,
  label: string,
): Promise<{ user: SessionUser | null; block: NextResponse | null }> {
  const user = await getPosUser(request);
  if (user) return { user, block: null };
  if (posAuthEnforced()) {
    return {
      user: null,
      block: NextResponse.json({ error: "Unauthorized" }, { status: 401 }),
    };
  }
  console.warn(
    `[pos-auth] unauthenticated ${label} (grace period — set POS_AUTH_ENFORCE=1 to reject)`,
  );
  return { user: null, block: null };
}
