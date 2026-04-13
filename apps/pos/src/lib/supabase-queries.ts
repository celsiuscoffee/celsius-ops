import { createClient } from "./supabase-browser";

const supabase = createClient();

// ─── Products (from existing products table) ───────────────

export async function fetchPopularProductIds(limit = 12): Promise<string[]> {
  const { data } = await supabase
    .from("pos_order_items")
    .select("product_id")
    .order("created_at", { ascending: false })
    .limit(500);
  if (!data) return [];
  // Count frequency
  const counts: Record<string, number> = {};
  for (const row of data) {
    counts[row.product_id] = (counts[row.product_id] ?? 0) + 1;
  }
  return Object.entries(counts)
    .sort((a, b) => b[1] - a[1])
    .slice(0, limit)
    .map(([id]) => id);
}

export async function fetchProducts() {
  // Fetch ALL products (including sold out) so staff can toggle availability on POS
  const { data, error } = await supabase
    .from("products")
    .select("*")
    .order("name");
  if (error) throw error;
  return data ?? [];
}

export async function fetchCategories() {
  const { data, error } = await supabase
    .from("products")
    .select("category")
    .not("category", "is", null);
  if (error) throw error;
  // Deduplicate and sort
  const cats = [...new Set((data ?? []).map((d: { category: string }) => d.category))].sort();
  return cats;
}

export async function updateProductAvailability(productId: string, isAvailable: boolean) {
  const { error } = await supabase
    .from("products")
    .update({ is_available: isAvailable, updated_at: new Date().toISOString() })
    .eq("id", productId);
  if (error) throw error;
}

// ─── Staff / Auth ──────────────────────────────────────────

// PIN verification is now handled server-side via /api/auth/pin
// This function is kept for backward compatibility but should not be used
export async function fetchStaffByPin(_pinHash: string) {
  return [];
}

export async function fetchAllStaff() {
  const { data, error } = await supabase
    .from("staff_users")
    .select("id, name, email, role, brand_id, outlet_id, is_active")
    .order("name");
  if (error) throw error;
  return data ?? [];
}

// ─── Outlets ───────────────────────────────────────────────

export async function fetchOutlets() {
  const { data, error } = await supabase
    .from("outlets")
    .select("*")
    .order("name");
  if (error) throw error;
  return data ?? [];
}

// ─── POS Registers ─────────────────────────────────────────

export async function fetchRegisters(outletId: string) {
  const { data, error } = await supabase
    .from("pos_registers")
    .select("*")
    .eq("outlet_id", outletId)
    .eq("is_active", true);
  if (error) throw error;
  return data ?? [];
}

// ─── POS Shifts ────────────────────────────────────────────

export async function openShift(outletId: string, registerId: string, staffId: string) {
  const { data, error } = await supabase
    .from("pos_shifts")
    .insert({
      outlet_id: outletId,
      register_id: registerId,
      opened_by: staffId,
    })
    .select()
    .single();
  if (error) throw error;
  return data;
}

export async function closeShift(shiftId: string, staffId: string, totalSales: number, totalOrders: number, totalRefunds: number) {
  const { data, error } = await supabase
    .from("pos_shifts")
    .update({
      closed_by: staffId,
      closed_at: new Date().toISOString(),
      total_sales: totalSales,
      total_orders: totalOrders,
      total_refunds: totalRefunds,
    })
    .eq("id", shiftId)
    .select()
    .single();
  if (error) throw error;
  return data;
}

