// API client for fetching data from Supabase via API routes

import type {
  Brand,
  Outlet,
  Member,
  MemberBrand,
  MemberWithBrand,
  Reward,
  PointTransaction,
  Campaign,
  DashboardStats,
} from "@/types";

// ─── Brands ──────────────────────────────────────────
export async function fetchBrands(): Promise<Brand[]> {
  try {
    const res = await fetch("/api/brands");
    if (!res.ok) return [];
    return res.json();
  } catch {
    return [];
  }
}

// ─── Outlets ─────────────────────────────────────────
export async function fetchOutlets(brandId: string = "brand-celsius"): Promise<Outlet[]> {
  try {
    const res = await fetch(`/api/outlets?brand_id=${brandId}`);
    if (!res.ok) return [];
    return res.json();
  } catch {
    return [];
  }
}

// ─── Members ─────────────────────────────────────────
export async function fetchMembers(
  brandId: string = "brand-celsius",
  options?: { page?: number; limit?: number; search?: string; all?: boolean },
): Promise<MemberWithBrand[]> {
  try {
    const params = new URLSearchParams({ brand_id: brandId });
    if (options?.page != null) params.set("page", String(options.page));
    if (options?.limit != null) params.set("limit", String(options.limit));
    if (options?.search) params.set("search", options.search);
    if (options?.all) params.set("all", "true");

    const res = await fetch(`/api/members?${params.toString()}`);
    if (!res.ok) return [];
    const data = await res.json();
    // Handle both paginated response { members, total } and flat array
    return Array.isArray(data) ? data : data.members ?? [];
  } catch {
    return [];
  }
}

export async function fetchMembersPage(
  brandId: string = "brand-celsius",
  page: number = 0,
  limit: number = 50,
  search?: string,
): Promise<{ members: MemberWithBrand[]; total: number; page: number; limit: number; total_pages: number }> {
  try {
    const params = new URLSearchParams({ brand_id: brandId, page: String(page), limit: String(limit) });
    if (search) params.set("search", search);

    const res = await fetch(`/api/members?${params.toString()}`);
    if (!res.ok) return { members: [], total: 0, page: 0, limit, total_pages: 0 };
    return res.json();
  } catch {
    return { members: [], total: 0, page: 0, limit, total_pages: 0 };
  }
}

export async function fetchMemberByPhone(
  phone: string,
  brandId: string = "brand-celsius",
): Promise<MemberWithBrand | null> {
  try {
    const res = await fetch(`/api/members?brand_id=${brandId}&phone=${encodeURIComponent(phone)}`);
    if (!res.ok) return null;
    const data = await res.json();
    return Array.isArray(data) ? data[0] || null : data;
  } catch {
    return null;
  }
}

export async function createMember(data: {
  phone: string;
  name?: string;
  email?: string;
  birthday?: string;
  brand_id?: string;
  outlet_id?: string;
}): Promise<MemberWithBrand | null> {
  try {
    const res = await fetch("/api/members", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ brand_id: "brand-celsius", ...data }),
    });
    if (!res.ok) return null;
    return res.json();
  } catch {
    return null;
  }
}

// ─── Member Profile (customer self-service) ──────────
export async function updateMemberProfile(data: {
  member_id: string;
  phone: string;
  name?: string;
  email?: string;
  birthday?: string;
}): Promise<{ success: boolean; member?: Member; error?: string }> {
  try {
    const res = await fetch("/api/members/profile", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(data),
    });
    return res.json();
  } catch {
    return { success: false, error: "Network error" };
  }
}

// ─── Rewards ─────────────────────────────────────────
export async function fetchRewards(brandId: string = "brand-celsius"): Promise<Reward[]> {
  try {
    const res = await fetch(`/api/rewards?brand_id=${brandId}`);
    if (!res.ok) return [];
    return res.json();
  } catch {
    return [];
  }
}

// ─── Transactions ────────────────────────────────────
export async function fetchTransactions(
  memberId: string,
  brandId: string = "brand-celsius",
): Promise<PointTransaction[]> {
  try {
    const res = await fetch(`/api/transactions?member_id=${memberId}&brand_id=${brandId}`);
    if (!res.ok) return [];
    return res.json();
  } catch {
    return [];
  }
}

// ─── Award Points ────────────────────────────────────
export async function awardPoints(data: {
  member_id: string;
  brand_id?: string;
  outlet_id: string;
  points: number;
  description: string;
  reference_id?: string;
  multiplier?: number;
  amount?: number;
}): Promise<{ success: boolean; transaction?: PointTransaction; error?: string }> {
  try {
    const res = await fetch("/api/points/award", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ brand_id: "brand-celsius", ...data }),
    });
    return res.json();
  } catch {
    return { success: false, error: "Network error" };
  }
}

