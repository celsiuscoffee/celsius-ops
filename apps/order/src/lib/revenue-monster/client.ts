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
// key". The Vercel env-var textarea sometimes stores literal "\n"
// instead of real newlines (depends on how the value was pasted/saved),
// and PEM parsing fails on that — so unescape defensively. Same for any
// "\r\n" line endings that snuck in from Windows clipboards.
const SERVER_PUBLIC_KEY = (process.env.RM_SERVER_PUBLIC_KEY || "")
  .replace(/\\r\\n/g, "\n")
  .replace(/\\n/g, "\n")
  .trim();

// One-time boot diagnostic — one short line per fact so Vercel's log
// viewer (and our log-search MCP, which truncates each line) shows all
// of them. Lets us confirm the key actually parsed as a PEM without
// leaking the key body.
if (SERVER_PUBLIC_KEY) {
  const hasBegin    = SERVER_PUBLIC_KEY.includes("-----BEGIN");
  const hasEnd      = SERVER_PUBLIC_KEY.includes("-----END");
  const hasNewline  = SERVER_PUBLIC_KEY.includes("\n");
  const firstLine   = SERVER_PUBLIC_KEY.split("\n")[0]?.slice(0, 40) ?? "";
  console.log(`[rmkey] len=${SERVER_PUBLIC_KEY.length}`);
  console.log(`[rmkey] hasBegin=${hasBegin}`);
  console.log(`[rmkey] hasEnd=${hasEnd}`);
  console.log(`[rmkey] hasNewline=${hasNewline}`);
  console.log(`[rmkey] firstLine=${firstLine}`);
}

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

// Per RM's Payment Method appendix
// (https://doc.revenuemonster.my/docs/payment-method) the system method needs
// the region suffix appended — Malaysia = `_MY` — even for FPX whose system
// method name is just "FPX". Sending without the suffix returns
// DOES_NOT_HAVE_ACTIVE_WALLET.
//
// Card has no wallet-app deep link, so we use the hosted card page (step 1)
// for card payments — see the `directMethod === "CARD_MY"` branch in
// createPayment below, which mirrors the FPX-no-bank fallback.
export const PAYMENT_METHOD_MAP: Record<string, string[]> = {
  tng:       ["TNG_MY"],
  grabpay:   ["GRABPAY_MY"],
  fpx:       ["FPX_MY"],
  boost:     ["BOOST_MY"],
  shopeepay: ["SHOPEEPAY_MY"],
  card:      ["CARD_MY"],
  // "all" → empty array tells RM's hosted page to show every method
  // enabled on the merchant account.
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
  // For FPX only — the RM bank code (e.g. "MB2U0227:B2C") the customer
  // picked. Required because Direct Payment Checkout Mode: FPX needs the
  // bank pre-selected to mint the deep link.
  fpxBankCode?: string;
}

// Wrap a signed POST to RM. Single place for the sign-and-send dance.
async function rmPost<T extends { code: string; item?: unknown }>(
  endpoint: string,
  body: object,
  token: string,
): Promise<T> {
  const nonceStr  = nonce();
  const timestamp = String(Math.floor(Date.now() / 1000));
  const sig       = buildSignature("POST", endpoint, nonceStr, timestamp, body);
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
  return (await res.json()) as T;
}

// Pull the RM checkoutId out of the Hosted Payment Checkout response. RM
// returns it both as an item.checkoutId field and embedded in the URL —
// prefer the field, fall back to URL parsing for older responses.
function extractCheckoutId(item: Record<string, unknown> | undefined): string | null {
  if (!item) return null;
  if (typeof item.checkoutId === "string" && item.checkoutId.length > 0) {
    return item.checkoutId;
  }
  if (typeof item.url === "string") {
    const m = item.url.match(/[?&]checkoutId=([^&]+)/);
    if (m) return m[1];
  }
  return null;
}

export interface CreatePaymentResult {
  paymentUrl: string;   // deep link / hosted url to send the customer to
  checkoutId: string;   // RM checkout session id — needed to poll status
}

