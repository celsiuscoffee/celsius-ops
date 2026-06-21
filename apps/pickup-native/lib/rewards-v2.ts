// Rewards v2 — Vouchers + Missions + Mystery Bean
// Companion to lib/rewards.ts (points/tier — kept as-is for back-compat)

import { buildHeaders } from "./api";

const API_BASE = "https://order.celsiuscoffee.com";

// ─── Voucher (issued_rewards instance) ──────────────────────────────────

export type Voucher = {
  id: string;
  template_id: string | null;
  title: string;
  description: string;
  icon: string;
  category: "free_item" | "upgrade" | "discount" | "multiplier" | "special";
  status: "active" | "used" | "expired";
  source_type: "mission" | "mystery" | "birthday" | "referral" | "manual" | "points_redemption" | "campaign" | null;
  // Back-reference to whatever issued the voucher — e.g. a
  // mission_assignments.id for source_type='mission'. Lets the Challenge
  // card find its linked wallet voucher and route Use without a picker.
  source_ref_id?: string | null;
  issued_at: string;
  expires_at: string | null;
  redeemed_at: string | null;
  stacks_with_beans: boolean;
  // Discount metadata — drives the client-side discount engine when the
  // customer reserves a wallet voucher and proceeds to checkout.
  discount_type?: "flat" | "percent" | "free_item" | "bogo" | "combo" | "override_price" | "beans_multiplier" | "none" | null;
  discount_value?: number | null;
  max_discount_value?: number | null;
  min_order_value?: number | null;
  applicable_categories?: string[] | null;
  applicable_products?: string[] | null;
  free_product_name?: string | null;
  // BOGO / combo / override mechanics — resolved from the linked template by
  // the wallet API (active-vouchers.ts). Needed for the cart discount engine.
  free_product_ids?: string[] | null;
  bogo_buy_qty?: number | null;
  bogo_free_qty?: number | null;
  combo_price_sen?: number | null;
  override_price_sen?: number | null;
  // Optional visual overrides — sourced from a linked reward_kind row
  // in the backoffice. When null the native card falls back to the
  // source-bucket theme + Lucide glyph.
  kind_color?: string | null;
  illustration_url?: string | null;
};

// ─── Mission ────────────────────────────────────────────────────────────

export type Mission = {
  id: string;
  title: string;
  description: string;
  icon: string;
  difficulty: "easy" | "medium" | "hard";
  // Drives client-side progress formatting (RM amounts for Big Bill,
  // cups for Group Order, etc.). Server-controlled; client treats
  // unknown values as a plain "X/Y" count.
  goal_type: string;
  goal_threshold: number;
  reward_summary: string;        // pre-formatted, e.g. "🥐 Free Pastry + 50 Points"
};

export type ActiveMission = Mission & {
  assignment_id: string;
  progress_current: number;
  status: "active" | "completed" | "expired";
  week_end_at: string;
  completed_at: string | null;
};

// ─── Claimable vouchers ─────────────────────────────────────────────────
// One-tap claim. Offers the customer can convert into a real wallet voucher.
// Sources: welcome (post-signup), promo (admin push), mystery-pending (un-revealed drop).

export type ClaimableVoucher = {
  id: string;                     // claimable id (not yet a voucher)
  title: string;
  description: string;
  icon: string;
  category: Voucher["category"];
  source_type: "welcome" | "promo" | "mystery_pending";
  expires_at: string | null;      // claim window
  cta_label?: string;             // optional override e.g. "Reveal"
};

// ─── Mystery Bean ───────────────────────────────────────────────────────

export type MysteryDropPreview = {
  drop_id: string;
  order_id: string;
  revealed: boolean;
};

export type MysteryDropRevealed = {
  drop_id: string;
  outcome_type: "beans_multiplier" | "flat_beans" | "voucher" | "no_bonus" | "surprise_in_store";
  multiplier_value: number | null;
  flat_beans_value: number | null;
  voucher_id: string | null;
  reveal_emoji: string | null;
  label: string;
  total_beans_awarded: number;   // base + multiplier
};

// ─── API helpers ────────────────────────────────────────────────────────

async function get<T>(path: string): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, { headers: buildHeaders() });
  if (!res.ok) throw new Error(`Request failed: ${res.status}`);
  return res.json();
}

async function post<T>(path: string, body?: unknown): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, {
    method: "POST",
    headers: buildHeaders(),
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) throw new Error(`Request failed: ${res.status}`);
  return res.json();
}

// ─── Vouchers ───────────────────────────────────────────────────────────

