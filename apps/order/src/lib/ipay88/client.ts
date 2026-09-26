import { createHmac, timingSafeEqual } from "crypto";

// iPay88 (ADAPTIS) hosted-page integration — Malaysia OPSG protocol.
//
// Flow: our server signs a payment request → the customer's browser POSTs it
// to iPay88's hosted page (entry.asp) → iPay88 POSTs the result to both our
// ResponseURL (browser) and BackendURL (server-to-server), each carrying an
// HMAC signature over the result → we can also ask iPay88 directly via the
// Requery endpoint.
//
// Signatures are HMAC-SHA512 keyed with the merchant key (iPay88 retired
// SHA-256 on 2025-01-31). The signed string is the plain concatenation of the
// fields below, with the merchant key itself as the first element:
//   request:  MerchantKey + MerchantCode + RefNo + Amount + Currency
//   response: MerchantKey + MerchantCode + PaymentId + RefNo + Amount + Currency + Status
// Amount in a signature is digits only ("1,278.99" → "127899").
//
// Everything here fails CLOSED: a signature built to a different spec than
// iPay88 expects makes iPay88 reject the request, and a mismatched response
// signature or an unrecognised requery answer never settles an order. So a
// spec drift costs a failed payment attempt, never a false "paid".
//
// Config (all .trim()'d — Vercel's textarea keeps trailing newlines):
//   IPAY88_MERCHANT_CODE / IPAY88_MERCHANT_KEY  default merchant account
//   IPAY88_MERCHANTS     JSON { "<orders.store_id>": { "key": "...", "code"?: "..." } }
//                        per-outlet accounts, so each outlet's sales settle into
//                        its own company's bank account (same reason RM keeps a
//                        per-outlet store map). `code` defaults to the outlet's
//                        entry in OUTLET_MERCHANT_CODES below, so normally only
//                        the secret key is set. Outlets missing here fall back
//                        to the default account.
//   IPAY88_PAYMENT_URL   hosted page (default: production entry.asp)
//   IPAY88_REQUERY_URL   requery endpoint (default: production enquiry.asp)
//   IPAY88_PAYMENT_IDS   JSON { "<method_id>": "<iPay88 PaymentId>" } — which
//                        iPay88 payment option each app method opens. REQUIRED
//                        per method: NTT DATA (iPay88) confirmed every payment
//                        request must carry a PaymentId (email, 2026-09-11). A
//                        method switched to iPay88 without one is hidden from
//                        customers and refused server-side (see isIpay88Ready).

const DEFAULT_PAYMENT_URL = "https://payment.ipay88.com.my/ePayment/entry.asp";
const DEFAULT_REQUERY_URL = "https://payment.ipay88.com.my/ePayment/enquiry.asp";

export const IPAY88_CURRENCY = "MYR";
export const IPAY88_SIGNATURE_TYPE = "HMACSHA512";

/** payment_checkout_id prefix marking an order as iPay88-routed. */
export const IPAY88_CHECKOUT_PREFIX = "ipay88:";

// Production MerchantCodes per outlet, one per operating company — from
// NTT DATA (iPay88), email to Ammar, 2026-09-25. The MerchantCode is sent in
// every request, so it is not secret; the matching MerchantKey is, and lives
// only in IPAY88_MERCHANTS. Keys are orders.store_id. ADAPTIS Merchant IDs are
// recorded for the portal/support, not used by the API.
export const OUTLET_MERCHANT_CODES: Record<string, string> = {
  "shah-alam": "MM26330009", // CELSIUS COFFEE SDN. BHD.            (Merchant ID 563652522644021256)
  conezion: "MM26330007",    // CELSIUS COFFEE CONEZION SDN. BHD.   (Merchant ID 563646006876643336)
  tamarind: "MM26330008",    // CELSIUS COFFEE TAMARIND SDN. BHD.   (Merchant ID 563649369844424712)
};

export interface Ipay88Merchant {
  code: string;
  key: string;
}

function env(name: string): string {
  return (process.env[name] ?? "").trim();
}

function parseJsonEnv<T>(name: string): T | null {
  const raw = env(name);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as T;
  } catch {
    console.warn(`[ipay88] ${name} is not valid JSON — ignoring`);
    return null;
  }
}

