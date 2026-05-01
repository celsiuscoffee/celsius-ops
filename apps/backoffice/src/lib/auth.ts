import { SignJWT, jwtVerify } from "jose";
import { cookies } from "next/headers";
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

const SECRET = new TextEncoder().encode(
  process.env.JWT_SECRET!,
);

const COOKIE_NAME = "celsius-session";

// Cache User.tokenRevokedAt for 30s per user. Checking it on every
// authenticated request is fine (one indexed PK lookup, ~1-2ms) but
// the cache halves the burden on hot endpoints. Cache is per-process
// so worst case is 30s of staleness — fine for "I just clicked
// sign-out-all" UX. For instant revocation across all instances,
// move to Redis.
const REVOKED_CACHE_TTL_MS = 30_000;
const revokedCache = new Map<string, { revokedAt: Date | null; expiresAt: number }>();

async function getTokenRevokedAt(userId: string): Promise<Date | null> {
  const cached = revokedCache.get(userId);
  if (cached && Date.now() < cached.expiresAt) return cached.revokedAt;
  const row = await prisma.user.findUnique({
    where: { id: userId },
    select: { tokenRevokedAt: true },
  });
  const revokedAt = row?.tokenRevokedAt ?? null;
  revokedCache.set(userId, { revokedAt, expiresAt: Date.now() + REVOKED_CACHE_TTL_MS });
  return revokedAt;
}

/**
 * Verify a token's signature AND that it wasn't issued before the
 * user revoked all sessions. Returns null if either check fails.
 * Used by getUserFromHeaders + requireAuth so /api/auth/sign-out-all
 * actually invalidates existing cookies on the next request (within
 * the 30s revocation cache window).
 */
async function verifyTokenFresh(token: string): Promise<SessionUser | null> {
  try {
    const { payload } = await jwtVerify(token, SECRET);
    const user = payload as unknown as SessionUser & { iat?: number };
    if (!user.iat) return null;     // pre-revocation tokens — reject
    const revokedAt = await getTokenRevokedAt(user.id);
    if (revokedAt && user.iat * 1000 < revokedAt.getTime()) return null;
    return user;
  } catch {
    return null;
  }
}

export type SessionUser = {
  id: string;
  name: string;
  role: string;
  outletId: string | null;
  outletName?: string | null;
};

export async function createSession(user: SessionUser) {
  const token = await new SignJWT({
    id: user.id,
    name: user.name,
    role: user.role,
    outletId: user.outletId,
    outletName: user.outletName ?? null,
  })
    .setProtectedHeader({ alg: "HS256" })
    .setExpirationTime("7d")
    .sign(SECRET);

  const cookieStore = await cookies();
  cookieStore.set(COOKIE_NAME, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    maxAge: 60 * 60 * 24 * 7, // 7 days
    path: "/",
  });

  return token;
}

export async function getSession(): Promise<SessionUser | null> {
  const cookieStore = await cookies();
  const token = cookieStore.get(COOKIE_NAME)?.value;
  if (!token) return null;

  try {
    const { payload } = await jwtVerify(token, SECRET);
    return payload as unknown as SessionUser;
  } catch {
    return null;
  }
}

export async function clearSession() {
  const cookieStore = await cookies();
  cookieStore.delete(COOKIE_NAME);
}

// For Edge middleware (can't use cookies() helper)
export async function verifyToken(token: string): Promise<SessionUser | null> {
  try {
    const { payload } = await jwtVerify(token, SECRET);
    return payload as unknown as SessionUser;
  } catch {
    return null;
  }
}

// Read user from JWT cookie only (for API routes). Includes the
// session-revocation freshness check — if user hit sign-out-all
// recently, even a valid signed token is rejected.
export async function getUserFromHeaders(headers: Headers): Promise<SessionUser | null> {
  // Never trust x-user-* headers — always validate JWT
  const cookieHeader = headers.get("cookie") || "";
  const match = cookieHeader.match(/celsius-session=([^;]+)/);
  if (!match) return null;
  return verifyTokenFresh(match[1]);
}

type Role = "OWNER" | "ADMIN" | "MANAGER" | "STAFF";

// Require specific roles for an API route — validates JWT only
export async function requireRole(headersOrReq: Headers | NextRequest, ...roles: Role[]): Promise<SessionUser> {
  const headers = headersOrReq instanceof NextRequest ? headersOrReq.headers : headersOrReq;
  const user = await getUserFromHeaders(headers);

  if (!user) throw new AuthError("Unauthorized", 401);
  // OWNER bypasses all role checks
  if (user.role === "OWNER") return user;
  if (!roles.includes(user.role as Role)) throw new AuthError("Forbidden", 403);
  return user;
}

// Check whether a Manager has a specific module permission (e.g. "settings:staff").
// OWNER/ADMIN always pass. Reads moduleAccess from DB since it's not in the JWT.
export async function hasModulePermission(
  user: SessionUser,
  moduleKey: string,
  prisma: { user: { findUnique: (args: { where: { id: string }; select: { moduleAccess: true } }) => Promise<{ moduleAccess: unknown } | null> } },
): Promise<boolean> {
  if (user.role === "OWNER" || user.role === "ADMIN") return true;
  const [app, mod] = moduleKey.split(":");
  if (!app || !mod) return false;
  const row = await prisma.user.findUnique({ where: { id: user.id }, select: { moduleAccess: true } });
  const ma = row?.moduleAccess;
  if (ma && typeof ma === "object" && !Array.isArray(ma)) {
    const modules = (ma as Record<string, string[]>)[app];
    return Array.isArray(modules) && modules.includes(mod);
  }
  if (Array.isArray(ma)) {
    return (ma as string[]).includes(moduleKey);
  }
  return false;
}

export class AuthError extends Error {
  status: number;
  constructor(message: string, status: number) {
    super(message);
    this.status = status;
  }
}

// ─── Request-based Auth (for loyalty API routes) ─────

const LOYALTY_COOKIE_NAME = "celsius-session";

/**
 * Require auth from a NextRequest (reads JWT from cookie directly).
 * Returns { user, error } where error is a NextResponse if not authenticated.
 * Compatible with the loyalty app's requireAuth pattern.
 */
export async function requireAuth(request: NextRequest): Promise<
  | { user: SessionUser; error: null }
  | { user: null; error: NextResponse }
> {
  const token = request.cookies.get(LOYALTY_COOKIE_NAME)?.value;
  if (!token) {
    return {
      user: null,
      error: NextResponse.json({ error: "Unauthorized" }, { status: 401 }),
    };
  }
  // Routes through verifyTokenFresh so /api/auth/sign-out-all actually
  // invalidates pre-revocation tokens (within the 30s cache window).
  const user = await verifyTokenFresh(token);
  if (!user) {
    return {
      user: null,
      error: NextResponse.json({ error: "Unauthorized" }, { status: 401 }),
    };
  }
  return { user, error: null };
}
