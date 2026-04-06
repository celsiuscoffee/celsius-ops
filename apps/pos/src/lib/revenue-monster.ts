/**
 * Revenue Monster Terminal Integration
 *
 * Handles OAuth2 authentication, request signing (RSA-SHA256),
 * and terminal payment API calls.
 *
 * Docs: https://doc.revenuemonster.my/docs/v2/payment/terminal-integration
 */

import crypto from "crypto";

// ─── Config ───────────────────────────────────────────────

const RM_ENV = process.env.RM_ENV || "sandbox"; // "sandbox" | "production"

const RM_BASE_URL =
  RM_ENV === "production"
    ? "https://open.revenuemonster.my"
    : "https://sb-open.revenuemonster.my";

const RM_OAUTH_URL =
  RM_ENV === "production"
    ? "https://oauth.revenuemonster.my"
    : "https://sb-oauth.revenuemonster.my";

const RM_CLIENT_ID = process.env.RM_CLIENT_ID || "";
const RM_CLIENT_SECRET = process.env.RM_CLIENT_SECRET || "";
const RM_PRIVATE_KEY = process.env.RM_PRIVATE_KEY || ""; // PEM format
const RM_TERMINAL_ID = process.env.RM_TERMINAL_ID || "";

// ─── Token Cache ──────────────────────────────────────────

let cachedToken: { accessToken: string; expiresAt: number } | null = null;

/**
 * Get OAuth2 access token (client credentials grant).
 * Caches token until 60s before expiry.
 */
export async function getAccessToken(): Promise<string> {
  if (cachedToken && Date.now() < cachedToken.expiresAt) {
    return cachedToken.accessToken;
  }

  const credentials = Buffer.from(`${RM_CLIENT_ID}:${RM_CLIENT_SECRET}`).toString("base64");

  const res = await fetch(`${RM_OAUTH_URL}/v1/token`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Basic ${credentials}`,
    },
    body: JSON.stringify({ grantType: "client_credentials" }),
  });

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`RM OAuth failed (${res.status}): ${text}`);
  }

  const data = await res.json();
  const accessToken = data.accessToken;
  // Cache with 60s buffer before actual expiry
  const expiresIn = (data.expiresIn ?? 7200) - 60;
  cachedToken = {
    accessToken,
    expiresAt: Date.now() + expiresIn * 1000,
  };

  return accessToken;
}

// ─── Request Signing (RSA-SHA256) ─────────────────────────

function sortObjectKeys(obj: Record<string, unknown>): Record<string, unknown> {
  const sorted: Record<string, unknown> = {};
  for (const key of Object.keys(obj).sort()) {
    const val = obj[key];
    if (val && typeof val === "object" && !Array.isArray(val)) {
      sorted[key] = sortObjectKeys(val as Record<string, unknown>);
    } else {
      sorted[key] = val;
    }
  }
  return sorted;
}

function generateSignature(
  method: string,
  requestUrl: string,
  body: Record<string, unknown>,
  nonceStr: string,
  timestamp: string
): string {
  // Step 1: Sort keys and compact JSON
  const sorted = sortObjectKeys(body);
  const compact = JSON.stringify(sorted)
    .replace(/</g, "\\u003c")
    .replace(/>/g, "\\u003e")
    .replace(/&/g, "\\u0026");

  // Step 2: Base64 encode
  const data = Buffer.from(compact).toString("base64");

  // Step 3: Construct plain text
  const plainText = `data=${data}&method=${method.toLowerCase()}&nonceStr=${nonceStr}&requestUrl=${requestUrl}&signType=sha256&timestamp=${timestamp}`;

  // Step 4: Sign with RSA private key
  const sign = crypto.createSign("SHA256");
  sign.update(plainText);
  sign.end();

  const privateKey = RM_PRIVATE_KEY.includes("BEGIN")
    ? RM_PRIVATE_KEY
    : `-----BEGIN RSA PRIVATE KEY-----\n${RM_PRIVATE_KEY}\n-----END RSA PRIVATE KEY-----`;

  return sign.sign(privateKey, "base64");
}

function generateNonce(length = 32): string {
  return crypto.randomBytes(length).toString("hex").slice(0, length);
}

// ─── Signed API Request ───────────────────────────────────

async function rmRequest<T>(
  method: string,
  path: string,
  body: Record<string, unknown>
): Promise<T> {
  const accessToken = await getAccessToken();
  const requestUrl = `${RM_BASE_URL}${path}`;
  const nonceStr = generateNonce();
  const timestamp = Math.floor(Date.now() / 1000).toString();

  const signature = generateSignature(method, requestUrl, body, nonceStr, timestamp);

  const res = await fetch(requestUrl, {
    method: method.toUpperCase(),
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${accessToken}`,
      "X-Signature": `sha256 ${signature}`,
      "X-Nonce-Str": nonceStr,
      "X-Timestamp": timestamp,
    },
    body: JSON.stringify(body),
  });

  const data = await res.json();

  if (!res.ok || data.code !== "SUCCESS") {
    const errMsg = data.error?.message || data.error?.code || `HTTP ${res.status}`;
    throw new Error(`RM API error: ${errMsg}`);
  }

  return data;
}

