// ─── Amount convention: all monetary values in SEN (integer) ───
// RM 12.50 = 1250 sen

// ─── Products ────────────────────────────────────────────────

export type ModifierOption = {
  name: string;
  price: number; // sen
};

export type ModifierGroup = {
  group_name: string;
  is_required: boolean;
  min_select: number;
  max_select: number;
  options: ModifierOption[];
};

export type Product = {
  id: string;
  brand_id: string;
  storehub_id: string | null;
  name: string;
  sku: string | null;
  category: string | null;
  tags: string[];
  description: string | null;
  image_url: string | null;
  image_urls: string[];
  price: number; // sen
  cost: number | null; // sen
  online_price: number | null; // sen
  tax_code: string | null;
  tax_rate: number; // basis points (600 = 6%)
  pricing_type: "fixed" | "variable" | "weight";
  modifiers: ModifierGroup[];
  track_stock: boolean;
  stock_level: number | null;
  kitchen_station: string | null;
  is_available: boolean;
  is_featured: boolean;
  /** When true the register prints a second copy of the kitchen
   *  docket for this product. Used for items that the kitchen splits
   *  across stations or that the runner separates (e.g. beer packages,
   *  set meals). */
  print_additional_docket?: boolean;
  synced_at: string | null;
  created_at: string;
  updated_at: string;
};

export type ProductVariant = {
  id: string;
  product_id: string;
  name: string;
  sku: string | null;
  barcode: string | null;
  price: number | null; // sen, null = use parent
  cost: number | null;
  stock_level: number | null;
  storehub_variant_id: string | null;
  is_available: boolean;
  created_at: string;
};

export type ProductCategory = {
  id: string;
  brand_id: string;
  name: string;
  slug: string;
  sort_order: number;
  storehub_category_id: string | null;
  is_active: boolean;
  created_at: string;
};

// ─── Orders ──────────────────────────────────────────────────

export type OrderSource = "pos" | "pickup" | "qr_dine_in" | "delivery";
export type OrderType = "dine_in" | "takeaway";
export type OrderStatus =
  | "open"
  | "sent_to_kitchen"
  | "ready"
  | "completed"
  | "cancelled"
  | "failed";

export type Order = {
  id: string;
  order_number: string;
  branch_id: string;
  register_id: string | null;
  shift_id: string | null;
  employee_id: string | null;
  source: OrderSource;
  order_type: OrderType;
  status: OrderStatus;
  table_number: string | null;
  queue_number: string | null;
  subtotal: number; // sen
  sst_amount: number;
  service_charge: number;
  discount_amount: number;
  rounding_amount: number;
  total: number; // sen
  customer_phone: string | null;
  customer_name: string | null;
  loyalty_phone: string | null;
  loyalty_points_earned: number;
  reward_id: string | null;
  reward_name: string | null;
  reward_discount_amount: number;
  voucher_code: string | null;
  cancellation_reason: string | null;
  notes: string | null;
  created_at: string;
  updated_at: string;
};

export type KitchenStatus = "pending" | "preparing" | "done";

export type OrderItem = {
  id: string;
  order_id: string;
  product_id: string;
  product_name: string;
  variant_id: string | null;
  variant_name: string | null;
  quantity: number;
  unit_price: number; // sen
  modifiers: ModifierGroup[]; // selected modifiers
  modifier_total: number; // sen
  discount_amount: number;
  tax_amount: number;
  item_total: number; // sen
  notes: string | null;
  kitchen_station: string | null;
  kitchen_status: KitchenStatus;
  sent_to_kitchen_at: string | null;
  created_at: string;
};

export type PaymentStatus = "pending" | "completed" | "failed" | "refunded";

export type OrderPayment = {
  id: string;
  order_id: string;
  payment_method: string;
  provider: string | null;
  amount: number; // sen
  provider_ref: string | null;
  status: PaymentStatus;
  refund_amount: number;
  refund_reason: string | null;
  refunded_at: string | null;
  created_at: string;
};

