import Constants from "expo-constants";
import { Platform } from "react-native";
import { useApp } from "./store";

const API_BASE = "https://order.celsiuscoffee.com";

// Pull the customer session token from the zustand store outside a
// React hook context. Safe — the store is module-singleton.
function readSessionToken(): string | null {
  try {
    return useApp.getState().sessionToken;
  } catch {
    return null;
  }
}

// Pulled once at module load — Constants.expoConfig is stable for the
// lifetime of the JS bundle. Server uses this with app_settings.min_app_
// version + the X-App-Platform header to gate sub-min builds.
const APP_VERSION  = Constants.expoConfig?.version ?? "1.0.0";
const APP_PLATFORM = Platform.OS; // "ios" | "android"

export function buildHeaders(extra?: Record<string, string>): Record<string, string> {
  const token = readSessionToken();
  const h: Record<string, string> = {
    "Content-Type": "application/json",
    // Server-side CSRF middleware requires Origin/Referer.
    Origin: API_BASE,
    Referer: API_BASE + "/",
    // Surfaced to the server for min_app_version enforcement. Headers
    // are not authenticated but are sufficient to gate sub-min builds
    // against forceUpdate. Anyone who really wants to lie can — but
    // that's the customer's own foot at that point.
    "X-App-Version":  APP_VERSION,
    "X-App-Platform": APP_PLATFORM,
    ...(extra ?? {}),
  };
  if (token) h["Authorization"] = `Bearer ${token}`;
  return h;
}

async function post<T>(path: string, body: unknown): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, {
    method: "POST",
    headers: buildHeaders(),
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`${res.status} ${path} — ${text || res.statusText}`);
  }
  return res.json();
}

async function postOtp(path: string, body: unknown) {
  const res = await post<{ success: boolean; error?: string; sessionToken?: string }>(path, body);
  if (!res.success) throw new Error(res.error || "Request failed");
  // OTP verify returns a sessionToken on success — persist it so
  // every subsequent member-scoped call sends it as a Bearer header.
  if (res.sessionToken) {
    try {
      useApp.getState().setSessionToken(res.sessionToken);
    } catch {
      // ignore — store hydration race; next call will pick it up.
    }
  }
  return res;
}

export const api = {
  sendOtp: (phone: string) =>
    postOtp("/api/otp/send", { phone, purpose: "login" }),
  verifyOtp: (phone: string, code: string) =>
    postOtp("/api/otp/verify", { phone, code, purpose: "login" }),
  updateProfile: (payload: {
    member_id: string;
    phone: string;
    name?: string;
    email?: string;
    birthday?: string;
  }) =>
    fetch(`${API_BASE}/api/members/profile`, {
      method: "PUT",
      headers: buildHeaders(),
      body: JSON.stringify(payload),
    }).then(async (r) => {
      const j = await r.json();
      if (!r.ok || j.error) throw new Error(j.error || "Profile update failed");
      return j as { success: boolean; member?: { name?: string; email?: string; birthday?: string } };
    }),
  deleteAccount: (payload: { member_id: string; phone: string }) =>
    fetch(`${API_BASE}/api/members/delete`, {
      method: "POST",
      headers: buildHeaders(),
      body: JSON.stringify(payload),
    }).then(async (r) => {
      const j = await r.json().catch(() => ({}));
      if (!r.ok || j.error) throw new Error(j.error || "Account deletion failed");
      return j as { success: boolean };
    }),
  placeOrder: (payload: {
    selectedStore: { id: string; name?: string };
    loyaltyPhone: string;
    loyaltyId?: string | null;
    items: Array<{
      productId: string;
      name: string;
      quantity: number;
      basePrice: number;
      totalPrice: number;
      modifiers: Array<{ groupName: string; label: string; priceDelta: number }>;
      specialInstructions?: string;
    }>;
    paymentMethod: "card" | "ewallet" | "fpx";
    total: number;
    rewardId?: string | null;
    rewardName?: string | null;
    rewardPointsCost?: number;
    rewardDiscountSen?: number;
    /** When set, the redeemed asset is a wallet voucher (issued_rewards
     *  row), not a points-shop reward. Server marks the voucher as
     *  redeemed and skips the points deduction path. */
    walletVoucherId?: string | null;
  }) =>
    post<{ orderId: string; orderNumber: string }>("/api/orders", {
      ...payload,
      // Tells the server this build understands the {skipPayment:true}
      // response shape from create-payment-intent. Without this flag the
      // server rejects zero-amount orders up-front so old binaries stop
      // creating phantom "preparing" orders they can't navigate to.
      clientSupportsSkipPayment: true,
    }),
};

export function formatPriceMYR(cents: number) {
  return `RM${(cents / 100).toFixed(2).replace(/\.00$/, "")}`;
}

export function formatPrice(amount: number) {
  return `RM${amount.toFixed(2)}`;
}
