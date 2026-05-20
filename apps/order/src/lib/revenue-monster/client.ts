import { createSign, createVerify } from "crypto";

// RM splits its API across two hostnames:
//   - BASE_URL  hosts the v3 payment endpoints (/v3/payment/online, ...)
//   - OAUTH_URL hosts the token endpoint (/v1/token)
//
// Production: open.revenuemonster.my + oauth.revenuemonster.my
// Sandbox:    sb-open.revenuemonster.my + sb-oauth.revenuemonster.my
//
// The legacy single-host pattern (sb.revenuemonster.my/auth/oauth/token)
// only worked on the v1 API and now 404s on v3. Always set both env vars
// together — see https://doc.revenuemonster.my for the host matrix.
//
// .trim() guards against accidental trailing newlines in env var values.
const BASE_URL      = (process.env.RM_BASE_URL      || "https://sb-open.revenuemonster.my").trim();
const OAUTH_URL     = (process.env.RM_OAUTH_URL     || "https://sb-oauth.revenuemonster.my").trim();
const CLIENT_ID     = (process.env.RM_CLIENT_ID     || "").trim();
const CLIENT_SECRET = (process.env.RM_CLIENT_SECRET || "").trim();
const STORE_ID      = (process.env.RM_STORE_ID      || "").trim();

// RSA private key (PEM) used to sign /v3 payment requests. RM verifies
// this with the client public key uploaded to the merchant portal. The
// env var should contain the full -----BEGIN/END----- PEM including
// newlines; Vercel's textarea preserves them. CLIENT_SECRET is unused
// here — it only authenticates the /v1/token call via Basic auth.
const PRIVATE_KEY   = (process.env.RM_PRIVATE_KEY   || "").trim();

// RM's server public key (PEM) used to verify webhook signatures. The
// merchant portal application page surfaces this under "Server public
// key". Optional at boot — without it we fall back to skipping
// verification and logging a warning rather than rejecting legitimate
// callbacks.
const SERVER_PUBLIC_KEY = (process.env.RM_SERVER_PUBLIC_KEY || "").trim();

// ─── Token cache ──────────────────────────────────────────────────────────────

let _token: string | null = null;
let _tokenExpiry = 0;