// ─── Terminal Payment Types ───────────────────────────────

export type RMPaymentType = "E-WALLET" | "RETAIL-QR" | "CARD";

export type RMTerminalPaymentRequest = {
  orderId: string;
  orderTitle: string;
  amount: number; // in sen (cents), e.g. 1390 for RM 13.90
  type: RMPaymentType;
  receiptType?: number; // 1=both, 2=customer only, 3=none
};

export type RMTerminalPaymentResponse = {
  code: string;
  item: {
    transactionId: string;
    order: {
      id: string;
      title: string;
      amount: number;
    };
    status: string;
    paymentMethod?: string;
  };
};

// ─── Terminal Quick Pay ───────────────────────────────────

/**
 * Initiate a payment on the Revenue Monster terminal.
 * This pushes the payment request to the physical terminal device.
 */
export async function initiateTerminalPayment(
  req: RMTerminalPaymentRequest
): Promise<RMTerminalPaymentResponse> {
  const terminalId = RM_TERMINAL_ID;
  if (!terminalId) throw new Error("RM_TERMINAL_ID not configured");

  const body = {
    terminalId,
    type: req.type,
    receiptType: req.receiptType ?? 3, // default: no print (POS prints its own)
    cameraType: req.type === "CARD" ? "BACK" : "FRONT",
    order: {
      amount: req.amount,
      currencyType: "MYR",
      id: req.orderId.slice(0, 24),
      title: req.orderTitle.slice(0, 32),
      detail: "",
      additionalData: "",
    },
  };

  return rmRequest<RMTerminalPaymentResponse>(
    "post",
    "/v3/payment/terminal/quickpay",
    body
  );
}

// ─── Terminal Event (Refund/Cancel/Settlement) ────────────

export type RMTerminalEventType = "CANCEL" | "SETTLEMENT";

export async function sendTerminalEvent(
  eventType: RMTerminalEventType,
  transactionId?: string,
  extra?: Record<string, string>
): Promise<unknown> {
  const terminalId = RM_TERMINAL_ID;
  if (!terminalId) throw new Error("RM_TERMINAL_ID not configured");

  const body: Record<string, unknown> = {
    terminalId,
    type: eventType,
    ...(transactionId ? { transactionId } : {}),
    ...(extra ?? {}),
  };

  return rmRequest("post", "/v3/event/terminal", body);
}

// ─── Config Check ─────────────────────────────────────────

export function isRMConfigured(): boolean {
  return !!(RM_CLIENT_ID && RM_CLIENT_SECRET && RM_PRIVATE_KEY && RM_TERMINAL_ID);
}

export function getRMConfig() {
  return {
    env: RM_ENV,
    configured: isRMConfigured(),
    terminalId: RM_TERMINAL_ID ? `...${RM_TERMINAL_ID.slice(-4)}` : "not set",
  };
}
