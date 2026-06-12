import { buildHeaders } from "./api";

const API_BASE = "https://order.celsiuscoffee.com";

export type Member = {
  id: string;
  phone: string;
  name: string | null;
  email: string | null;
  birthday: string | null;
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
  discount_type:
    | "flat" | "percent" | "free_item" | "fixed_amount"
    | "percentage" | "bogo" | "combo" | "override_price" | "none" | null;
  discount_value: number | null;
  max_discount_value: number | null;
  min_order_value: number | null;
  applicable_products: string[] | null;
  applicable_categories: string[] | null;
  free_product_ids: string[] | null;
  free_product_name: string | null;
  bogo_buy_qty: number;
  bogo_free_qty: number;
  /** SEN. combo: bundle fixed total; override_price: single-item price. */
  combo_price_sen?: number | null;
  override_price_sen?: number | null;
  fulfillment_type: string[] | null;
  valid_from?: string | null;
  valid_until?: string | null;
  stock?: number | null;
  max_redemptions_per_member?: number | null;
  redemption_count?: number;
  reward_type?: string | null;
  // Set by /api/loyalty/rewards when the row came from issued_rewards
  // (welcome BOGO, post-purchase coupon, etc.) rather than from the
  // public points-shop catalog. Drives voucher-vs-points UI hints.
  voucher_id?: string | null;
  voucher_expires_at?: string | null;
};

export type RewardsResponse = {
  memberId: string | null;
  pointsBalance: number | null;
  rewards: Reward[];
};