// ─── Branch / Staff / Shift ──────────────────────────────────

export type BranchType = "outlet" | "central_kitchen";

export type Branch = {
  id: string;
  code: string;
  name: string;
  branch_type: BranchType;
  address: string | null;
  city: string | null;
  state: string | null;
  phone: string | null;
  storehub_id: string | null;
  operating_hours: Record<string, { open: string; close: string }> | null;
  timezone: string;
  is_active: boolean;
  created_at: string;
  updated_at: string;
};

export type StaffRole = "admin" | "manager" | "staff";

export type StaffUser = {
  id: string;
  brand_id: string;
  branch_id: string | null;
  name: string;
  email: string | null;
  phone: string | null;
  role: StaffRole;
  pin_hash: string;
  assigned_branches: string[];
  is_active: boolean;
  created_at: string;
};

export type Shift = {
  id: string;
  branch_id: string;
  register_id: string;
  opened_by: string;
  closed_by: string | null;
  opened_at: string;
  closed_at: string | null;
  total_sales: number; // sen
  total_orders: number;
  total_refunds: number; // sen
};

export type Register = {
  id: string;
  branch_id: string;
  name: string;
  is_active: boolean;
};

// ─── Cart (client-side only, not persisted) ──────────────────

export type CartItem = {
  cartItemId: string; // client-generated UUID
  product: Product;
  variant: ProductVariant | null;
  selectedModifiers: { group_name: string; option: ModifierOption }[];
  quantity: number;
  notes: string;
  unitPrice: number; // sen (variant price or product price)
  modifierTotal: number; // sen
  lineTotal: number; // sen
};

// ─── Helpers ─────────────────────────────────────────────────

// ─── Promotions ──────────────────────────────────────────────

export type DiscountType = "percentage_off" | "amount_off" | "buy_x_get_y" | "combo_bundle" | "override_price";
export type ApplyTo = "all_orders" | "orders_over" | "category" | "tags" | "specific_products";
export type CustomerEligibility = "everyone" | "customer_tags" | "first_time" | "membership";

export type Promotion = {
  id: string;
  brand_id: string;
  name: string;
  promo_code: string | null;
  discount_type: DiscountType;
  discount_value: number | null; // sen or basis points
  combo_price: number | null;
  override_price: number | null;
  buy_quantity: number | null;
  free_quantity: number | null;
  apply_to: ApplyTo;
  apply_min_order: number | null;
  apply_categories: string[];
  apply_tags: string[];
  apply_product_ids: string[];
  apply_min_qty: number | null;
  apply_max_qty: number | null;
  require_purchase: boolean;
  require_categories: string[];
  require_tags: string[];
  require_product_ids: string[];
  require_min_qty: number | null;
  customer_eligibility: CustomerEligibility;
  eligible_customer_tags: string[];
  eligible_membership_tiers: string[];
  total_usage_limit: number | null;
  per_customer_limit: number | null;
  current_usage_count: number;
  allow_repeat: boolean;
  channels: string[];
  branch_ids: string[] | null;
  is_enabled: boolean;
  start_date: string | null;
  end_date: string | null;
  created_at: string;
  updated_at: string;
};

// Applied promotion result on a cart
export type AppliedPromotion = {
  promotion: Promotion;
  discountAmount: number; // sen
  affectedItemIds: string[]; // cartItemIds that were discounted
  description: string; // e.g. "10% Off (Buy 2 Burgers)"
};

// ─── Helpers ─────────────────────────────────────────────────

/** Format sen to RM string: 1250 → "12.50" */
export function formatRM(sen: number): string {
  return (sen / 100).toFixed(2);
}

/** Format sen to display string: 1250 → "RM 12.50" */
export function displayRM(sen: number): string {
  return `RM ${formatRM(sen)}`;
}
