// Hand-crafted until `npx supabase gen types typescript` is run against the real project

export type OrderStatus =
  | "pending"
  | "paid"
  | "preparing"
  | "ready"
  | "completed"
  | "failed";

export interface OrderRow {
  id: string;
  order_number: string;
  store_id: string;
  status: OrderStatus;
  payment_method: string;
  payment_provider_ref: string | null;
  subtotal: number;
  discount_amount: number;
  voucher_code: string | null;
  reward_discount_amount: number;
  reward_id: string | null;
  reward_name: string | null;
  sst_amount: number;
  total: number;
  customer_name: string | null;
  customer_phone: string | null;
  loyalty_phone: string | null;
  loyalty_id: string | null;
  loyalty_points_earned: number;
  notes: string | null;
  created_at: string;
  updated_at: string;
}

export interface OrderItemRow {
  id: string;
  order_id: string;
  product_id: string;
  product_name: string;
  variant_name: string | null;
  unit_price: number;
  quantity: number;
  item_total: number;
  modifiers: {
    selections?: { groupId: string; groupName: string; optionId: string; label: string; priceDelta: number }[];
    specialInstructions?: string;
  };
  created_at: string;
}

// Promo banner config stored in app_settings table as key="promo_banner"
export interface PromoBanner {
  enabled:     boolean;
  label:       string;  // e.g. "New User Promo"
  headline:    string;  // e.g. "Buy 1"
  highlight:   string;  // e.g. "Free 1"
  description: string;  // e.g. "First app order · Any drink · Any size"
}

export interface AppSettingRow {
  key:        string;
  value:      unknown;
  updated_at: string;
}

type OrderInsert = Omit<OrderRow, "id" | "created_at" | "updated_at">;
type OrderUpdate = Partial<Omit<OrderRow, "id" | "created_at">>;
type OrderItemInsert = Omit<OrderItemRow, "id" | "created_at">;
type OrderItemUpdate = Partial<Omit<OrderItemRow, "id" | "created_at">>;

// ── Inventory rows ─────────────────────────────────────────────────────────

export interface IngredientRow {
  id:        string;
  name:      string;
  unit:      string;
  is_active: boolean;
  created_at: string;
}

export interface StockLevelRow {
  id:            string;
  ingredient_id: string;
  store_id:      string;
  quantity:      number;
  updated_at:    string;
}

export interface IngredientOutletSettingRow {
  id:            string;
  ingredient_id: string;
  store_id:      string;
  par_level:     number;
}

// ── Loyalty rows ───────────────────────────────────────────────────────────

export interface MemberRow {
  id:         string;
  name:       string | null;
  phone:      string;
  created_at: string;
}

export interface MemberBrandRow {
  id:                  string;
  member_id:           string;
  brand_id:            string;
  points_balance:      number;
  total_points_earned: number;
  total_spent:         number;
  last_visit_at:       string | null;
  created_at:          string;
}

export interface RedemptionRow {
  id:         string;
  brand_id:   string;
  member_id:  string;
  created_at: string;
}

// ── Staff rows ─────────────────────────────────────────────────────────────

export interface StaffMemberRow {
  id:            string;
  name:          string;
  email:         string | null;
  pin:           string | null;
  role:          string;
  outlet_ids:    string[];
  app_access:    string[];
  module_access: Record<string, string[]> | null;
  is_active:     boolean;
  supabase_uid:  string | null;
  created_at:    string;
  updated_at:    string | null;
}

// ── Database ───────────────────────────────────────────────────────────────

export type Database = {
  public: {
    Tables: {
      orders: {
        Row:           OrderRow;
        Insert:        OrderInsert;
        Update:        OrderUpdate;
        Relationships: [];
      };
      order_items: {
        Row:           OrderItemRow;
        Insert:        OrderItemInsert;
        Update:        OrderItemUpdate;
        Relationships: [];
      };
      ingredients: {
        Row:           IngredientRow;
        Insert:        Omit<IngredientRow, "id" | "created_at">;
        Update:        Partial<Omit<IngredientRow, "id" | "created_at">>;
        Relationships: [];
      };
      stock_levels: {
        Row:           StockLevelRow;
        Insert:        Omit<StockLevelRow, "id" | "updated_at">;
        Update:        Partial<Omit<StockLevelRow, "id">>;
        Relationships: [];
      };
      ingredient_outlet_settings: {
        Row:           IngredientOutletSettingRow;
        Insert:        Omit<IngredientOutletSettingRow, "id">;
        Update:        Partial<Omit<IngredientOutletSettingRow, "id">>;
        Relationships: [];
      };
      members: {
        Row:           MemberRow;
        Insert:        Omit<MemberRow, "id" | "created_at">;
        Update:        Partial<Omit<MemberRow, "id" | "created_at">>;
        Relationships: [];
      };
      member_brands: {
        Row:           MemberBrandRow;
        Insert:        Omit<MemberBrandRow, "id" | "created_at">;
        Update:        Partial<Omit<MemberBrandRow, "id" | "created_at">>;
        Relationships: [];
      };
      redemptions: {
        Row:           RedemptionRow;
        Insert:        Omit<RedemptionRow, "id" | "created_at">;
        Update:        Partial<Omit<RedemptionRow, "id" | "created_at">>;
        Relationships: [];
      };
      staff_members: {
        Row:           StaffMemberRow;
        Insert:        Omit<StaffMemberRow, "id" | "created_at">;
        Update:        Partial<Omit<StaffMemberRow, "id" | "created_at">>;
        Relationships: [];
      };
    };
    Views: Record<string, never>;
    Functions: Record<string, never>;
    Enums: Record<string, never>;
    CompositeTypes: Record<string, never>;
  };
};