export async function fetchActiveShift(outletId: string, registerId: string) {
  const { data, error } = await supabase
    .from("pos_shifts")
    .select("*")
    .eq("outlet_id", outletId)
    .eq("register_id", registerId)
    .is("closed_at", null)
    .order("opened_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw error;
  return data;
}

// ─── POS Orders ────────────────────────────────────────────

export async function createOrder(order: {
  order_number: string;
  outlet_id: string;
  register_id: string;
  shift_id: string;
  employee_id: string;
  order_type: string;
  status: string;
  table_number?: string | null;
  queue_number?: string | null;
  subtotal: number;
  sst_amount?: number;
  service_charge?: number;
  discount_amount?: number;
  promo_discount?: number;
  promo_name?: string | null;
  total: number;
  customer_phone?: string | null;
  customer_name?: string | null;
  loyalty_phone?: string | null;
  reward_id?: string | null;
  reward_name?: string | null;
  reward_discount_amount?: number;
  loyalty_points_earned?: number;
  notes?: string | null;
}) {
  const { data, error } = await supabase
    .from("pos_orders")
    .insert(order)
    .select()
    .single();
  if (error) throw error;
  return data;
}

export async function createOrderItems(items: {
  order_id: string;
  product_id: string;
  product_name: string;
  variant_id?: string | null;
  variant_name?: string | null;
  quantity: number;
  unit_price: number;
  modifiers: unknown;
  modifier_total: number;
  item_total: number;
  notes?: string | null;
  kitchen_station?: string | null;
  kitchen_status?: string;
}[]) {
  const { data, error } = await supabase
    .from("pos_order_items")
    .insert(items)
    .select();
  if (error) throw error;
  return data;
}

export async function createOrderPayment(payment: {
  order_id: string;
  payment_method: string;
  provider?: string | null;
  amount: number;
  provider_ref?: string | null;
  status?: string;
}) {
  const { data, error } = await supabase
    .from("pos_order_payments")
    .insert(payment)
    .select()
    .single();
  if (error) throw error;
  return data;
}

export async function updateOrderStatus(orderId: string, status: string, extra?: Record<string, unknown>) {
  const { error } = await supabase
    .from("pos_orders")
    .update({ status, ...extra })
    .eq("id", orderId);
  if (error) throw error;
}

export async function fetchOrdersByShift(shiftId: string) {
  const { data, error } = await supabase
    .from("pos_orders")
    .select("*, pos_order_items(*), pos_order_payments(*)")
    .eq("shift_id", shiftId)
    .order("created_at", { ascending: false });
  if (error) throw error;
  return data ?? [];
}

export async function fetchOpenOrders(outletId: string) {
  const { data, error } = await supabase
    .from("pos_orders")
    .select("*, pos_order_items(*)")
    .eq("outlet_id", outletId)
    .in("status", ["open", "sent_to_kitchen"])
    .order("created_at", { ascending: false });
  if (error) throw error;
  return data ?? [];
}

// ─── KDS (Realtime) ────────────────────────────────────────

export async function fetchKDSOrders(outletId: string) {
  const { data, error } = await supabase
    .from("pos_orders")
    .select("*, pos_order_items(*)")
    .eq("outlet_id", outletId)
    .in("status", ["sent_to_kitchen", "ready"])
    .order("created_at", { ascending: true });
  if (error) throw error;
  return data ?? [];
}

export async function updateKitchenItemStatus(itemId: string, status: string) {
  const { error } = await supabase
    .from("pos_order_items")
    .update({
      kitchen_status: status,
      ...(status === "preparing" ? {} : {}),
    })
    .eq("id", itemId);
  if (error) throw error;
}

export function subscribeToKDSOrders(outletId: string, callback: () => void) {
  return supabase
    .channel("kds-orders")
    .on(
      "postgres_changes",
      { event: "*", schema: "public", table: "pos_orders", filter: `outlet_id=eq.${outletId}` },
      callback
    )
    .on(
      "postgres_changes",
      { event: "*", schema: "public", table: "pos_order_items" },
      callback
    )
    .subscribe();
}

// ─── Queue Number ──────────────────────────────────────────

export async function getNextQueueNumber(outletId: string) {
  // Atomic increment to prevent race condition with multiple registers
  const { data, error } = await supabase.rpc("increment_queue_counter", { p_outlet_id: outletId });
  if (error || !data) {
    // Fallback: non-atomic
    const { data: settings } = await supabase
      .from("pos_branch_settings")
      .select("queue_counter")
      .eq("outlet_id", outletId)
      .single();
    const counter = settings?.queue_counter ?? 1001;
    await supabase.from("pos_branch_settings").update({ queue_counter: counter + 1 }).eq("outlet_id", outletId);
    return `TA-${counter}`;
  }
  return `TA-${data}`;
}

// ─── Branch Settings ───────────────────────────────────────

export async function fetchBranchSettings(outletId: string) {
  const { data, error } = await supabase
    .from("pos_branch_settings")
    .select("*")
    .eq("outlet_id", outletId)
    .single();
  if (error) throw error;
  return data;
}

// ─── Promotions ────────────────────────────────────────────

export async function fetchActivePromotions() {
  const now = new Date().toISOString();
  const { data, error } = await supabase
    .from("pos_promotions")
    .select("*")
    .eq("is_enabled", true)
    .or(`start_date.is.null,start_date.lte.${now}`)
    .or(`end_date.is.null,end_date.gte.${now}`);
  if (error) throw error;
  return data ?? [];
}

// ─── Kitchen Stations ──────────────────────────────────────

// ─── POS Register Layouts (custom tabs) ────────────────

export async function fetchRegisterLayouts(outletId: string) {
  const { data, error } = await supabase
    .from("pos_register_layouts")
    .select("*")
    .eq("outlet_id", outletId)
    .eq("is_active", true)
    .order("sort_order");
  if (error) throw error;
  return data ?? [];
}

export async function upsertRegisterLayout(layout: {
  id?: string;
  outlet_id: string;
  name: string;
  sort_order: number;
  product_ids?: string[];
  include_categories?: string[];
  include_tags?: string[];
  color?: string;
  is_active?: boolean;
}) {
  const { data, error } = await supabase
    .from("pos_register_layouts")
    .upsert(layout)
    .select()
    .single();
  if (error) throw error;
  return data;
}

export async function deleteRegisterLayout(id: string) {
  await supabase.from("pos_register_layouts").delete().eq("id", id);
}

export async function fetchProductTags(): Promise<string[]> {
  const { data } = await supabase.from("products").select("tags").not("tags", "eq", "{}");
  if (!data) return [];
  const allTags = new Set<string>();
  for (const p of data) { for (const t of (p.tags ?? [])) allTags.add(t); }
  return [...allTags].sort();
}

// ─── Kitchen Stations ──────────────────────────────────

export async function fetchKitchenStations(outletId: string) {
  const { data, error } = await supabase
    .from("pos_kitchen_stations")
    .select("*")
    .eq("outlet_id", outletId)
    .eq("is_active", true)
    .order("sort_order");
  if (error) throw error;
  return data ?? [];
}
