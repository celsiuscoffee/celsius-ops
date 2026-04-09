// ==========================================
// Celsius Loyalty — Core Types
// Multi-tenant: supports multiple brands
// ==========================================

export interface Brand {
  id: string;
  name: string;
  slug: string; // e.g. "celsius-coffee", "berbuka-celsius"
  logo_url: string | null;
  primary_color: string; // hex
  secondary_color: string; // hex
  points_per_rm: number; // e.g. 1 = RM1 = 1 point
  currency: string; // "MYR"
  is_active: boolean;
  points_expiry_months: number; // 0 = no expiry
  points_expiry_enabled: boolean;
  daily_earning_limit: number; // 0 = unlimited
  sms_credits_balance?: number;
  created_at: string;
  updated_at: string;
}

export interface Outlet {
  id: string;
  brand_id: string;
  name: string;
  address: string;
  city: string;
  state: string;
  phone: string | null;
  storehub_store_id?: string; // StoreHub POS store ID for auto-sync
  is_active: boolean;
  created_at: string;
}

export interface Member {
  id: string;
  phone: string; // Stored as +60XXXXXXXXX format for SMS delivery
  name: string | null;
  email: string | null;
  birthday: string | null; // YYYY-MM-DD
  preferred_outlet_id: string | null;
  sms_opt_out?: boolean;
  consent_at?: string | null;
  created_at: string;
  updated_at: string;
}

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

export interface PointTransaction {
  id: string;
  member_id: string;
  brand_id: string;
  outlet_id: string | null;
  type: "earn" | "redeem" | "bonus" | "expire" | "adjust";
  points: number; // positive for earn, negative for redeem
  balance_after: number;
  description: string;
  reference_id: string | null; // POS transaction ID
  multiplier: number; // 1x, 2x, 3x
  created_at: string;
  created_by: string | null; // staff user id
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

export interface Redemption {
  id: string;
  member_id: string;
  reward_id: string;
  brand_id: string;
  outlet_id: string | null;
  points_spent: number;
  status: "pending" | "confirmed" | "collected" | "used" | "cancelled" | "expired";
  code: string; // unique redemption code
  confirmed_at: string | null;
  confirmed_by: string | null; // staff
  // ─── Pickup app fields ───
  redemption_type: "in_store" | "pickup" | "delivery";
  pickup_outlet_id: string | null;
  expires_at: string | null;
  collected_at: string | null;
  source: "portal" | "web_app" | "pickup_app";
  created_at: string;
}

export interface Campaign {
  id: string;
  brand_id: string;
  name: string;
  description: string | null;
  type: "multiplier" | "bonus" | "broadcast";
  multiplier: number | null; // for multiplier campaigns
  bonus_points: number | null; // for bonus campaigns
  message: string | null; // for broadcast
  target_segment: "all" | "new" | "active" | "inactive";
  start_date: string;
  end_date: string;
  is_active: boolean;
  created_at: string;
  sms_message?: string;
  sms_sent_count?: number;
  sms_sent_at?: string;
}

export interface SMSLog {
  id: string;
  brand_id: string;
  campaign_id: string | null;
  member_id: string | null;
  phone: string;
  message: string;
  status: "sent" | "delivered" | "failed" | "pending";
  provider: string;
  provider_message_id: string | null;
  error: string | null;
  created_at: string;
  created_by: string | null;
}

export interface StaffUser {
  id: string;
  brand_id: string;
  outlet_id: string | null;
  outlet_ids: string[];
  name: string;
  email: string;
  role: "admin" | "manager" | "staff";
  pin_hash: string | null; // bcrypt-hashed PIN (never plaintext)
  is_active: boolean;
  created_at: string;
}

// Dashboard analytics
export interface DashboardStats {
  total_members: number;
  new_members_today: number;
  new_members_this_month: number;
  total_points_issued: number;
  total_points_redeemed: number;
  total_redemptions: number;
  total_revenue_attributed: number;
  active_campaigns: number;
  // Enhanced insights
  active_members_30d: number;
  floating_points: number;
  member_transaction_pct: number;
  avg_lifetime_value_members: number;
  avg_lifetime_value_nonmembers: number;
  reward_redemption_rate: number;
  top_spenders: TopSpender[];
  new_members_by_month: { month: string; count: number }[];
  redemptions_by_month: { month: string; count: number }[];
  recent_activity?: { id: string; name: string; text: string; type: string; date: string }[];
  returning_count?: number;
  new_count?: number;
  eligible_count?: number;
}

export interface TopSpender {
  id: string;
  name: string | null;
  phone: string;
  total_spent: number;
  total_visits: number;
  total_points_earned: number;
  total_rewards_redeemed: number;
  last_visit_at: string | null;
}

export interface IssuedReward {
  id: string;
  member_id: string;
  reward_id: string;
  brand_id: string;
  issued_at: string;
  expires_at: string | null;
  status: "active" | "used" | "expired";
  code: string;
  year: number | null;
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
