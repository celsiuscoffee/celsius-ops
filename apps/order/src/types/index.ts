// ==========================================
// Celsius Pickup (order) — Core Types
//
// Canonical entities live in @celsius/shared and are re-exported below.
// MemberBrand and Reward are intentionally NARROWER than loyalty's — the
// order/pickup surface has no tier system and no combo/override reward
// mechanics — so they stay local here.
// ==========================================

export type {
  Brand,
  Outlet,
  Member,
  PointTransaction,
  Redemption,
  Campaign,
  SMSLog,
  StaffUser,
  TopSpender,
  DashboardStats,
  IssuedReward,
} from "@celsius/shared";

import type { Member } from "@celsius/shared";

export interface MemberBrand {
  id: string;
  member_id: string;
  brand_id: string;
  points_balance: number;
  total_points_earned: number;
  total_points_redeemed: number;
  total_visits: number;
  total_spent: number;
  joined_at: string;
  last_visit_at: string | null;
}

export interface Reward {
  id: string;
  brand_id: string;
  name: string;
  description: string | null;
  image_url: string | null;
  points_required: number;
  category: string; // "drink", "food", "merch", "voucher"
  is_active: boolean;
  stock: number | null; // null = unlimited
  max_redemptions_per_member: number | null; // null = unlimited
  valid_from: string | null;
  valid_until: string | null;
  reward_type: "standard" | "new_member" | "points_shop";
  auto_issue: boolean;
  validity_days: number | null;
  // ─── Pickup app discount mechanics ───
  discount_type: "fixed_amount" | "percentage" | "free_item" | "bogo" | null;
  discount_value: number | null; // 5.00 for RM5 off, 20 for 20%, null for free_item/bogo
  max_discount_value: number | null; // cap for % discounts
  min_order_value: number | null; // minimum cart total
  applicable_products: string[] | null; // product IDs, null = all
  applicable_categories: string[] | null; // category slugs, null = all
  free_product_ids: string[] | null; // for free_item: claimable product IDs
  free_product_name: string | null; // "Any Hot Coffee"
  bogo_buy_qty: number | null; // buy X
  bogo_free_qty: number | null; // get Y free
  fulfillment_type: string[] | null; // ['in_store','pickup','delivery'], null = all
  expiry_minutes: number | null; // pickup redemption validity (default 60)
  created_at: string;
  updated_at: string;
}

// Member with brand-specific data
export interface MemberWithBrand extends Member {
  brand_data: MemberBrand;
}

// Reward with progress for a specific member
export interface RewardWithProgress extends Reward {
  member_points: number;
  points_remaining: number;
  progress_percentage: number;
}
