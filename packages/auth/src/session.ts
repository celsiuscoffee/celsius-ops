/**
 * @celsius/auth — Session management (cookie-based + bearer-aware)
 *
 * createSession / getSession / clearSession — use cookies() / headers() from
 * next/headers. These work in Server Components and Route Handlers.
 *
 * getSession() reads the session from a JWT cookie OR an
 * `Authorization: Bearer <jwt>` header. Bearer support lets the native staff
 * app (apps/staff-native) reuse every existing route without modification —
 * native clients can't carry HttpOnly cookies reliably.
 */

import { cookies, headers } from "next/headers";
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
  const cookieToken = cookieStore.get(COOKIE_NAME)?.value;
  if (cookieToken) {
    const user = await verifyToken(cookieToken);
    if (user) return user;
  }
  const hdrs = await headers();
  const auth = hdrs.get("authorization") ?? "";
  const m = auth.match(/^Bearer\s+(.+)$/i);
  if (m) {
    const user = await verifyToken(m[1]);
    if (user) return user;
  }
  return null;
}

export async function clearSession(): Promise<void> {
  const cookieStore = await cookies();
  // The cookie is SET with `domain: .celsiuscoffee.com` in production
  // (getCookieDomain), and a cookie is keyed on (name, domain, path). A bare
  // delete(name) only expires a HOST-ONLY cookie, leaving the real
  // domain-scoped session cookie alive — so "Log Out" on a shared outlet
  // tablet left the next person signed in as the previous user. Clear it with
  // the SAME domain + path it was written with (and also the host-only form,
  // to sweep any legacy cookie set before a domain was configured).
  const domain = getCookieDomain();
  const expire = {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax" as const,
    path: "/",
    maxAge: 0,
  };
  if (domain) {
    cookieStore.set(COOKIE_NAME, "", { ...expire, domain });
  }
  cookieStore.set(COOKIE_NAME, "", expire);
}
