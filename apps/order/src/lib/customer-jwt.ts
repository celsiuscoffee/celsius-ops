import { createHmac, timingSafeEqual } from "node:crypto";
import type { NextRequest } from "next/server";

// Hand-rolled HS256 token. Avoids adding `jose` as a dep to the order
// app (backoffice already has it; we don't here yet) and keeps the
// signing surface tiny — there's nothing fancy going on, just a
// signed assertion that "this phone OTP-verified at this time".
//
// Payload shape:
//   { sub: <member_id>, phone: <e164>, iat: <unix>, exp: <unix> }

const SECRET =
  process.env.CUSTOMER_JWT_SECRET ?? process.env.JWT_SECRET ?? "";
const DEFAULT_TTL_SEC = 60 * 60 * 24 * 30; // 30 days

export type CustomerSession = {
  sub:   string; // member_id (when known) — empty string before first order
  phone: string; // E.164
  iat:   number;
  exp:   number;
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
  if (!SECRET) throw new Error("CUSTOMER_JWT_SECRET / JWT_SECRET not set");
  return b64url(createHmac("sha256", SECRET).update(payload).digest());
}

/** Sign a customer session token. Returns null only if the secret is
 *  missing — caller must treat null as "auth disabled, skip the
 *  Bearer-header path" rather than failing the request. */
export function signCustomerSession(args: {
  memberId: string | null;
  phone:    string;
  ttlSec?:  number;
}): string | null {
  if (!SECRET) return null;
  const now = Math.floor(Date.now() / 1000);
  const payload: CustomerSession = {
    sub:   args.memberId ?? "",
    phone: args.phone,
    iat:   now,
    exp:   now + (args.ttlSec ?? DEFAULT_TTL_SEC),
  };
  const head = b64url(JSON.stringify({ alg: "HS256", typ: "JWT" }));
  const body = b64url(JSON.stringify(payload));
  const sig  = hmac(`${head}.${body}`);
  return `${head}.${body}.${sig}`;
}

/** Verify and parse. Returns null on any failure (bad shape, bad
 *  signature, expired, missing secret). Does NOT throw. */
export function verifyCustomerSession(token: string | null | undefined): CustomerSession | null {
  if (!token || !SECRET) return null;
  const parts = token.split(".");
  if (parts.length !== 3) return null;
  const [head, body, sig] = parts;
  const expected = hmac(`${head}.${body}`);
  // Constant-time compare. Length check first because timingSafeEqual
  // throws on length mismatch — we want a silent reject.
  const a = Buffer.from(sig, "utf8");
  const b = Buffer.from(expected, "utf8");
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
  let parsed: CustomerSession;
  try {
    parsed = JSON.parse(fromB64url(body).toString("utf8")) as CustomerSession;
  } catch {
    return null;
  }
  if (typeof parsed.exp !== "number" || parsed.exp < Math.floor(Date.now() / 1000)) {
    return null;
  }
  return parsed;
}

/** Pull and verify the bearer token off a NextRequest. Null when
 *  absent / invalid — callers decide whether absence is fatal. */
export function readCustomerSession(req: NextRequest): CustomerSession | null {
  const auth = req.headers.get("authorization");
  if (!auth || !auth.toLowerCase().startsWith("bearer ")) return null;
  return verifyCustomerSession(auth.slice(7).trim());
}
