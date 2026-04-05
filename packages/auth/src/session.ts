/**
 * @celsius/auth — Session management (cookie-based)
 *
 * createSession / getSession / clearSession — use cookies() from next/headers.
 * These work in Server Components and Route Handlers.
 */

import { cookies } from "next/headers";
import { COOKIE_NAME, SESSION_MAX_AGE, getCookieDomain } from "./constants";
import { createToken, verifyToken } from "./jwt";
import type { SessionUser } from "./types";

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