function allMerchants(): { byStore: Record<string, Ipay88Merchant>; fallback: Ipay88Merchant | null } {
  const byStore: Record<string, Ipay88Merchant> = {};
  const map = parseJsonEnv<Record<string, { code?: string; key?: string }>>("IPAY88_MERCHANTS") ?? {};
  for (const [storeId, m] of Object.entries(map)) {
    const code = (m?.code ?? OUTLET_MERCHANT_CODES[storeId] ?? "").trim();
    const key = (m?.key ?? "").trim();
    if (code && key) byStore[storeId] = { code, key };
  }
  const code = env("IPAY88_MERCHANT_CODE");
  const key = env("IPAY88_MERCHANT_KEY");
  return { byStore, fallback: code && key ? { code, key } : null };
}

/** Merchant account an outlet's payments go to, or null if iPay88 isn't configured for it. */
export function merchantForStore(storeId: string): Ipay88Merchant | null {
  const { byStore, fallback } = allMerchants();
  return byStore[storeId] ?? fallback;
}

/** Look up a merchant by the MerchantCode iPay88 echoes back in a response. */
export function merchantByCode(code: string): Ipay88Merchant | null {
  const { byStore, fallback } = allMerchants();
  for (const m of Object.values(byStore)) if (m.code === code) return m;
  return fallback && fallback.code === code ? fallback : null;
}

export function paymentUrl(): string {
  return env("IPAY88_PAYMENT_URL") || DEFAULT_PAYMENT_URL;
}

export function requeryUrl(): string {
  return env("IPAY88_REQUERY_URL") || DEFAULT_REQUERY_URL;
}

/** iPay88 PaymentId for an app method id, or "" when none is configured. */
export function paymentIdFor(methodId: string): string {
  const ids = parseJsonEnv<Record<string, string | number>>("IPAY88_PAYMENT_IDS") ?? {};
  const v = ids[methodId];
  return v == null ? "" : String(v).trim();
}

/**
 * Whether a method can actually be paid through iPay88: it has a PaymentId
 * and (for a given outlet, or any outlet when storeId is omitted) a merchant
 * account. Routing a method that fails this would send customers to an
 * iPay88 error page, so callers hide or refuse it instead.
 */
export function isIpay88Ready(methodId: string, storeId?: string): boolean {
  if (!paymentIdFor(methodId)) return false;
  if (storeId) return merchantForStore(storeId) != null;
  const { byStore, fallback } = allMerchants();
  return fallback != null || Object.keys(byStore).length > 0;
}

/** Sen → iPay88 amount string: two decimals with thousands separators ("1,278.99"). */
export function formatAmount(sen: number): string {
  if (!Number.isInteger(sen) || sen < 0) throw new Error(`invalid amount (sen): ${sen}`);
  const ringgit = Math.floor(sen / 100).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  return `${ringgit}.${String(sen % 100).padStart(2, "0")}`;
}

/** iPay88 amount string → sen, or null if it isn't a well-formed amount. */
export function parseAmountSen(amount: string): number | null {
  const m = /^(\d{1,3}(?:,\d{3})*|\d+)\.(\d{2})$/.exec(amount.trim());
  if (!m) return null;
  return Number(m[1].replace(/,/g, "")) * 100 + Number(m[2]);
}

function signatureAmount(amount: string): string {
  return amount.replace(/[.,]/g, "");
}

function hmac(key: string, parts: string[]): string {
  return createHmac("sha512", key).update(parts.join(""), "utf8").digest("hex");
}

export function requestSignature(
  merchant: Ipay88Merchant,
  refNo: string,
  amount: string,
  currency: string = IPAY88_CURRENCY,
): string {
  return hmac(merchant.key, [merchant.key, merchant.code, refNo, signatureAmount(amount), currency]);
}

export function responseSignature(
  merchant: Ipay88Merchant,
  f: { paymentId: string; refNo: string; amount: string; currency: string; status: string },
): string {
  return hmac(merchant.key, [
    merchant.key,
    merchant.code,
    f.paymentId,
    f.refNo,
    signatureAmount(f.amount),
    f.currency,
    f.status,
  ]);
}

function safeEqualHex(a: string, b: string): boolean {
  const x = Buffer.from(a.toLowerCase(), "utf8");
  const y = Buffer.from(b.toLowerCase(), "utf8");
  return x.length === y.length && timingSafeEqual(x, y);
}

/** Fields iPay88 posts to ResponseURL and BackendURL. */
export interface Ipay88Response {
  merchantCode: string;
  paymentId: string;
  refNo: string;
  amount: string;
  currency: string;
  remark: string;
  transId: string;
  authCode: string;
  status: string; // "1" success, "0" fail
  errDesc: string;
  signature: string;
}

