/**
 * GrabFood Partner API client for Celsius POS.
 *
 * Base URL: https://partner-api.grab.com/grabfood
 * Auth: OAuth2 client credentials (scope: food.partner_api)
 *
 * Env vars required:
 *   GRAB_CLIENT_ID, GRAB_CLIENT_SECRET, GRAB_MERCHANT_ID, GRAB_ENV (sandbox|production)
 */

// ─── Config ──────────────────────────────────────────────────────────────────

type GrabEnv = "sandbox" | "production";

function getEnv(): GrabEnv {
  return (process.env.GRAB_ENV as GrabEnv) || "sandbox";
}

function getAuthBaseUrl(): string {
  // VERIFIED: OAuth token host is the SAME for staging + production;
  // the OAuth client's project scopes the environment.
  return "https://api.grab.com";
}

function getApiBaseUrl(): string {
  // Sandbox = /grabfood-sandbox prefix; production = /grabfood. Both on
  // partner-api.grab.com (not the legacy stg-myteksi host).
  return getEnv() === "production"
    ? "https://partner-api.grab.com/grabfood"
    : "https://partner-api.grab.com/grabfood-sandbox";
}

export function isGrabConfigured(): boolean {
  return !!(
    process.env.GRAB_CLIENT_ID &&
    process.env.GRAB_CLIENT_SECRET &&
    process.env.GRAB_MERCHANT_ID
  );
}

export function getGrabConfig() {
  return {
    configured: isGrabConfigured(),
    env: getEnv(),
    merchantId: process.env.GRAB_MERCHANT_ID || "",
  };
}

// ─── OAuth2 Token Management ─────────────────────────────────────────────────

let cachedToken: { token: string; expiresAt: number } | null = null;

export async function getAccessToken(): Promise<string> {
  if (cachedToken && Date.now() < cachedToken.expiresAt - 60_000) {
    return cachedToken.token;
  }

  const res = await fetch(`${getAuthBaseUrl()}/grabid/v1/oauth2/token`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      client_id: process.env.GRAB_CLIENT_ID,
      client_secret: process.env.GRAB_CLIENT_SECRET,
      grant_type: "client_credentials",
      scope: "food.partner_api",
    }),
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Grab OAuth failed (${res.status}): ${err}`);
  }

  const data = await res.json();
  cachedToken = {
    token: data.access_token,
    expiresAt: Date.now() + data.expires_in * 1000,
  };
  return cachedToken.token;
}

// ─── Request Helper ──────────────────────────────────────────────────────────

async function grabRequest<T = unknown>(
  path: string,
  options: {
    method?: string;
    body?: unknown;
    params?: Record<string, string>;
  } = {},
): Promise<T> {
  const token = await getAccessToken();
  const url = new URL(`${getApiBaseUrl()}${path}`);
  if (options.params) {
    Object.entries(options.params).forEach(([k, v]) =>
      url.searchParams.set(k, v),
    );
  }

  const res = await fetch(url.toString(), {
    method: options.method || "GET",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    ...(options.body ? { body: JSON.stringify(options.body) } : {}),
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Grab API ${options.method || "GET"} ${path} failed (${res.status}): ${err}`);
  }

  const text = await res.text();
  return text ? JSON.parse(text) : ({} as T);
}

// ─── Menu Management ─────────────────────────────────────────────────────────

export interface GrabMenuItem {
  id: string;
  name: string;
  sequence?: number;
  nameTranslation?: Record<string, string>;
  availableStatus: "AVAILABLE" | "UNAVAILABLE" | "HIDE";
  description?: string;
  descriptionTranslation?: Record<string, string>;
  price: number; // in minor unit (sen)
  campaignInfo?: null;
  photos?: string[];
  maxStock?: number;
  modifierGroups?: GrabModifierGroup[];
}

export interface GrabModifierGroup {
  id: string;
  name: string;
  sequence?: number;
  nameTranslation?: Record<string, string>;
  availableStatus: "AVAILABLE" | "UNAVAILABLE";
  selectionRangeMin: number;
  selectionRangeMax: number;
  modifiers: GrabModifier[];
}

export interface GrabModifier {
  id: string;
  name: string;
  sequence?: number;
  nameTranslation?: Record<string, string>;
  availableStatus: "AVAILABLE" | "UNAVAILABLE";
  price: number; // in minor unit (sen)
}

