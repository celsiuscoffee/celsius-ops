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
  return getEnv() === "production"
    ? "https://api.grab.com"
    : "https://api.stg-myteksi.com";
}

function getApiBaseUrl(): string {
  return getEnv() === "production"
    ? "https://partner-api.grab.com/grabfood"
    : "https://partner-api.stg-myteksi.com/grabfood";
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
  nameTranslation?: Record<string, string>;
  availableStatus: "AVAILABLE" | "UNAVAILABLE" | "HIDE";
  description?: string;
  descriptionTranslation?: Record<string, string>;
  price: number; // in minor unit (sen)
  photos?: string[];
  maxStock?: number;
  modifierGroups?: GrabModifierGroup[];
}

export interface GrabModifierGroup {
  id: string;
  name: string;
  nameTranslation?: Record<string, string>;
  availableStatus: "AVAILABLE" | "UNAVAILABLE";
  selectionRangeMin: number;
  selectionRangeMax: number;
  modifiers: GrabModifier[];
}

export interface GrabModifier {
  id: string;
  name: string;
  nameTranslation?: Record<string, string>;
  availableStatus: "AVAILABLE" | "UNAVAILABLE";
  price: number; // in minor unit (sen)
}

export interface GrabMenuCategory {
  id: string;
  name: string;
  nameTranslation?: Record<string, string>;
  availableStatus: "AVAILABLE" | "UNAVAILABLE";
  items: GrabMenuItem[];
}

export interface GrabMenuPayload {
  merchantID: string;
  partnerMerchantID?: string;
  currency: { code: string; symbol: string; exponent: number };
  sellingTimes: Array<{
    startTime: string;
    endTime: string;
    id: string;
    name: string;
    serviceHours: {
      mon: { openPeriodType: string; periods: Array<{ startTime: string; endTime: string }> };
      tue: { openPeriodType: string; periods: Array<{ startTime: string; endTime: string }> };
      wed: { openPeriodType: string; periods: Array<{ startTime: string; endTime: string }> };
      thu: { openPeriodType: string; periods: Array<{ startTime: string; endTime: string }> };
      fri: { openPeriodType: string; periods: Array<{ startTime: string; endTime: string }> };
      sat: { openPeriodType: string; periods: Array<{ startTime: string; endTime: string }> };
      sun: { openPeriodType: string; periods: Array<{ startTime: string; endTime: string }> };
    };
  }>;
  categories: GrabMenuCategory[];
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
  return grabRequest("/partner/v1/menu/batch", {
    method: "PUT",
    body: { merchantID: merchantId, field, menuEntities },
  });
}

/**
 * Notify GrabFood that the menu has been updated.
 */
export async function notifyMenuUpdate(merchantId: string) {
  return grabRequest("/partner/v1/menu/notification", {
    method: "POST",
    body: { merchantID: merchantId },
  });
}

/**
 * Check menu sync status.
 */
export async function traceMenuSync(merchantId: string) {
  return grabRequest("/partner/v1/menu/trace", {
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
  rejectCode?: string,
) {
  return grabRequest("/partner/v1/order/accept", {
    method: "POST",
    body: { orderID, state, ...(rejectCode ? { rejectCode } : {}) },
  });
}

/**
 * Mark an order as ready for pickup by the driver.
 */
export async function markOrderReady(orderID: string) {
  return grabRequest("/partner/v1/order/ready", {
    method: "POST",
    body: { orderID },
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
  }>(`/partner/v1/merchant/${merchantID}/store/status`);
}

/**
 * Get store operating hours.
 */
export async function getStoreHours(merchantID: string) {
  return grabRequest(`/partner/v1/merchant/${merchantID}/store/hour`);
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
  const secret = process.env.GRAB_CLIENT_SECRET;
  if (!secret) return false;
  const expected = createHmac("sha256", secret).update(payload).digest("hex");
  return expected === signature;
}