export async function fetchMyVouchers(): Promise<Voucher[]> {
  return get<Voucher[]>("/api/loyalty/me/vouchers");
}

export async function fetchVoucher(id: string): Promise<Voucher> {
  return get<Voucher>(`/api/loyalty/me/vouchers/${id}`);
}

// ─── Missions ───────────────────────────────────────────────────────────
// Customer-facing model: 3 weekly challenges per member, auto-rotated.
// The server lazy-seeds 3 picks from the active mission pool the first
// time a member fetches in a new Mon–Sun window; subsequent fetches
// return the same trio so progress is stable.

export async function fetchActiveMissions(): Promise<ActiveMission[]> {
  try {
    return await get<ActiveMission[]>("/api/loyalty/me/missions/active");
  } catch {
    return [];
  }
}

// ─── Mission swap ──────────────────────────────────────────────────────
// One free swap per customer per week. The /swap-options endpoint
// returns up to 3 random candidates the member can pick from; /swap
// commits the choice. Both gate on the active-and-eligible-and-not-
// already-swapped check server-side, so the client just renders what
// it gets and posts back the chosen mission_id.

export type SwapOption = {
  mission_id: string;
  title: string;
  description: string;
  icon: string;
  difficulty: "easy" | "medium" | "hard";
  goal_type: string;
  goal_threshold: number;
  reward_summary: string;
  reward_bonus_beans: number;
};

export type SwapOptionsResponse = {
  can_swap: boolean;
  reason: string | null;
  options: SwapOption[];
  remaining_swaps_this_week: number;
};

export async function fetchSwapOptions(assignmentId: string): Promise<SwapOptionsResponse> {
  return get<SwapOptionsResponse>(
    `/api/loyalty/me/missions/${assignmentId}/swap-options`,
  );
}

export async function confirmSwap(
  assignmentId: string,
  toMissionId: string,
): Promise<{ ok: boolean; updated_assignment?: ActiveMission; error?: string }> {
  try {
    const res = await fetch(
      `https://order.celsiuscoffee.com/api/loyalty/me/missions/${assignmentId}/swap`,
      {
        method: "POST",
        headers: buildHeaders(),
        body: JSON.stringify({ to_mission_id: toMissionId }),
      },
    );
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      return { ok: false, error: (body as { error?: string }).error ?? `http_${res.status}` };
    }
    const data = await res.json();
    return { ok: true, updated_assignment: data.updated_assignment };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "network_error" };
  }
}

// ─── Claimable voucher API ──────────────────────────────────────────────

export async function fetchClaimableVouchers(): Promise<ClaimableVoucher[]> {
  try {
    return await get<ClaimableVoucher[]>("/api/loyalty/me/claimable");
  } catch {
    return [];
  }
}

// Canonical home-tile / nav-badge "Rewards" tally. Mirrors @celsius/shared
// countRewardsWaiting + countAffordableRewards — native can't depend on that
// server-leaning package, so the rules are hand-synced here. Keep in lockstep:
// active WALLET-source vouchers (mystery-bag / manual / birthday) PLUS
// claimables. Bean-shop + referral are NOT wallet items. The home "Rewards"
// KPI ALSO counts affordable redeemable catalogue items (countAffordableRewards
// below); the UNaffordable catalogue is never counted.
const WALLET_COUNT_SOURCES = ["mystery", "manual", "birthday", "campaign"];
export function countRewardsWaiting(
  vouchers: ReadonlyArray<{ status?: string | null; source_type?: string | null }> | null | undefined,
  claimables: ReadonlyArray<unknown> | null | undefined,
): number {
  const owned = (vouchers ?? []).filter(
    (v) =>
      (v.status === "active" || !v.status) &&
      WALLET_COUNT_SOURCES.includes(v.source_type ?? ""),
  ).length;
  return owned + (claimables?.length ?? 0);
}

// Mirrors @celsius/shared countAffordableRewards (keep in lockstep). A
// redeemable catalogue reward "you can claim now" = active + affordable +
// inside its valid window + in stock + under the per-member redemption cap +
// pickup-capable. Added on top of countRewardsWaiting for the home "Rewards"
// KPI so the count = wallet vouchers + claimables + affordable catalogue.
export function countAffordableRewards(
  rewards:
    | ReadonlyArray<{
        is_active?: boolean | null;
        points_required?: number | null;
        valid_from?: string | null;
        valid_until?: string | null;
        stock?: number | null;
        max_redemptions_per_member?: number | null;
        redemption_count?: number | null;
        fulfillment_type?: string[] | null;
      }>
    | null
    | undefined,
  points: number,
): number {
  const now = Date.now();
  return (rewards ?? []).filter((r) => {
    if (!r.is_active) return false;
    if ((r.points_required ?? 0) > points) return false;
    if (r.valid_from && new Date(r.valid_from).getTime() > now) return false;
    if (r.valid_until && new Date(r.valid_until).getTime() < now) return false;
    if (r.stock != null && r.stock <= 0) return false;
    if (
      r.max_redemptions_per_member != null &&
      (r.redemption_count ?? 0) >= r.max_redemptions_per_member
    ) {
      return false;
    }
    const ft = r.fulfillment_type;
    if (Array.isArray(ft) && ft.length > 0 && !ft.includes("pickup")) return false;
    return true;
  }).length;
}