export interface GrabMenuCategory {
  id: string;
  name: string;
  sequence?: number;
  nameTranslation?: Record<string, string>;
  availableStatus: "AVAILABLE" | "UNAVAILABLE";
  items: GrabMenuItem[];
}

type GrabServiceHours = {
  mon: { openPeriodType: string; periods: Array<{ startTime: string; endTime: string }> };
  tue: { openPeriodType: string; periods: Array<{ startTime: string; endTime: string }> };
  wed: { openPeriodType: string; periods: Array<{ startTime: string; endTime: string }> };
  thu: { openPeriodType: string; periods: Array<{ startTime: string; endTime: string }> };
  fri: { openPeriodType: string; periods: Array<{ startTime: string; endTime: string }> };
  sat: { openPeriodType: string; periods: Array<{ startTime: string; endTime: string }> };
  sun: { openPeriodType: string; periods: Array<{ startTime: string; endTime: string }> };
};

// GrabFood "Old Structure (Section Based Menu)": menu = list of sections;
// each section has its own serviceHours + categories[] of items.
export interface GrabMenuSection {
  id: string;
  name: string;
  sequence?: number;
  serviceHours: GrabServiceHours;
  categories: GrabMenuCategory[];
}

export interface GrabMenuPayload {
  merchantID: string;
  partnerMerchantID?: string;
  currency: { code: string; symbol: string; exponent: number };
  sections: GrabMenuSection[];
}

/**
 * Push full menu to GrabFood. Replaces the entire menu for the merchant.
 */
export async function updateMenu(menu: GrabMenuPayload) {
  return grabRequest("/partner/v1/menu", {
    method: "PUT",
    body: menu,
  });
}

/**
 * Batch update specific menu items (e.g. availability, price).
 * Field can be: "availableStatus", "price", "maxStock", etc.
 */
export async function batchUpdateMenu(
  merchantId: string,
  field: string,
  menuEntities: Array<{
    id: string;
    price?: number;
    availableStatus?: "AVAILABLE" | "UNAVAILABLE" | "HIDE";
  }>,
) {
  return grabRequest("/partner/v1/batch/menu", {
    method: "PUT",
    body: { merchantID: merchantId, field, menuEntities },
  });
}

/**
 * Notify GrabFood that the menu has been updated.
 */
export async function notifyMenuUpdate(merchantId: string) {
  return grabRequest("/partner/v1/merchant/menu/notification", {
    method: "POST",
    body: { merchantID: merchantId },
  });
}

/**
 * Check menu sync status.
 */
export async function traceMenuSync(merchantId: string) {
  return grabRequest("/partner/v1/merchant/menu/trace", {
    params: { merchantID: merchantId },
  });
}

// ─── Order Management ────────────────────────────────────────────────────────

export type GrabOrderState =
  | "ACCEPTED"
  | "REJECTED"
  | "CANCELLED"
  | "DELIVERED"
  | "COLLECTED"
  | "FAILED";

/**
 * Accept or reject an order.
 */
export async function acceptRejectOrder(
  orderID: string,
  state: "ACCEPTED" | "REJECTED",
  _rejectCode?: string,
) {
  // GrabFood v1.1.3: POST /order/prepare with toState "Accepted" | "Rejected".
  // (No reject-code field in the prepare payload; param kept for call-site compat.)
  return grabRequest("/partner/v1/order/prepare", {
    method: "POST",
    body: { orderID, toState: state === "ACCEPTED" ? "Accepted" : "Rejected" },
  });
}

/**
 * Mark an order as ready for pickup by the driver.
 */
export async function markOrderReady(orderID: string) {
  // GrabFood v1.1.3: POST /orders/mark with markStatus 1 = ready (2 = completed/dine-in).
  return grabRequest("/partner/v1/orders/mark", {
    method: "POST",
    body: { orderID, markStatus: 1 },
  });
}

/**
 * Update the estimated preparation time for an order.
 */
export async function updateOrderReadyTime(
  orderID: string,
  newOrderReadyTime: string, // ISO 8601
) {
  return grabRequest("/partner/v1/order/readytime", {
    method: "POST",
    body: { orderID, newOrderReadyTime },
  });
}

/**
 * Check if an order can be cancelled.
 */
