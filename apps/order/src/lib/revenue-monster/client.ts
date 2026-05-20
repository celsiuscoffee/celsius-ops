import { createHmac, createHash } from "crypto";

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

// ─── HMAC signature ───────────────────────────────────────────────────────────

function buildSignature(
  method: string,
  url: string,
  nonce: string,
  timestamp: string,
  body?: object
): string {
  let parts = [
    `method=${method}`,
    `nonceStr=${nonce}`,
    `requestUrl=${url}`,
    `signType=sha256`,
    `timestamp=${timestamp}`,
  ];

  if (body) {
    const hash = createHash("sha256")
      .update(JSON.stringify(body))
      .digest("hex");
    parts = [...parts, `payloadHash=${hash}`];
  }

  const sigString = parts.join("&");
  return "sha256 " + createHmac("sha256", CLIENT_SECRET)
    .update(sigString)
    .digest("hex");
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

export function validateWebhookSignature(
  method: string,
  url: string,
  nonce: string,
  timestamp: string,
  body: object,
  signature: string
): boolean {
  const expected = buildSignature(method, url, nonce, timestamp, body);
  return expected === signature;
}