export async function createPayment(params: CreatePaymentParams): Promise<CreatePaymentResult> {
  const token = await getToken();

  // ─── Step 1: Hosted Payment Checkout ──────────────────────────────────
  // Mints a checkoutId for this order. We do not use the hosted URL it
  // returns — that's the consolidated RM landing page. We just need the
  // id so the next call can mint a wallet-specific deep link.
  //
  // RM caps order.id at 24 characters and treats it as globally unique
  // per merchant forever, so we suffix order_number with a base36
  // timestamp ("C-6319-lvk0a2b3") to dodge ORDER_ID_DUPLICATE on retries.
  // The webhook handler strips the suffix back to the base order_number.
  const rmOrderId = `${params.orderNumber}-${Date.now().toString(36)}`;
  const hostedBody = {
    order: {
      id:             rmOrderId,
      title:          "Celsius Coffee Order",
      detail:         `Pickup order #${params.orderNumber}`,
      additionalData: params.orderId,
      currencyType:   "MYR",
      amount:         params.amountSen,
    },
    method:        PAYMENT_METHOD_MAP[params.paymentMethod] || [],
    type:          "WEB_PAYMENT",
    storeId:       STORE_ID,
    redirectUrl:   params.redirectUrl,
    notifyUrl:     params.notifyUrl,
    layoutVersion: "v4",
  };
  const hosted = await rmPost<{
    code: string;
    item?: { url?: string; checkoutId?: string };
  }>(`${BASE_URL}/v3/payment/online`, hostedBody, token);
  if (hosted.code !== "SUCCESS") {
    throw new Error(`RM hosted checkout failed: ${JSON.stringify(hosted)}`);
  }
  const checkoutId = extractCheckoutId(hosted.item);
  if (!checkoutId) {
    throw new Error(`RM hosted checkout missing checkoutId: ${JSON.stringify(hosted.item)}`);
  }

  // ─── Step 2: Direct Payment Checkout (Mode: URL or Mode: FPX) ─────────
  // Mints the wallet/bank-specific deep link. Customer's app opens this
  // URL and is taken straight into the wallet (TNG / Boost / ShopeePay)
  // or the FPX bank's online banking page — no RM landing page in
  // between. Per RM docs, status updates may not flow through the
  // webhook reliably in Direct mode; the order screen's 5s React Query
  // poll provides the backstop.
  const directMethod = (PAYMENT_METHOD_MAP[params.paymentMethod] ?? [])[0];
  if (!directMethod) {
    throw new Error(`No RM method mapping for "${params.paymentMethod}"`);
  }
  // FPX needs a bank pre-selected to mint a Direct deep link. If the
  // client didn't send one (e.g. a stale bundle without the bank picker,
  // or a web caller skipping that flow), fall back gracefully to the
  // hosted page from step 1 — RM filters it to FPX and lets the customer
  // pick a bank there. Better than a 500.
  if (directMethod === "FPX_MY" && !params.fpxBankCode) {
    if (!hosted.item?.url) {
      throw new Error("FPX fallback failed: hosted checkout returned no url");
    }
    return { paymentUrl: hosted.item.url, checkoutId };
  }

  // Card has no wallet-app deep link — RM serves the card form on the
  // hosted page from step 1. The hosted body already filters method to
  // ["CARD_MY"], so the customer lands directly on the card form rather
  // than RM's consolidated picker.
  if (directMethod === "CARD_MY") {
    if (!hosted.item?.url) {
      throw new Error("Card fallback failed: hosted checkout returned no url");
    }
    return { paymentUrl: hosted.item.url, checkoutId };
  }
  const directBody: Record<string, unknown> = {
    checkoutId,
    type:   "URL",
    method: directMethod,
  };
  if (directMethod === "FPX_MY" && params.fpxBankCode) {
    directBody.fpx = { bankCode: params.fpxBankCode };
  }
  const direct = await rmPost<{
    code: string;
    item?: { url?: string; type?: string };
  }>(`${BASE_URL}/v3/payment/online/checkout`, directBody, token);
  if (direct.code !== "SUCCESS" || !direct.item?.url) {
    throw new Error(`RM direct checkout failed: ${JSON.stringify(direct)}`);
  }
  return { paymentUrl: direct.item.url, checkoutId };
}

// ─── Query Payment Checkout ───────────────────────────────────────────────────
//
// Webhook delivery is best-effort in Direct mode (per RM docs), so we need a
// way to ask RM directly whether a given checkout has been paid. The order
// detail screen polls this whenever a pending RM-routed order is open.

export type RmCheckoutStatus = "SUCCESS" | "FAILED" | "CANCELLED" | "EXPIRED" | "PENDING";

export interface QueryCheckoutResult {
  status:        RmCheckoutStatus;
  transactionId: string | null;
  raw:           unknown;
}

export async function queryCheckoutStatus(checkoutId: string): Promise<QueryCheckoutResult> {
  const token    = await getToken();
  const url      = `${BASE_URL}/v3/payment/online?checkoutId=${encodeURIComponent(checkoutId)}`;
  const nonceStr = nonce();
  const timestamp = String(Math.floor(Date.now() / 1000));
  // GET has no body, so the signing string omits the data= parameter
  // entirely (buildSignature handles that branch when body is undefined).
  const sig = buildSignature("GET", url, nonceStr, timestamp);
  const res = await fetch(url, {
    method: "GET",
    headers: {
      Authorization:  `Bearer ${token}`,
      "X-Nonce-Str":  nonceStr,
      "X-Timestamp":  timestamp,
      "X-Signature":  sig,
    },
  });
  const data = (await res.json()) as {
    code:   string;
    item?:  { status?: RmCheckoutStatus; transactionId?: string };
    error?: { code?: string; message?: string };
  };
  if (data.code !== "SUCCESS" || !data.item) {
    throw new Error(`RM query failed: ${JSON.stringify(data)}`);
  }
  return {
    status:        data.item.status ?? "PENDING",
    transactionId: data.item.transactionId ?? null,
    raw:           data,
  };
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
    console.warn("RM_SERVER_PUBLIC_KEY unset — skipping webhook signature verify");
    return true;
  }

  // Header value is "sha256 <base64sig>" — strip the "sha256 " prefix.
  const sigB64 = signature.startsWith("sha256 ") ? signature.slice(7) : signature;
  const signString = buildSigningString(method, "", nonce, timestamp, body);

  // Diagnostic — surface exactly what we compared so a mismatch shows up
  // as something actionable in the Vercel log instead of a silent warn.
  // signString gets long (base64 of the body) so we cap to the first 160
  // chars where the metadata lives.
  const debug = {
    sigPrefix:        sigB64.slice(0, 20),
    sigLen:           sigB64.length,
    signStringHead:   signString.slice(0, 160),
    signStringLen:    signString.length,
    bodyKeys:         Object.keys(body),
  };

  const verifier = createVerify("RSA-SHA256");
  verifier.update(signString);
  verifier.end();
  try {
    const ok = verifier.verify(SERVER_PUBLIC_KEY, sigB64, "base64");
    if (!ok) {
      console.warn("[rm] webhook sig mismatch", debug);
    }
    return ok;
  } catch (err) {
    console.warn("[rm] webhook sig verify threw", err, debug);
    return false;
  }
}
