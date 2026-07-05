import { createHmac, timingSafeEqual } from "node:crypto";
import type { NextRequest } from "next/server";

// Hand-rolled HS256 KDS/staff token — mirrors customer-jwt.ts (the order app
// deliberately avoids a `jose` dependency). Minted by /api/staff/auth after a
// PIN check and replayed as a Bearer on the staff-only surfaces: the order
// status transitions (except the customer-driven ready→completed collect) and
// the /api/staff/* feeds. A distinct `aud` keeps it from being swapped with the
// customer session token.
//
// Payload shape:
//   { aud: "order-staff", storeId, staffId, staffName, iat, exp }

const SECRET = process.env.STAFF_JWT_SECRET ?? process.env.JWT_SECRET ?? "";
const DEFAULT_TTL_SEC = 60 * 60 * 24 * 30; // 30 days — matches the KDS localStorage session
const AUD = "order-staff";

export type StaffSessionToken = {
  aud:       string;
  storeId:   string;
  staffId:   string | null;
  staffName: string | null;
  iat:       number;
  exp:       number;
};

function b64url(input: Buffer | string): string {
  const buf = typeof input === "string" ? Buffer.from(input, "utf8") : input;
  return buf
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

function fromB64url(s: string): Buffer {
  const pad = "=".repeat((4 - (s.length % 4)) % 4);
  return Buffer.from(s.replace(/-/g, "+").replace(/_/g, "/") + pad, "base64");
}

function hmac(payload: string): string {
  if (!SECRET) throw new Error("STAFF_JWT_SECRET / JWT_SECRET not set");
  return b64url(createHmac("sha256", SECRET).update(payload).digest());
}

/** Sign a KDS/staff session token. Returns null only when the secret is missing
 *  — callers treat null as "auth disabled" rather than failing the login. */
export function signStaffToken(args: {
  storeId:   string;
  staffId:   string | null;
  staffName: string | null;
  ttlSec?:   number;
}): string | null {
  if (!SECRET) return null;
  const now = Math.floor(Date.now() / 1000);
  const payload: StaffSessionToken = {
    aud:       AUD,
    storeId:   args.storeId,
    staffId:   args.staffId,
    staffName: args.staffName,
    iat:       now,
    exp:       now + (args.ttlSec ?? DEFAULT_TTL_SEC),
  };
  const head = b64url(JSON.stringify({ alg: "HS256", typ: "JWT" }));
  const body = b64url(JSON.stringify(payload));
  const sig  = hmac(`${head}.${body}`);
  return `${head}.${body}.${sig}`;
}

/** Verify and parse. Returns null on any failure (bad shape, wrong audience,
 *  bad signature, expired, missing secret). Does NOT throw. */
export function verifyStaffToken(token: string | null | undefined): StaffSessionToken | null {
  if (!token || !SECRET) return null;
  const parts = token.split(".");
  if (parts.length !== 3) return null;
  const [head, body, sig] = parts;
  const expected = hmac(`${head}.${body}`);
  // Constant-time compare; length check first because timingSafeEqual throws on
  // a length mismatch and we want a silent reject.
  const a = Buffer.from(sig, "utf8");
  const b = Buffer.from(expected, "utf8");
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
  let parsed: StaffSessionToken;
  try {
    parsed = JSON.parse(fromB64url(body).toString("utf8")) as StaffSessionToken;
  } catch {
    return null;
  }
  if (parsed.aud !== AUD) return null;
  if (typeof parsed.exp !== "number" || parsed.exp < Math.floor(Date.now() / 1000)) {
    return null;
  }
  return parsed;
}

/** Pull and verify the Bearer token off a request. Null when absent/invalid. */
export function readStaffToken(req: NextRequest): StaffSessionToken | null {
  const auth = req.headers.get("authorization");
  if (!auth || !auth.toLowerCase().startsWith("bearer ")) return null;
  return verifyStaffToken(auth.slice(7).trim());
}

/** Enforcement flag — set STAFF_AUTH_ENFORCE=1 (or true) in the order app's env
 *  once every KDS client sends a Bearer token. While unset, the guard logs
 *  unauthenticated calls but lets them through, so a deploy doesn't 401 tills
 *  still running the pre-token build. Mirrors STRICT_CUSTOMER_AUTH. */
export const STRICT_STAFF_AUTH =
  ["1", "true"].includes((process.env.STAFF_AUTH_ENFORCE ?? "").toLowerCase());

/** Guard a staff-only route. When enforcement is on, returns a 401 `error` if
 *  no valid Bearer is present; when off, returns `{ session: null, error: null }`
 *  (allow) after logging, so token adoption can be watched before flipping the
 *  flag. */
export function requireStaffSession(
  req: NextRequest,
  label: string,
):
  | { session: StaffSessionToken; error: null }
  | { session: null; error: Response | null }
{
  const session = readStaffToken(req);
  if (session) return { session, error: null };
  if (STRICT_STAFF_AUTH) {
    return { session: null, error: Response.json({ error: "Unauthorized" }, { status: 401 }) };
  }
  console.warn(`[staff-auth] unauthenticated ${label} (grace period — set STAFF_AUTH_ENFORCE=1 to reject)`);
  return { session: null, error: null };
}
