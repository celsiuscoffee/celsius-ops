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
  reward: { discount_type?: string | null; discount_value?: number | null; bogo_buy_qty?: number; bogo_free_qty?: number } | null,
  cartItems: { totalPrice: number; quantity: number }[],
  subtotal: number
): number {
  if (!reward) return 0;
  const t = reward.discount_type;
  if (t === "free_item") {
    const prices = cartItems.map((i) => i.totalPrice / i.quantity);
    return prices.length > 0 ? Math.min(...prices) : 0;
  }
  if (t === "bogo") {
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