/** Convert a claimable offer into a real wallet voucher. Returns the new
 *  Voucher so callers can navigate to the detail view or animate it into
 *  the wallet section. */
export async function claimVoucher(claimableId: string): Promise<Voucher> {
  return post<Voucher>(`/api/loyalty/me/claimable/${claimableId}/claim`);
}

/** Spend Points to add a points-shop reward to the wallet. Atomic on the
 *  server — either both the deduction and the voucher row happen, or
 *  nothing does. Returns the new balance so the home screen can update
 *  without an extra round-trip. */
export async function redeemPointsReward(rewardId: string): Promise<{
  voucher: Voucher;
  newBalance: number;
  pointsSpent: number;
}> {
  return post<{ voucher: Voucher; newBalance: number; pointsSpent: number }>(
    `/api/loyalty/me/rewards/${rewardId}/redeem`,
  );
}

// ─── Referrals ──────────────────────────────────────────────────────────

export type ReferralState = {
  code: string;
  total_referred: number;
  pending: number;
  rewarded: number;
  recent: Array<{ status: string; created_at: string; rewarded_at: string | null }>;
};

export async function fetchMyReferral(): Promise<ReferralState | null> {
  try {
    return await get<ReferralState>("/api/loyalty/me/referral");
  } catch {
    return null;
  }
}

export async function submitReferralCode(code: string): Promise<{ ok: boolean; error?: string }> {
  try {
    await post("/api/loyalty/referral/attribute", { code });
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Failed" };
  }
}

// ─── Coffee Wrapped ─────────────────────────────────────────────────────

export type CoffeeWrapped = {
  year: number;
  summary: {
    total_orders: number;
    total_spent_sen: number;
    total_saved_sen: number;
    distinct_outlets: number;
    distinct_products: number;
    vouchers_redeemed: number;
    longest_streak_weeks: number;
  };
  favorites: {
    product_name: string | null;
    product_count: number;
    hour: number | null;     // 0-23, UTC; client converts to local for display
    month: number | null;    // 1-12
  };
};

export async function fetchCoffeeWrapped(year?: number): Promise<CoffeeWrapped | null> {
  try {
    const path = year ? `/api/loyalty/me/wrapped?year=${year}` : "/api/loyalty/me/wrapped";
    return await get<CoffeeWrapped>(path);
  } catch {
    return null;
  }
}

// ─── Mystery Bean ───────────────────────────────────────────────────────

export async function fetchPendingMysteryDrop(orderId: string): Promise<MysteryDropPreview | null> {
  try {
    return await get<MysteryDropPreview>(`/api/loyalty/me/mystery/${orderId}`);
  } catch {
    return null;
  }
}

export async function revealMysteryDrop(dropId: string): Promise<MysteryDropRevealed> {
  return post<MysteryDropRevealed>(`/api/loyalty/me/mystery/${dropId}/reveal`);
}

// ─── Utilities ──────────────────────────────────────────────────────────

export function voucherUrgencyLabel(v: Voucher): { label: string; warning: boolean } {
  if (!v.expires_at) return { label: "No expiry", warning: false };
  const expires = new Date(v.expires_at).getTime();
  const now = Date.now();
  const daysLeft = Math.ceil((expires - now) / (1000 * 60 * 60 * 24));

  if (daysLeft <= 0) return { label: "Expired", warning: true };
  if (daysLeft <= 3) return { label: `Expires in ${daysLeft} day${daysLeft === 1 ? "" : "s"}`, warning: true };
  if (daysLeft <= 14) return { label: `Expires in ${daysLeft} days`, warning: false };
  return { label: `Expires ${new Date(v.expires_at).toLocaleDateString("en-MY", { month: "short", day: "numeric" })}`, warning: false };
}

export function missionProgressDots(current: number, target: number): boolean[] {
  return Array.from({ length: target }, (_, i) => i < current);
}
