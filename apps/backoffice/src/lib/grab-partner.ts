/**
 * Partner-side (Grab → POS) OAuth helpers.
 *
 * Grab authenticates to OUR inbound webhooks: it calls our /api/grab/oauth/token
 * endpoint with the Partner client ID/secret (defined in the GrabFood portal's
 * "Partner configuration" and mirrored as env vars here), gets a Bearer token,
 * and presents it on the submit-order / push-state / get-menu / etc. webhooks.
 *
 * This is the reverse of lib/grab.ts getAccessToken() (token FROM Grab for our
 * outbound calls). Env:
 *   GRAB_PARTNER_CLIENT_ID, GRAB_PARTNER_CLIENT_SECRET  — set the SAME values in
 *     the portal's Partner client ID/secret fields (staging / primary).
 *   GRAB_PARTNER_CLIENT_ID_PROD, GRAB_PARTNER_CLIENT_SECRET_PROD (optional) — the
 *     production project's pair. When set, the OAuth endpoint accepts EITHER pair,
 *     so ONE backoffice serves staging + production at once (no go-live swap —
 *     just add these, remove the staging pair later if you want).
 *   GRAB_PARTNER_JWT_SECRET (recommended) — fixed HS256 key for the issued token;
 *     falls back to GRAB_PARTNER_CLIENT_SECRET. Set a dedicated value so the token
 *     signing key never changes when creds rotate.
 */

import { SignJWT, jwtVerify } from "jose";
import type { NextRequest } from "next/server";

export const PARTNER_TOKEN_TTL_SECONDS = 7 * 24 * 60 * 60; // 7 days (mirrors Grab)
const ISSUER = "celsius-pos";
const AUDIENCE = "grabfood";

function signingKey(): Uint8Array {
  const s = process.env.GRAB_PARTNER_JWT_SECRET
    || process.env.GRAB_PARTNER_CLIENT_SECRET
    || process.env.GRAB_PARTNER_CLIENT_SECRET_PROD
    || "";
  return new TextEncoder().encode(s);
}

/** Configured partner client/secret pairs: the primary
 *  (GRAB_PARTNER_CLIENT_ID/SECRET, used for staging) plus an optional production
 *  pair (…_PROD). Accepting both lets ONE backoffice serve the staging AND
 *  production Grab projects at the same time — go-live becomes "add the _PROD
 *  vars", with nothing to remove or flip. */
function partnerPairs(): Array<{ id: string; secret: string }> {
  const pairs: Array<{ id: string; secret: string }> = [];
  // Trim so a stray space/newline pasted into a Vercel env var can't break the
  // exact-match compare in partnerCredsMatch.
  const add = (id?: string, secret?: string) => {
    const i = (id ?? "").trim();
    const s = (secret ?? "").trim();
    if (i && s) pairs.push({ id: i, secret: s });
  };
  add(process.env.GRAB_PARTNER_CLIENT_ID, process.env.GRAB_PARTNER_CLIENT_SECRET);
  add(process.env.GRAB_PARTNER_CLIENT_ID_PROD, process.env.GRAB_PARTNER_CLIENT_SECRET_PROD);
  // GrabFood's POS API uses ONE OAuth client credential in BOTH directions: Grab
  // presents our outbound Client ID/secret (GRAB_CLIENT_ID/SECRET) on its inbound
  // calls to this token endpoint. Accept it so inbound auth works off the already-
  // verified outbound creds — no separate partner pair to configure or match.
  add(process.env.GRAB_CLIENT_ID, process.env.GRAB_CLIENT_SECRET);
  return pairs;
}

/** True if the supplied client credentials match ANY configured partner pair. */
export function partnerCredsMatch(clientId: unknown, clientSecret: unknown): boolean {
  if (typeof clientId !== "string" || typeof clientSecret !== "string") return false;
  const id = clientId.trim();
  const secret = clientSecret.trim();
  return partnerPairs().some((p) => p.id === id && p.secret === secret);
}

export function partnerConfigured(): boolean {
  return partnerPairs().length > 0;
}

/** Mint the Bearer token Grab will present on our inbound webhooks. */
export async function issuePartnerToken(clientId: string, scope = ""): Promise<string> {
  return new SignJWT({ scope })
    .setProtectedHeader({ alg: "HS256" })
    .setSubject(clientId)
    .setIssuer(ISSUER)
    .setAudience(AUDIENCE)
    .setIssuedAt()
    .setExpirationTime(`${PARTNER_TOKEN_TTL_SECONDS}s`)
    .sign(signingKey());
}

/** Validate the Bearer token Grab presents on an inbound webhook request. */
export async function verifyGrabPartnerToken(req: NextRequest): Promise<boolean> {
  const auth = req.headers.get("authorization") || "";
  const token = auth.toLowerCase().startsWith("bearer ") ? auth.slice(7).trim() : "";
  if (!token) return false;
  try {
    await jwtVerify(token, signingKey(), { issuer: ISSUER, audience: AUDIENCE });
    return true;
  } catch {
    return false;
  }
}