export function parseResponse(form: URLSearchParams | FormData): Ipay88Response {
  const get = (k: string) => {
    const v = form.get(k);
    return typeof v === "string" ? v.trim() : "";
  };
  return {
    merchantCode: get("MerchantCode"),
    paymentId: get("PaymentId"),
    refNo: get("RefNo"),
    amount: get("Amount"),
    currency: get("Currency"),
    remark: get("Remark"),
    transId: get("TransId"),
    authCode: get("AuthCode"),
    status: get("Status"),
    errDesc: get("ErrDesc"),
    signature: get("Signature"),
  };
}

/** True only when the response is signed with the key of the merchant it names. */
export function verifyResponse(r: Ipay88Response): boolean {
  if (!r.signature || !r.merchantCode) return false;
  const merchant = merchantByCode(r.merchantCode);
  if (!merchant) return false;
  return safeEqualHex(responseSignature(merchant, r), r.signature);
}

export interface PaymentRequestInput {
  merchant: Ipay88Merchant;
  refNo: string;
  amountSen: number;
  methodId: string;
  prodDesc: string;
  userName: string;
  userEmail: string;
  userContact: string;
  remark: string;
  responseUrl: string;
  backendUrl: string;
}

/** Form fields for the POST to iPay88's hosted page. */
export function buildPaymentRequest(input: PaymentRequestInput): Record<string, string> {
  const amount = formatAmount(input.amountSen);
  return {
    MerchantCode: input.merchant.code,
    PaymentId: paymentIdFor(input.methodId),
    RefNo: input.refNo,
    Amount: amount,
    Currency: IPAY88_CURRENCY,
    ProdDesc: input.prodDesc.slice(0, 100),
    UserName: input.userName.slice(0, 100),
    UserEmail: input.userEmail.slice(0, 100),
    UserContact: input.userContact.slice(0, 20),
    Remark: input.remark.slice(0, 100),
    Lang: "UTF-8",
    SignatureType: IPAY88_SIGNATURE_TYPE,
    Signature: requestSignature(input.merchant, input.refNo, amount),
    ResponseURL: input.responseUrl,
    BackendURL: input.backendUrl,
  };
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/**
 * A self-submitting HTML page that POSTs the signed request to iPay88. iPay88
 * only accepts a form POST, while both clients (web checkout redirect, native
 * payment modal) can only open a URL — this page bridges the two.
 */
export function renderAutoSubmitPage(action: string, fields: Record<string, string>): string {
  const inputs = Object.entries(fields)
    .map(([k, v]) => `<input type="hidden" name="${escapeHtml(k)}" value="${escapeHtml(v)}">`)
    .join("");
  return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Redirecting to payment…</title></head><body style="font-family:system-ui,sans-serif;text-align:center;padding:48px 16px;color:#160800"><form id="f" method="post" action="${escapeHtml(action)}">${inputs}<p>Opening secure payment…</p><noscript><button type="submit">Continue to payment</button></noscript></form><script>document.getElementById("f").submit()</script></body></html>`;
}

export type RequeryStatus = "SUCCESS" | "FAILED" | "UNPAID" | "PENDING" | "UNKNOWN";

/**
 * Ask iPay88 for a transaction's status. Answers "00" for a successful
 * payment; anything else is a human-readable reason. iPay88 also checks the
 * amount, so "00" means paid IN FULL for this RefNo.
 */
export async function requery(
  merchant: Ipay88Merchant,
  refNo: string,
  amountSen: number,
): Promise<{ status: RequeryStatus; raw: string }> {
  const qs = new URLSearchParams({
    MerchantCode: merchant.code,
    RefNo: refNo,
    Amount: formatAmount(amountSen),
  });
  const res = await fetch(`${requeryUrl()}?${qs.toString()}`, {
    method: "GET",
    signal: AbortSignal.timeout(10_000),
  });
  const raw = (await res.text()).trim();
  if (!res.ok) throw new Error(`iPay88 requery HTTP ${res.status}: ${raw.slice(0, 200)}`);
  return { status: classifyRequery(raw), raw };
}

export function classifyRequery(raw: string): RequeryStatus {
  const r = raw.trim().toLowerCase();
  if (r === "00") return "SUCCESS";
  if (r.includes("payment fail")) return "FAILED";
  if (r.includes("record not found") || r.includes("haven't paid") || r.includes("havent paid")) return "UNPAID";
  if (r.includes("pending")) return "PENDING";
  // "Invalid parameters", "Incorrect amount", HTML error pages, etc. — never
  // treated as an answer about the payment.
  return "UNKNOWN";
}