export async function checkOrderCancelable(orderID: string) {
  return grabRequest<{ cancelable: boolean }>("/partner/v1/order/cancelable", {
    method: "GET",
    params: { orderID },
  });
}

/**
 * Cancel an order.
 */
export async function cancelOrder(
  orderID: string,
  merchantID: string,
  cancelCode: string,
) {
  return grabRequest("/partner/v1/order/cancel", {
    method: "PUT",
    body: { orderID, merchantID, cancelCode },
  });
}

/**
 * List orders with optional filters.
 */
export async function listOrders(
  merchantID: string,
  params?: { page?: number; pageSize?: number; date?: string },
) {
  return grabRequest("/partner/v1/orders", {
    params: {
      merchantID,
      ...(params?.page ? { page: String(params.page) } : {}),
      ...(params?.pageSize ? { pageSize: String(params.pageSize) } : {}),
      ...(params?.date ? { date: params.date } : {}),
    },
  });
}

// ─── Store Management ────────────────────────────────────────────────────────

/**
 * Pause or unpause the store.
 */
export async function pauseStore(
  merchantID: string,
  isPause: boolean,
  duration?: number, // minutes
) {
  return grabRequest("/partner/v1/merchant/pause", {
    method: "PUT",
    body: {
      merchantID,
      isPause,
      ...(duration ? { duration } : {}),
    },
  });
}

/**
 * Get store online/offline/paused status.
 */
export async function getStoreStatus(merchantID: string) {
  return grabRequest<{
    isActive: boolean;
    isPause: boolean;
    closedReason?: string;
  }>(`/partner/v1/merchants/${merchantID}/store/status`);
}

/**
 * Get store operating hours.
 */
export async function getStoreHours(merchantID: string) {
  return grabRequest(`/partner/v1/merchants/${merchantID}/store/opening-hours`);
}

/**
 * Update store delivery hours.
 */
export async function updateDeliveryHours(
  merchantID: string,
  deliveryHours: Record<string, unknown>,
) {
  return grabRequest("/partner/v1/merchant/store/delivery-hour", {
    method: "PUT",
    body: { merchantID, ...deliveryHours },
  });
}

// ─── Self-Serve Onboarding (Activation Journey) ───────────────────────────────

/**
 * Create a Self-Serve Activation journey for a store and return the
 * `activationUrl` the store owner opens to link their existing GrabFood store
 * to THIS POS integration. After they complete it, Grab pushes the store's
 * menu (→ /api/pos/grab/merchant/menu) and integration status (→
 * /api/pos/grab/status) to our inbound webhooks — no manual merchant-ID entry.
 *
 * `merchantID` is OUR id for the store. We pass the outlet id (e.g. "outlet-sa")
 * so the journey round-trips back to the right outlet: Grab later sends it as
 * `partnerMerchantID`, and the order webhook already resolves outlet by
 * "Partner store ID = POS outlet id".
 *
 * POST /partner/v1/self-serve/activation  { partner: { merchantID } }
 *   -> { activationUrl }
 */
export async function createSelfServeJourney(
  merchantID: string,
): Promise<{ activationUrl: string }> {
  return grabRequest<{ activationUrl: string }>("/partner/v1/self-serve/activation", {
    method: "POST",
    body: { partner: { merchantID } },
  });
}

// ─── Webhook Signature Verification ──────────────────────────────────────────

import { createHmac } from "crypto";

/**
 * Verify Grab webhook signature.
 * Grab signs webhooks with HMAC-SHA256 using your client secret.
 */
export function verifyWebhookSignature(
  payload: string,
  signature: string,
): boolean {
  if (!signature) return false;
  // Accept a signature computed with ANY configured HMAC secret: the primary
  // GRAB_HMAC_SECRET (falling back to the legacy GRAB_CLIENT_SECRET) plus an
  // optional production secret (…_PROD). One backoffice then verifies BOTH the
  // staging and production Grab projects — the go-live swap is additive.
  const secrets = [
    process.env.GRAB_HMAC_SECRET,
    process.env.GRAB_HMAC_SECRET_PROD,
    process.env.GRAB_CLIENT_SECRET,
    process.env.GRAB_CLIENT_SECRET_PROD,
  ].filter((s): s is string => !!s);
  for (const secret of secrets) {
    const expected = createHmac("sha256", secret).update(payload).digest("hex");
    if (expected === signature) return true;
  }
  return false;
}
