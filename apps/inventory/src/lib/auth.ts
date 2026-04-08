import { SignJWT, jwtVerify } from "jose";
import { cookies } from "next/headers";
import { NextRequest, NextResponse } from "next/server";

const SECRET = new TextEncoder().encode(
  process.env.JWT_SECRET!,
);

const COOKIE_NAME = "celsius-session";

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

// Read user from middleware-injected headers (for API routes)
export async function getUserFromHeaders(headers: Headers): Promise<SessionUser | null> {
  // Try middleware-injected headers first
  const id = headers.get("x-user-id");
  if (id) {
    return {
      id,
      name: headers.get("x-user-name") || "",
      role: headers.get("x-user-role") || "STAFF",
      outletId: headers.get("x-user-outlet") || null,
    };
  }
  // Fall back to JWT cookie
  const cookieHeader = headers.get("cookie") || "";
  const match = cookieHeader.match(/celsius-session=([^;]+)/);
  if (match) {
    try {
      const { payload } = await jwtVerify(match[1], SECRET);
      return payload as unknown as SessionUser;
    } catch {
      return null;
    }
  }
  return null;
}

type Role = "OWNER" | "ADMIN" | "MANAGER" | "STAFF";

// Require specific roles for an API route
export async function requireRole(headers: Headers, ...roles: Role[]): Promise<SessionUser> {
  let user = await getUserFromHeaders(headers);

  if (!user) {
    const cookieHeader = headers.get("cookie") || "";
    const match = cookieHeader.match(/celsius-session=([^;]+)/);
    if (match) {
      try {
        const { payload } = await jwtVerify(match[1], SECRET);
        user = payload as unknown as SessionUser;
      } catch { /* invalid token */ }
    }
  }

  if (!user) throw new AuthError("Unauthorized", 401);
  if (user.role === "OWNER") return user;
  if (!roles.includes(user.role as Role)) throw new AuthError("Forbidden", 403);
  return user;
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

  try {
    const { payload } = await jwtVerify(token, SECRET);
    const user = payload as unknown as SessionUser;
    return { user, error: null };
  } catch {
    return {
      user: null,
      error: NextResponse.json({ error: "Unauthorized" }, { status: 401 }),
    };
  }
}