async function getToken(): Promise<string> {
  if (_token && Date.now() < _tokenExpiry) return _token;

  // RM's token endpoint deviates from the OAuth 2.0 spec in two ways:
  //   1. The body is application/json, not application/x-www-form-urlencoded.
  //   2. The grant_type key is camelCased to "grantType".
  // Response keys are likewise camelCase: accessToken, expiresIn, etc.
  // The previous form-encoded body returned {"error":{"code":"INVALID_GRANT"}}
  // because RM couldn't find "grantType" in the parsed JSON.
  // Reference: https://doc.revenuemonster.my/docs/quickstart/accesstoken/client-credentials
  const res = await fetch(`${OAUTH_URL}/v1/token`, {
    method: "POST",
    headers: {
      Authorization: `Basic ${Buffer.from(`${CLIENT_ID}:${CLIENT_SECRET}`).toString("base64")}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ grantType: "client_credentials" }),
  });

  if (!res.ok) {
    // Surface the response body so the Vercel log shows the actual RM
    // complaint (invalid_client, scope_required, etc.) instead of a bare
    // status code. Falls back gracefully if the body isn't JSON.
    const detail = await res.text().catch(() => "");
    throw new Error(`RM token failed: ${res.status} ${detail.slice(0, 200)}`);
  }
  const data = (await res.json()) as { accessToken?: string; expiresIn?: number };
  if (!data.accessToken) {
    throw new Error("RM token response missing accessToken");
  }
  _token       = data.accessToken;
  // expiresIn is in seconds. RM tokens typically last ~30 days; subtract
  // 60s so we refresh slightly before expiry and never present a stale
  // token to /v3/payment/online.
  _tokenExpiry = Date.now() + ((data.expiresIn ?? 3600) - 60) * 1000;
  return _token!;
}

// ─── RSA-SHA256 signature ────────────────────────────────────────────────────
//
// RM's signature spec (see
// https://doc.revenuemonster.my/docs/quickstart/signature-algorithm):
//   1. Sort the JSON body keys alphabetically — recursively, nested
//      objects included.
//   2. Compact-stringify the sorted body. Replace `<`, `>`, `&` with
//      their unicode escape sequences (< / > / &) so the
//      same bytes encode whether the receiver double-decodes JSON.
//   3. Base64-encode that string into the `data` parameter.
//   4. Build the canonical plain-text in alphabetical parameter order:
//        data=<b64>&method=post&nonceStr=...&requestUrl=...&signType=sha256&timestamp=...
//      (When the body is empty, omit `data`; when verifying a callback,
//      omit `requestUrl` — RM doesn't have it on their end.)
//   5. RSA-SHA256-sign the plain text with the CLIENT private key. The
//      X-Signature header value is `sha256 <base64(signature)>`.
// RM verifies our signature against the client public key we uploaded
// to the merchant portal earlier in the integration setup.

function sortKeys(obj: unknown): unknown {
  if (Array.isArray(obj)) return obj.map(sortKeys);
  if (obj && typeof obj === "object") {
    const sorted: Record<string, unknown> = {};
    for (const key of Object.keys(obj as Record<string, unknown>).sort()) {
      sorted[key] = sortKeys((obj as Record<string, unknown>)[key]);
    }
    return sorted;
  }
  return obj;
}

function rmEscapeJson(s: string): string {
  // RM's spec — must match server-side rewriting so the base64 of the
  // sorted JSON is identical on both sides of the signature.
  return s
    .replace(/</g, "\\u003c")
    .replace(/>/g, "\\u003e")
    .replace(/&/g, "\\u0026");
}

function buildSigningString(
  method: string,
  url: string,
  nonce: string,
  timestamp: string,
  body?: object,
): string {
  const parts: string[] = [];
  if (body && Object.keys(body).length > 0) {
    const sortedJson  = JSON.stringify(sortKeys(body));
    const escapedJson = rmEscapeJson(sortedJson);
    const dataB64     = Buffer.from(escapedJson, "utf8").toString("base64");
    parts.push(`data=${dataB64}`);
  }
  parts.push(`method=${method.toLowerCase()}`);
  parts.push(`nonceStr=${nonce}`);
  if (url) parts.push(`requestUrl=${url}`);
  parts.push(`signType=sha256`);
  parts.push(`timestamp=${timestamp}`);
  return parts.join("&");
}

function buildSignature(
  method: string,
  url: string,
  nonce: string,
  timestamp: string,
  body?: object,
): string {
  if (!PRIVATE_KEY) {
    throw new Error(
      "RM_PRIVATE_KEY env var is missing — required to sign /v3 payment requests.",
    );
  }
  const signString = buildSigningString(method, url, nonce, timestamp, body);
  const signer = createSign("RSA-SHA256");
  signer.update(signString);
  signer.end();
  const sigBase64 = signer.sign(PRIVATE_KEY, "base64");
  return `sha256 ${sigBase64}`;
}

function nonce() {
  return Math.random().toString(36).substring(2) + Math.random().toString(36).substring(2);
}

// ─── Public API ───────────────────────────────────────────────────────────────

export const PAYMENT_METHOD_MAP: Record<string, string[]> = {
  tng:       ["TNG_MY"],
  grabpay:   ["GRABPAY_MY"],
  fpx:       ["FPX"],
  card:      ["CARD"],
  boost:     ["BOOST_MY"],
  shopeepay: ["SHOPEEPAY_MY"],
  // "all" → empty array tells RM's hosted page to show every method
  // enabled on the merchant account. Useful for the native pickup app's
  // single "Pay with RM" tile, which delegates method picking to RM's
  // own checkout UI instead of forcing the customer to pre-select.
  all:       [],
};

export interface CreatePaymentParams {
  orderId: string;
  orderNumber: string;
  storeId: string;
  amountSen: number;          // integer sen
  paymentMethod: string;      // app payment method id
  redirectUrl: string;
  notifyUrl: string;
}

export async function createPayment(params: CreatePaymentParams): Promise<string> {
  const token     = await getToken();
  const endpoint  = `${BASE_URL}/v3/payment/online`;
  const nonceStr  = nonce();
  const timestamp = String(Math.floor(Date.now() / 1000));

  const body = {
    order: {
      id:             params.orderId,
      title:          "Celsius Coffee Order",
      detail:         `Pickup order #${params.orderNumber}`,
      additionalData: params.storeId,
      currencyType:   "MYR",
      amount:         params.amountSen,
    },
    method:        PAYMENT_METHOD_MAP[params.paymentMethod] || [],
    type:          "WEB_PAYMENT",
    storeId:       STORE_ID,
    redirectUrl:   params.redirectUrl,
    notifyUrl:     params.notifyUrl,
    layoutVersion: "v3",
  };

  const sig = buildSignature("POST", endpoint, nonceStr, timestamp, body);

  const res = await fetch(endpoint, {
    method: "POST",
    headers: {
      Authorization:  `Bearer ${token}`,
      "Content-Type": "application/json",
      "X-Nonce-Str":  nonceStr,
      "X-Timestamp":  timestamp,
      "X-Signature":  sig,
    },
    body: JSON.stringify(body),
  });

  const data = await res.json();
  if (data.code !== "SUCCESS") {
    throw new Error(`RM payment failed: ${JSON.stringify(data)}`);
  }

  return data.item.url as string;
}

// ─── Webhook validation ───────────────────────────────────────────────────────
//
// RM signs callback bodies with their server's private key. We verify
// against RM's server public key (the "Server public key" textarea in
// the merchant portal Application page; passed in via RM_SERVER_PUBLIC_KEY).
// The signing string follows the same algorithm as outgoing signatures
// except `requestUrl` is omitted (RM doesn't know our exact callback URL).

export function validateWebhookSignature(
  method: string,
  _url: string, // unused — RM omits requestUrl from inbound signatures
  nonce: string,
  timestamp: string,
  body: object,
  signature: string,
): boolean {
  if (!SERVER_PUBLIC_KEY) {
    // No public key configured — fall back to accepting the callback so
    // the order flow isn't blocked. Logged loudly by the caller via
    // console.warn("Webhook signature mismatch") if isValid is false.
    console.warn("RM_SERVER_PUBLIC_KEY unset — skipping webhook signature verify");
    return true;
  }

  // Header value is "sha256 <base64sig>" — strip the "sha256 " prefix.
  const sigB64 = signature.startsWith("sha256 ") ? signature.slice(7) : signature;
  const signString = buildSigningString(method, "", nonce, timestamp, body);

  const verifier = createVerify("RSA-SHA256");
  verifier.update(signString);
  verifier.end();
  try {
    return verifier.verify(SERVER_PUBLIC_KEY, sigB64, "base64");
  } catch {
    return false;
  }
}
