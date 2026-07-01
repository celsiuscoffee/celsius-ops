/**
 * @celsius/auth — Auth requirement helpers for API routes
 */

import { NextRequest, NextResponse } from "next/server";
import { COOKIE_NAME } from "./constants";
import { verifyToken } from "./jwt";
import type { SessionUser, UserRole } from "./types";
import { AuthError } from "./types";

/**
 * SECURITY (was an authentication bypass): this previously returned a fully
 * authenticated session straight from UNVERIFIED `x-user-*` request headers
 * (the "trusted proxy" pattern). But no app in this monorepo injects those
 * headers, and nothing strips them on the way in — so the only way they were
 * ever populated was an attacker forging them. Sending `x-user-id: <victim>`
 * impersonated any user on every route that resolved auth via `getUser`
 * (staff clock-in/out, attendance, ping, …).
 *
 * It is intentionally inert now — auth must come from a verified JWT (bearer or
 * cookie). Kept as an exported no-op so existing imports keep compiling; if a
 * genuine trusted-proxy deployment is ever added, reintroduce header trust ONLY
 * behind a shared secret the proxy signs and the edge strips inbound.
 */
export function getUserFromHeaders(_headers: Headers): SessionUser | null {
  return null;
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
 * Read user from `Authorization: Bearer <jwt>` header.
 * Used by native apps that can't carry HttpOnly cookies reliably.
 */
export async function getUserFromBearer(headers: Headers): Promise<SessionUser | null> {
  const auth = headers.get("authorization") ?? "";
  const m = auth.match(/^Bearer\s+(.+)$/i);
  if (!m) return null;
  return verifyToken(m[1]);
}

/**
 * Get the authenticated user from a verified JWT — bearer token (native app)
 * or cookie (web). Unverified `x-user-*` headers are NOT trusted (see
 * getUserFromHeaders): they were an impersonation vector and no proxy sets them.
 */
export async function getUser(headers: Headers): Promise<SessionUser | null> {
  return (
    (await getUserFromBearer(headers)) ||
    getUserFromCookie(headers)
  );
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
  const cookieToken = request.cookies.get(COOKIE_NAME)?.value;
  const bearerMatch = (request.headers.get("authorization") ?? "").match(
    /^Bearer\s+(.+)$/i,
  );
  const token = cookieToken ?? bearerMatch?.[1];

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
