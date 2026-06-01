/**
 * Compatibility alias for the GrabFood order webhook.
 *
 * The canonical handler lives at /api/pos/grab/webhook. This store's Grab
 * Partner Portal has its Submit Order + Push Order State webhook configured at
 * the NON-/pos path /api/grab/webhook (its OAuth URL is correctly /pos), so
 * every order POST/PUT here was 404'ing. Rather than wait on a portal edit
 * (slow to propagate, and Grab may cache it), we serve the EXACT same handler
 * at this path too — both URLs now work.
 *
 * CSRF: /api/grab/webhook is added to middleware.ts exemptPrefixes (parity with
 * the /pos/grab/webhook carve-out) so HMAC-signed, Origin-less Grab calls pass.
 */
export { POST, PUT, GET } from "@/app/api/pos/grab/webhook/route";
