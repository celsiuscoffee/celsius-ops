// Pickup app — hand-crafted types for orders & order items

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
  first_order_discount_amount: number;
  reward_id: string | null;
  reward_name: string | null;
  sst_amount: number;
  total: number;
  customer_name: string | null;
  customer_phone: string | null;
  /** "dine_in" (QR table order) | "pickup" / "takeaway". Optional so older
   *  reads stay valid; absence is treated as a non-dine-in order. */
  order_type: string | null;
  /** Set for dine_in orders — the table the QR was scanned at. */
  table_number: string | null;
  loyalty_phone: string | null;
  loyalty_id: string | null;
  loyalty_points_earned: number;
  notes: string | null;
  created_at: string;
  updated_at: string;
  /** Sales channel the order came through — set by the unified orders
   *  endpoint: "pickup" (customer app / web / QR), "pos" (in-store
   *  register), "grab" (GrabFood). Optional so single-source reads stay valid. */
  channel?: string;
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
