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
  status: "active" | "redeemed" | "expired" | "voided";
  source_type: "mission" | "mystery" | "birthday" | "referral" | "milestone" | "manual" | "points_redemption" | null;
  issued_at: string;
  expires_at: string | null;
  redeemed_at: string | null;
  stacks_with_beans: boolean;
  // Discount metadata — drives the client-side discount engine when the
  // customer reserves a wallet voucher and proceeds to checkout.
  discount_type?: "flat" | "percent" | "free_item" | "free_upgrade" | "beans_multiplier" | "none" | null;
  discount_value?: number | null;
  min_order_value?: number | null;
  applicable_categories?: string[] | null;
  applicable_products?: string[] | null;
  free_product_name?: string | null;
};

// ─── Mission ────────────────────────────────────────────────────────────

export type Mission = {
  id: string;
  title: string;
  description: string;
  icon: string;
  difficulty: "easy" | "medium" | "hard";
  goal_threshold: number;
  reward_summary: string;        // pre-formatted, e.g. "🥐 Free Pastry + 50 Beans"
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
// Sources: welcome (post-signup), promo (admin push), mystery-pending (un-revealed drop),
// milestone-pending (just hit a milestone).

export type ClaimableVoucher = {
  id: string;                     // claimable id (not yet a voucher)
  title: string;
  description: string;
  icon: string;
  category: Voucher["category"];
  source_type: "welcome" | "promo" | "mystery_pending" | "milestone_pending";
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

export async function fetchActiveMission(): Promise<ActiveMission | null> {
  try {
    return await get<ActiveMission>("/api/loyalty/me/mission/active");
  } catch {
    return null;
  }
}

export async function fetchMissionPool(): Promise<Mission[]> {
  return get<Mission[]>("/api/loyalty/me/missions/pool");
}

export async function pickMission(missionId: string): Promise<ActiveMission> {
  return post<ActiveMission>("/api/loyalty/me/mission/pick", { mission_id: missionId });
}

export async function swapMission(): Promise<{ swapped: boolean }> {
  return post<{ swapped: boolean }>("/api/loyalty/me/mission/swap");
}

// ─── Claimable voucher API ──────────────────────────────────────────────

export async function fetchClaimableVouchers(): Promise<ClaimableVoucher[]> {
  try {
    return await get<ClaimableVoucher[]>("/api/loyalty/me/claimable");
  } catch {
    return [];
  }
}

/** Convert a claimable offer into a real wallet voucher. Returns the new
 *  Voucher so callers can navigate to the detail view or animate it into
 *  the wallet section. */
export async function claimVoucher(claimableId: string): Promise<Voucher> {
  return post<Voucher>(`/api/loyalty/me/claimable/${claimableId}/claim`);
}

/** Spend Beans to add a points-shop reward to the wallet. Atomic on the
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

// ─── Streak ─────────────────────────────────────────────────────────────

export type StreakState = {
  current_streak_weeks: number;
  longest_streak_weeks: number;
  last_order_week_start: string | null;
  saver_available: boolean;
};

export async function fetchMyStreak(): Promise<StreakState | null> {
  try {
    return await get<StreakState>("/api/loyalty/me/streak");
  } catch {
    return null;
  }
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