async function get<T>(path: string): Promise<T> {
  // Share buildHeaders so every member-scoped GET sends the Bearer JWT
  // when one is present in the store. Lets us flip STRICT_CUSTOMER_AUTH
  // on the order app without 401ing rewards / orders / tier / recent-
  // items fetches.
  const res = await fetch(`${API_BASE}${path}`, {
    headers: buildHeaders(),
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
  // Tier model v2 — quarterly % discount + invitation-only tiers.
  // discount_percent is 0-100; stackable=true means it adds on top of
  // reward voucher discounts at checkout; invitation_only=true means
  // the tier was admin-granted (Arba/Staff, Black Card).
  tier_discount_percent?: number | null;
  tier_stackable?: boolean | null;
  tier_invitation_only?: boolean | null;
  tier_locked_until?: string | null;
  visits_this_period: number;
  spend_this_period: number;
  spend_lifetime: number;
  period_days: number;
  quarter_start?: string | null;
  quarter_end?: string | null;
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
  // "code" used to be a valid reason — a customer-typed promo string.
  // That entry point was removed everywhere (UI + lib + server). The
  // engine still emits auto/tier/reward-link discounts.
  reason: "auto" | "tier_perk" | "reward_link";
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
      headers: buildHeaders(),
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
  /** Resolved outlet name from outlet_settings — server joins on
   *  store_id so the Orders tab can render "Conezion" / "Putrajaya"
   *  next to each entry. Null when the order's store_id no longer
   *  matches a configured outlet. */
  store_name: string | null;
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
  // all=1 → FULL points-shop catalogue (affordable + unaffordable) so the
  // rewards page shows locked "save up for it" cards and the home shows the
  // "X pts to next reward" teaser. Affordability is computed client-side
  // (points_required vs balance). The web count tile uses the default
  // affordable-only response (no all param), so its tally stays correct.
  const path = phone
    ? `/api/loyalty/rewards?phone=${encodeURIComponent(phone)}&all=1`
    : `/api/loyalty/rewards?all=1`;
  return get<RewardsResponse>(path);
}

export function calcRewardDiscount(
  reward: {
    discount_type?: string | null;
    discount_value?: number | null;
    bogo_buy_qty?: number;
    bogo_free_qty?: number;
    combo_price_sen?: number | null;
    override_price_sen?: number | null;
    free_product_ids?: string[] | null;
    min_order_value?: number | null;
    applicable_categories?: string[] | null;
    applicable_products?: string[] | null;
  } | null,
  cartItems: { productId?: string; category?: string; basePrice: number; totalPrice: number; quantity: number }[],
  subtotal: number
): number {
  if (!reward) return 0;
  // min_order_value gate — server enforces this too (rejects the order
  // with a 400 if subtotal is below); checking here keeps the cart
  // total honest so the customer doesn't see a discount that won't
  // actually land at checkout.
  // min_order_value is SEN; this preview works in RM, so compare against
  // min_order_value / 100 (was comparing RM subtotal to a sen value, which
  // demanded ~100× the real minimum).
  if (reward.min_order_value != null && subtotal < reward.min_order_value / 100) {
    return 0;
  }

  // Eligibility filter — only used by free_item / bogo. When the
  // reward has applicable_categories or applicable_products set,
  // the discount must come off an item in that set, NOT off the
  // cheapest snack the customer happened to add. Falls back to all
  // items if neither filter is set or none of the cart has a
  // category populated yet (legacy persisted carts pre-category).
  const cats = reward.applicable_categories;
  const prods = reward.applicable_products;
  const hasFilter = (cats && cats.length > 0) || (prods && prods.length > 0);
  const someHaveCategory = cartItems.some((i) => !!i.category);
  const eligible =
    hasFilter && someHaveCategory
      ? cartItems.filter((i) => {
          if (cats && cats.length > 0 && i.category && cats.includes(i.category)) return true;
          if (prods && prods.length > 0 && i.productId && prods.includes(i.productId)) return true;
          return false;
        })
      : cartItems;

  const t = reward.discount_type;
  if (t === "free_item") {
    // Free drink covers the base product only — modifier upgrades
    // (oatmilk, extra shot, syrups) are still paid for. Pick the
    // cheapest base price across the eligible set.
    if (eligible.length === 0) return 0;
    const prices = eligible.map((i) => i.basePrice);
    return Math.min(...prices);
  }
  if (t === "bogo") {
    // Mirrors @celsius/shared computeVoucherDiscount (preview only — the
    // order endpoint recomputes server-authoritatively).
    const buyQty = Math.max(1, Math.round(reward.bogo_buy_qty ?? 1));
    const freeQty = Math.max(1, Math.round(reward.bogo_free_qty ?? 1));
    const freeSet = reward.free_product_ids ?? [];
    if (freeSet.length > 0) {
      // Cross-item BOGO ("buy X, get Y free"): qualify on applicable_*
      // (none set → anything but the free item), free freeQty of the
      // chosen free product(s) per buyQty qualifying units bought.
      const hasApplicable = (cats?.length ?? 0) > 0 || (prods?.length ?? 0) > 0;
      const isBuy = (i: { productId?: string; category?: string }): boolean => {
        if (i.productId && freeSet.includes(i.productId)) return false;
        if (!hasApplicable) return true;
        if (i.productId && prods && prods.includes(i.productId)) return true;
        if (i.category && cats && cats.includes(i.category)) return true;
        return false;
      };
      const buyCount = cartItems.filter(isBuy).reduce((s, i) => s + i.quantity, 0);
      const allowance = Math.floor(buyCount / buyQty) * freeQty;
      const freeUnits: number[] = [];
      for (const i of cartItems) {
        if (i.productId && freeSet.includes(i.productId)) {
          for (let k = 0; k < i.quantity; k++) freeUnits.push(i.basePrice);
        }
      }
      freeUnits.sort((a, b) => a - b);
      let freed = 0;
      for (let k = 0; k < Math.min(allowance, freeUnits.length); k++) freed += freeUnits[k];
      return freed;
    }
    // Same-item BOGO: complete (buy+free) groups over the eligible pool.
    if (eligible.length === 0) return 0;
    const units = eligible.flatMap((i) => Array(i.quantity).fill(i.basePrice)) as number[];
    units.sort((a, b) => a - b);
    const totalFree = Math.floor(units.length / (buyQty + freeQty)) * freeQty;
    let freed = 0;
    for (let k = 0; k < totalFree && k < units.length; k++) freed += units[k];
    return freed;
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
  if (t === "free_upgrade") {
    // Cheapest eligible MODIFIER upcharge (add-on), not the whole drink.
    // Falls back to free_item (cheapest base) when no add-on is present.
    // Mirrors @celsius/shared computeVoucherDiscount. Preview only — the
    // order endpoint recomputes server-authoritatively.
    if (eligible.length === 0) return 0;
    const upcharges = eligible
      .map((i) => i.totalPrice / i.quantity - i.basePrice)
      .filter((m) => m > 0);
    if (upcharges.length) return Math.min(...upcharges);
    return Math.min(...eligible.map((i) => i.basePrice));
  }
  if (t === "combo") {
    // Every applicable_products entry must be in the cart; the bundle
    // (one cheapest unit of each) is repriced to combo_price_sen.
    const required = reward.applicable_products ?? [];
    if (required.length === 0 || reward.combo_price_sen == null) return 0;
    const present = new Set(cartItems.map((i) => i.productId));
    if (!required.every((pid) => present.has(pid))) return 0;
    let bundle = 0;
    for (const pid of required) {
      const matches = cartItems.filter((i) => i.productId === pid).map((i) => i.basePrice);
      if (matches.length) bundle += Math.min(...matches);
    }
    return Math.max(0, bundle - reward.combo_price_sen / 100); // sen → RM
  }
  if (t === "override_price") {
    // Cheapest eligible item repriced to override_price_sen.
    if (reward.override_price_sen == null || eligible.length === 0) return 0;
    const cheapest = Math.min(...eligible.map((i) => i.basePrice));
    return Math.max(0, cheapest - reward.override_price_sen / 100); // sen → RM
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
