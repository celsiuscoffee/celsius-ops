const API_BASE = "https://order.celsiuscoffee.com";

export type Member = {
  id: string;
  phone: string;
  name: string | null;
  pointsBalance: number;
  totalPointsEarned: number;
  totalVisits: number;
};

export type Reward = {
  id: string;
  name: string;
  description: string | null;
  points_required: number;
  category: string;
  image_url: string | null;
  is_active: boolean;
  discount_type: "flat" | "percent" | "free_item" | "fixed_amount" | "percentage" | "bogo" | "none" | null;
  discount_value: number | null;
  max_discount_value: number | null;
  min_order_value: number | null;
  applicable_products: string[] | null;
  applicable_categories: string[] | null;
  free_product_ids: string[] | null;
  free_product_name: string | null;
  bogo_buy_qty: number;
  bogo_free_qty: number;
  fulfillment_type: string[] | null;
  valid_from?: string | null;
  valid_until?: string | null;
  stock?: number | null;
  max_redemptions_per_member?: number | null;
  redemption_count?: number;
};

export type RewardsResponse = {
  memberId: string | null;
  pointsBalance: number | null;
  rewards: Reward[];
};

async function get<T>(path: string): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, {
    headers: { "Content-Type": "application/json" },
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`${res.status} ${path} — ${text || res.statusText}`);
  }
  return res.json();
}

export async function fetchMember(phone: string): Promise<Member | null> {
  const data = await get<{ member: Member | null }>(
    `/api/loyalty/member?phone=${encodeURIComponent(phone)}`
  );
  return data.member;
}

export type MemberTier = {
  tier_id: string | null;
  tier_name: string | null;
  tier_slug: string | null;
  tier_color: string | null;
  tier_icon: string | null;
  tier_multiplier: number | null;
  tier_benefits: string[] | null;
  tier_qualification: "visits" | "spend" | "spend_lifetime" | "either" | null;
  visits_this_period: number;
  spend_this_period: number;
  spend_lifetime: number;
  period_days: number;
  next_tier_id: string | null;
  next_tier_name: string | null;
  next_tier_min_visits: number | null;
  next_tier_min_spend: number | null;
  next_tier_qualification: string | null;
  visits_to_next_tier: number;
  spend_to_next_tier: number;
};

export async function fetchTier(memberId: string): Promise<MemberTier | null> {
  try {
    return await get<MemberTier>(
      `/api/loyalty/member-tier?member_id=${encodeURIComponent(memberId)}`
    );
  } catch {
    return null;
  }
}

export type AppliedDiscount = {
  promotion_id: string;
  promotion_name: string;
  discount_type:
    | "percentage_off"
    | "fixed_amount_off"
    | "free_item"
    | "bogo"
    | "combo_price"
    | "override_price";
  discount_amount: number;
  affected_lines: number[];
  reason: "auto" | "code" | "tier_perk" | "reward_link";
};

export type EvaluatedCart = {
  subtotal: number;
  discounts: AppliedDiscount[];
  total_discount: number;
  total: number;
};

export type PromoLine = {
  product_id: string;
  category?: string;
  tags?: string[];
  quantity: number;
  unit_price: number;
};

/**
 * Result discriminator so callers can tell "no discounts apply" from
 * "we couldn't reach the discount engine". Previously we returned null
 * on every failure — silent — which is exactly how the Boss promo was
 * masked for weeks (CSRF blocked the POST and customers saw zero
 * discount, no error). With this shape callers can show a toast on
 * "error" without complicating the happy path.
 */
export type EvaluateResult =
  | { kind: "ok"; data: EvaluatedCart }
  | { kind: "error"; reason: string };

export async function evaluatePromotions(input: {
  lines: PromoLine[];
  member_id?: string | null;
  outlet_id?: string | null;
  member_tier_id?: string | null;
  promo_code?: string | null;
}): Promise<EvaluateResult> {
  try {
    // Two gotchas the order app's middleware imposes:
    //
    //   1) brand_id is required — the route 400's without it.
    //   2) The order app enforces an Origin/Referer CSRF check on every
    //      POST. React Native fetch sends no Origin by default, so we
    //      set one explicitly to a value in the allowlist
    //      (celsiuscoffee.com). The endpoint is a stateless computation
    //      (just discount math), so this isn't bypassing real auth.
    const res = await fetch(`${API_BASE}/api/loyalty/promotions/evaluate`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Origin: "https://celsiuscoffee.com",
      },
      body: JSON.stringify({ ...input, brand_id: "brand-celsius" }),
    });
    if (!res.ok) {
      return { kind: "error", reason: `evaluate ${res.status}` };
    }
    const data = (await res.json()) as EvaluatedCart;
    return { kind: "ok", data };
  } catch (e) {
    return {
      kind: "error",
      reason: e instanceof Error ? e.message : "network",
    };
  }
}