// ─── Redeem Reward ───────────────────────────────────
export async function redeemReward(data: {
  member_id: string;
  reward_id: string;
  brand_id?: string;
  outlet_id?: string;
  staff_redeem?: boolean;
}): Promise<{ success: boolean; code?: string; error?: string }> {
  try {
    const res = await fetch("/api/redeem", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "include",
      body: JSON.stringify({ brand_id: "brand-celsius", ...data }),
    });
    return res.json();
  } catch {
    return { success: false, error: "Network error" };
  }
}

// ─── Dashboard Stats ─────────────────────────────────
export async function fetchDashboardStats(): Promise<DashboardStats> {
  try {
    const res = await fetch("/api/dashboard/stats?brand_id=brand-celsius");
    if (!res.ok) throw new Error();
    return res.json();
  } catch {
    return {
      total_members: 0,
      new_members_today: 0,
      new_members_this_month: 0,
      total_points_issued: 0,
      total_points_redeemed: 0,
      total_redemptions: 0,
      total_revenue_attributed: 0,
      active_campaigns: 0,
      active_members_30d: 0,
      floating_points: 0,
      member_transaction_pct: 0,
      avg_lifetime_value_members: 0,
      avg_lifetime_value_nonmembers: 0,
      reward_redemption_rate: 0,
      top_spenders: [],
      new_members_by_month: [],
      redemptions_by_month: [],
    };
  }
}

// ─── Campaigns ───────────────────────────────────────
export async function fetchCampaigns(brandId: string = "brand-celsius"): Promise<Campaign[]> {
  try {
    const res = await fetch(`/api/campaigns?brand_id=${brandId}`);
    if (!res.ok) return [];
    return res.json();
  } catch {
    return [];
  }
}

// ─── Redemptions ────────────────────────────────────
export interface RedemptionWithDetails {
  id: string;
  member_id: string;
  reward_id: string;
  brand_id: string;
  outlet_id: string | null;
  points_spent: number;
  status: "pending" | "confirmed" | "used" | "cancelled";
  code: string;
  confirmed_at: string | null;
  confirmed_by: string | null;
  created_at: string;
  rewards: { name: string; category: string; image_url?: string | null } | null;
  members?: { name: string | null; phone: string } | null;
}

export async function fetchMemberRedemptions(memberId: string): Promise<RedemptionWithDetails[]> {
  try {
    const res = await fetch(`/api/redemptions?member_id=${memberId}`);
    if (!res.ok) return [];
    return res.json();
  } catch {
    return [];
  }
}

export async function fetchAllRedemptions(brandId: string = "brand-celsius"): Promise<RedemptionWithDetails[]> {
  try {
    const res = await fetch(`/api/redemptions?brand_id=${brandId}`);
    if (!res.ok) return [];
    return res.json();
  } catch {
    return [];
  }
}

// ─── Products ───────────────────────────────────────
import type { Product } from "@/types";

export async function fetchProducts(
  brandId: string = "brand-celsius",
  options?: { category?: string; search?: string; all?: boolean },
): Promise<Product[]> {
  try {
    const params = new URLSearchParams({ brand_id: brandId });
    if (options?.category) params.set("category", options.category);
    if (options?.search) params.set("search", options.search);
    if (options?.all) params.set("all", "true");

    const res = await fetch(`/api/products?${params.toString()}`);
    if (!res.ok) return [];
    const data = await res.json();
    return data.products ?? [];
  } catch {
    return [];
  }
}

export async function syncProductsFromStoreHub(
  brandId: string = "brand-celsius",
): Promise<{ success: boolean; synced?: number; errors?: number; error?: string }> {
  try {
    const res = await fetch("/api/products/sync", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "include",
      body: JSON.stringify({ brand_id: brandId }),
    });
    return res.json();
  } catch {
    return { success: false, error: "Network error" };
  }
}

// ─── Staff ───────────────────────────────────────────
export async function verifyStaffPin(
  outletId: string,
  pin: string,
): Promise<{ success: boolean; staff_name?: string; outlet_name?: string; error?: string }> {
  try {
    const res = await fetch("/api/staff/verify-pin", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "include",
      body: JSON.stringify({ outlet_id: outletId, pin }),
    });
    return res.json();
  } catch {
    return { success: false, error: "Network error" };
  }
}
