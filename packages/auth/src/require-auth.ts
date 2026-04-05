/**
 * @celsius/auth — Auth requirement helpers for API routes
 */

import { NextRequest, NextResponse } from "next/server";
import { COOKIE_NAME } from "./constants";
import { verifyToken } from "./jwt";
import type { SessionUser, UserRole } from "./types";
import { AuthError } from "./types";

/**
 * Read user from middleware-injected headers (proxy pattern).
 */
export function getUserFromHeaders(headers: Headers): SessionUser | null {
  const id = headers.get("x-user-id");
  if (!id) return null;
  return {
    id,
    name: headers.get("x-user-name") || "",
    role: (headers.get("x-user-role") || "STAFF") as UserRole,
    outletId: headers.get("x-user-outlet") || headers.get("x-user-branch") || null,
  };
}

/**
 * Read user from JWT cookie in the request headers.
 * Works when there's no proxy/middleware injecting headers.
 */
export async function getUserFromCookie(headers: Headers): Promise<SessionUser | null> {
  const cookieHeader = headers.get("cookie") || "";
  const match = cookieHeader.match(/celsius-session=([^;]+)/);
  if (!match) return null;
  return verifyToken(match[1]);
}

/**
 * Get the authenticated user from headers (proxy) or cookie (direct).
 * Tries proxy headers first, falls back to JWT cookie.
 */
export async function getUser(headers: Headers): Promise<SessionUser | null> {
  return getUserFromHeaders(headers) || getUserFromCookie(headers);
}

/**
 * Require specific roles for an API route.
 * OWNER always bypasses role checks.
 */
export async function requireRole(
  headersOrReq: Headers | NextRequest,
  ...roles: UserRole[]
): Promise<SessionUser> {
  const headers =
    headersOrReq instanceof NextRequest ? headersOrReq.headers : headersOrReq;
  const user = await getUser(headers);

  if (!user) throw new AuthError("Unauthorized", 401);
  if (user.role === "OWNER") return user; // OWNER bypasses all
  if (!roles.includes(user.role)) throw new AuthError("Forbidden", 403);
  return user;
}

/**
 * Require auth from a NextRequest (reads JWT from cookie directly).
 * Returns { user, error } pattern for ergonomic error handling.
 */
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