/**
 * Urgency label for a reward — surface time-left + stock-left as a short
 * pill so customers feel the use-it-or-lose-it. Returns null when the
 * reward is healthy (>1 week left, plenty in stock) so we don't crowd
 * UI with unnecessary chrome.
 */
export function rewardUrgencyLabel(r: {
  stock?: number | null;
  valid_until?: string | null;
}): string | null {
  if (r.stock != null && r.stock > 0 && r.stock <= 3) {
    return r.stock === 1 ? "Last one!" : `Only ${r.stock} left`;
  }
  if (r.valid_until) {
    const ms = new Date(r.valid_until).getTime() - Date.now();
    if (ms <= 0) return null;
    const days = Math.ceil(ms / (24 * 60 * 60 * 1000));
    if (days <= 1) return "Ends today";
    if (days <= 7) return `Ends in ${days}d`;
  }
  return null;
}

export type RecentItem = {
  id: string;
  name: string;
  image_url: string | null;
  price: number;
  timesOrdered: number;
};

export async function fetchRecentItems(
  phone: string,
  limit = 3
): Promise<RecentItem[]> {
  const res = await get<{ items: RecentItem[] }>(
    `/api/loyalty/recent-items?phone=${encodeURIComponent(phone)}&limit=${limit}`
  );
  return res.items ?? [];
}

export type OrderHistoryItem = {
  product_id: string;
  product_name: string;
  quantity: number;
  unit_price: number;
  item_total: number;
  modifiers: Array<{ groupName?: string; label?: string; priceDelta?: number }>;
};

export type OrderHistoryEntry = {
  id: string;
  order_number: string;
  status: string;
  total: number;
  created_at: string;
  payment_method: string | null;
  store_id: string | null;
  order_items: OrderHistoryItem[];
};

export async function fetchOrderHistory(
  phone: string,
  limit = 20
): Promise<OrderHistoryEntry[]> {
  const res = await get<{ orders: OrderHistoryEntry[] }>(
    `/api/loyalty/orders?phone=${encodeURIComponent(phone)}&limit=${limit}`
  );
  return res.orders ?? [];
}

export async function fetchRewards(phone?: string | null): Promise<RewardsResponse> {
  const path = phone
    ? `/api/loyalty/rewards?phone=${encodeURIComponent(phone)}`
    : `/api/loyalty/rewards`;
  return get<RewardsResponse>(path);
}

export function calcRewardDiscount(
  reward: {
    discount_type?: string | null;
    discount_value?: number | null;
    bogo_buy_qty?: number;
    bogo_free_qty?: number;
    min_order_value?: number | null;
  } | null,
  cartItems: { totalPrice: number; quantity: number }[],
  subtotal: number
): number {
  if (!reward) return 0;
  // min_order_value gate — server enforces this too (rejects the order
  // with a 400 if subtotal is below); checking here keeps the cart
  // total honest so the customer doesn't see a discount that won't
  // actually land at checkout.
  if (reward.min_order_value != null && subtotal < reward.min_order_value) {
    return 0;
  }
  const t = reward.discount_type;
  if (t === "free_item") {
    const prices = cartItems.map((i) => i.totalPrice / i.quantity);
    return prices.length > 0 ? Math.min(...prices) : 0;
  }
  if (t === "bogo") {
    // Pair items by quantity and free the cheaper of each pair. With
    // n units sorted descending, we keep p1 (paid) and free p2; with
    // 4+ units, this currently only frees one — which matches the
    // client-side preview legacy. The loyalty engine evaluates BOGO
    // against `bogo_buy_qty` / `bogo_free_qty` on its own pass and
    // is the authoritative path; this client number is a preview.
    const unitPrices = cartItems.flatMap((i) => Array(i.quantity).fill(i.totalPrice / i.quantity)) as number[];
    unitPrices.sort((a, b) => b - a);
    return unitPrices[1] ?? 0;
  }
  if ((t === "percent" || t === "percentage") && reward.discount_value) {
    return subtotal * (reward.discount_value / 100);
  }
  if (t === "flat" && reward.discount_value) {
    return reward.discount_value / 100;
  }
  if (t === "fixed_amount" && reward.discount_value) {
    return reward.discount_value;
  }
  return 0;
}

export function formatRewardValue(r: Reward): string {
  if (r.discount_type === "flat" || r.discount_type === "fixed_amount") {
    const cents = r.discount_value ?? 0;
    const value = r.discount_type === "flat" ? cents / 100 : cents;
    return `RM${value.toFixed(2).replace(/\.00$/, "")} off`;
  }
  if (r.discount_type === "percent" || r.discount_type === "percentage") {
    return `${r.discount_value ?? 0}% off`;
  }
  if (r.discount_type === "free_item") {
    return r.free_product_name ? `Free ${r.free_product_name}` : "Free item";
  }
  if (r.discount_type === "bogo") {
    return `Buy ${r.bogo_buy_qty} get ${r.bogo_free_qty} free`;
  }
  return "Reward";
}
