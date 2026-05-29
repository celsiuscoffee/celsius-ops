// ==========================================
// Celsius Loyalty — Core Types
// Multi-tenant: supports multiple brands
//
// Canonical entities shared with apps/order live in @celsius/shared and
// are re-exported below. Loyalty-specific supersets (tier-aware
// MemberBrand, combo/override Reward) plus the tier and product types
// stay here.
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
  current_tier_id: string | null;
  tier_evaluated_at: string | null;
}

export interface Tier {
  id: string;
  brand_id: string;
  name: string;
  slug: string;
  min_visits: number;
  period_days: number;
  color: string;
  icon: string;
  benefits: string[];
  multiplier: number;
  sort_order: number;
  is_active: boolean;
  created_at: string;
}

export interface MemberTierStatus {
  tier_id: string;
  tier_name: string;
  tier_slug: string;
  tier_color: string;
  tier_icon: string;
  tier_multiplier: number;
  tier_benefits: string[];
  visits_this_period: number;
  period_days: number;
  next_tier_id: string | null;
  next_tier_name: string | null;
  next_tier_min_visits: number | null;
  visits_to_next_tier: number;
  active_post_purchase?: ActivePostPurchase | null;
}

export interface ActivePostPurchase {
  id: string;
  reward_name: string;
  multiplier: number;
  expires_at: string;
  hours_remaining: number;
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
  discount_type: "fixed_amount" | "percentage" | "free_item" | "bogo" | "override_price" | "combo" | null;
  discount_value: number | null; // 5.00 for RM5 off, 20 for 20%, null for free_item/bogo
  max_discount_value: number | null; // cap for % discounts
  override_price: number | null; // for override_price: set fixed price
  combo_product_ids: string[] | null; // for combo: product IDs in the bundle
  combo_price: number | null; // for combo: bundle price
  min_order_value: number | null; // minimum cart total
  applicable_products: string[] | null; // product IDs, null = all
  applicable_categories: string[] | null; // category slugs, null = all
  applicable_tags: string[] | null; // StoreHub product tags, null = all
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

// ─── Products (synced from StoreHub) ────────────────

export interface ProductModifierOption {
  name: string;
  price: number;
  is_default: boolean;
}

export interface ProductModifierGroup {
  group: string;
  type: "single" | "multiple";
  required: boolean;
  min: number;
  max: number;
  options: ProductModifierOption[];
}

export interface Product {
  id: string;
  brand_id: string;
  storehub_product_id: string | null;
  name: string;
  sku: string | null;
  category: string | null;
  tags: string[];
  description: string | null;
  image_url: string | null;
  image_urls: string[];
  pricing_type: "fixed" | "variable" | "weight";
  price: number;
  cost: number | null;
  online_price: number | null;
  grabfood_price: number | null;
  tax_code: string | null;
  tax_rate: number;
  modifiers: ProductModifierGroup[];
  is_available: boolean;
  online_channels: string[];
  is_featured: boolean;
  is_preorder: boolean;
  kitchen_station: string | null;
  track_stock: boolean;
  stock_level: number | null;
  synced_at: string | null;
  storehub_updated_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface ProductVariant {
  id: string;
  product_id: string;
  name: string;
  sku: string | null;
  barcode: string | null;
  price: number | null;
  cost: number | null;
  stock_level: number | null;
  storehub_variant_id: string | null;
  is_available: boolean;
  created_at: string;
}

export interface ProductCategory {
  id: string;
  brand_id: string;
  name: string;
  slug: string;
  sort_order: number;
  storehub_category_id: string | null;
  is_active: boolean;
  created_at: string;
}
