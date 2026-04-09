import { createHmac, createHash } from "crypto";

// .trim() guards against accidental trailing newlines in env var values
const BASE_URL      = (process.env.RM_BASE_URL      || "https://sb.revenuemonster.my").trim();
const CLIENT_ID     = (process.env.RM_CLIENT_ID     || "").trim();
const CLIENT_SECRET = (process.env.RM_CLIENT_SECRET || "").trim();
const STORE_ID      = (process.env.RM_STORE_ID      || "").trim();

// ─── Token cache ──────────────────────────────────────────────────────────────

let _token: string | null = null;
let _tokenExpiry = 0;

async function getToken(): Promise<string> {
  if (_token && Date.now() < _tokenExpiry) return _token;

  const res = await fetch(`${BASE_URL}/auth/oauth/token`, {
    method: "POST",
    headers: {
      Authorization: `Basic ${Buffer.from(`${CLIENT_ID}:${CLIENT_SECRET}`).toString("base64")}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: "grant_type=client_credentials",
  });

  if (!res.ok) throw new Error(`RM token failed: ${res.status}`);
  const data = await res.json();
  _token       = data.access_token;
  _tokenExpiry = Date.now() + (data.expires_in - 60) * 1000; // 1 min buffer
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
  tng:     ["TNG_MY"],
  grabpay: ["GRABPAY_MY"],
  fpx:     ["FPX"],
  card:    ["CARD"],
  boost:   ["BOOST_MY"],
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
