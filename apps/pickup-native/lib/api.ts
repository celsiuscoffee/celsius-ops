const API_BASE = "https://order.celsiuscoffee.com";

async function post<T>(path: string, body: unknown): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      // Server-side CSRF middleware requires Origin/Referer.
      Origin: API_BASE,
      Referer: API_BASE + "/",
    },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`${res.status} ${path} — ${text || res.statusText}`);
  }
  return res.json();
}

async function postOtp(path: string, body: unknown) {
  const res = await post<{ success: boolean; error?: string }>(path, body);
  if (!res.success) throw new Error(res.error || "Request failed");
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
      headers: {
        "Content-Type": "application/json",
        Origin: API_BASE,
        Referer: API_BASE + "/",
      },
      body: JSON.stringify(payload),
    }).then(async (r) => {
      const j = await r.json();
      if (!r.ok || j.error) throw new Error(j.error || "Profile update failed");
      return j as { success: boolean; member?: { name?: string; email?: string; birthday?: string } };
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
  }) =>
    post<{ orderId: string; orderNumber: string }>("/api/orders", payload),
};

export function formatPriceMYR(cents: number) {
  return `RM${(cents / 100).toFixed(2).replace(/\.00$/, "")}`;
}

export function formatPrice(amount: number) {
  return `RM${amount.toFixed(2)}`;
}
