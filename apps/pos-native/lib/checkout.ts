import { supabase } from "./supabase";
import type { CartLine } from "./cart";

/**
 * Order creation — native port of the web register's createPOSOrder
 * (apps/pos/src/lib/supabase-queries.ts). Writes via the anon client,
 * exactly like the web POS does (RLS permits these inserts).
 *
 * All money is integer sen end-to-end (matches the pos_orders /
 * pos_order_items integer columns and the cart's *_sen fields).
 *
 * Flow: resolve the outlet's register → ensure an open shift →
 * generate the next order number → insert pos_orders, its items, and
 * the payment row. register_id/shift_id are nullable in the schema but
 * we set them so reports + the Z-report attribute correctly.
 */

// Per-outlet receipt code for the CC-XXX-NNNN order number. Order
// numbers are sequenced per outlet_id, so the code is just a human
// hint, not a uniqueness key.
const OUTLET_CODE: Record<string, string> = {
  "outlet-sa": "SA",
  "outlet-con": "CON",
  "outlet-tam": "TAM",
  "outlet-nilai": "NIL",
};

async function resolveRegisterId(outletId: string): Promise<string | null> {
  const { data } = await supabase
    .from("pos_registers")
    .select("id")
    .eq("outlet_id", outletId)
    .eq("is_active", true)
    .limit(1);
  return data?.[0]?.id ?? null;
}

async function ensureOpenShift(
  outletId: string,
  registerId: string | null,
  staffId: string,
): Promise<string | null> {
  if (!registerId) return null;
  // Re-use the currently-open shift for this register, else open one.
  const { data: open } = await supabase
    .from("pos_shifts")
    .select("id")
    .eq("outlet_id", outletId)
    .eq("register_id", registerId)
    .is("closed_at", null)
    .order("opened_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (open?.id) return open.id;

  const { data: created, error } = await supabase
    .from("pos_shifts")
    .insert({ outlet_id: outletId, register_id: registerId, opened_by: staffId })
    .select("id")
    .single();
  if (error) {
    console.warn("[checkout] openShift failed:", error.message);
    return null;
  }
  return created?.id ?? null;
}

async function nextOrderNumber(outletId: string): Promise<string> {
  const { data } = await supabase
    .from("pos_orders")
    .select("order_number")
    .eq("outlet_id", outletId)
    .order("created_at", { ascending: false })
    .limit(1);
  let seq = 0;
  const last = data?.[0]?.order_number as string | undefined;
  if (last) {
    const n = parseInt(last.split("-").pop() ?? "", 10);
    if (!isNaN(n)) seq = n;
  }
  const code = OUTLET_CODE[outletId] ?? "CC";
  return `CC-${code}-${String(seq + 1).padStart(4, "0")}`;
}

export type SaleParams = {
  outletId: string;
  staffId: string;
  lines: CartLine[];
  orderType: "dine_in" | "takeaway";
  paymentMethod: string; // "cash" | "card" | "qr"
  /** Outlet service-charge percent from pos_branch_settings (e.g. 10 = 10%). */
  serviceChargeRate?: number;
  tableNumber?: string | null;
  queueNumber?: string | null;
  customerPhone?: string | null;
  notes?: string | null;
  // Loyalty (member + applied reward).
  loyaltyPhone?: string | null;
  rewardId?: string | null;
  rewardName?: string | null;
  rewardDiscount?: number; // sen — redeemed voucher
  // Auto-applied tier % + promotions (sen) and a human label for the receipt.
  promoDiscount?: number; // sen
  promoName?: string | null;
  // Cashier-applied manual discount (sen). Folds into discount_amount —
  // mirrors the web POS, which has no dedicated manual-discount column.
  manualDiscount?: number; // sen
};

export type Sale = {
  id: string;
  orderNumber: string;
  subtotal: number;
  serviceCharge: number;
  discount: number;
  total: number;
  createdAt: string;
};

export async function createSale(params: SaleParams): Promise<Sale> {
  const { outletId, staffId, lines } = params;
  if (lines.length === 0) throw new Error("Cart is empty");

  const subtotal = lines.reduce((s, l) => s + l.unit_sen * l.qty, 0);
  // Service charge is a backoffice-set percent on the subtotal (sen),
  // applied to DINE-IN only (mirrors the web register). Reward discount
  // comes off the total. Total floors at 0 (a fully-discounted order is
  // valid — e.g. a free-drink voucher).
  const serviceCharge =
    params.orderType === "dine_in"
      ? Math.round((subtotal * (params.serviceChargeRate ?? 0)) / 100)
      : 0;
  // Total discount = redeemed voucher + auto tier% / promotions + the
  // cashier's manual discount, clamped so it never exceeds what's owed.
  const rewardDiscount = Math.max(0, params.rewardDiscount ?? 0);
  const promoDiscount = Math.max(0, params.promoDiscount ?? 0);
  const manualDiscount = Math.max(0, params.manualDiscount ?? 0);
  const discount = Math.min(rewardDiscount + promoDiscount + manualDiscount, subtotal + serviceCharge);
  const total = Math.max(0, subtotal + serviceCharge - discount);

  const registerId = await resolveRegisterId(outletId);
  const shiftId = await ensureOpenShift(outletId, registerId, staffId);
  const orderNumber = await nextOrderNumber(outletId);

  // ── Order header ──
  const { data: order, error: orderErr } = await supabase
    .from("pos_orders")
    .insert({
      order_number: orderNumber,
      outlet_id: outletId,
      register_id: registerId,
      shift_id: shiftId,
      employee_id: staffId,
      order_type: params.orderType,
      status: "completed",
      table_number: params.tableNumber ?? null,
      queue_number: params.queueNumber ?? null,
      subtotal,
      service_charge: serviceCharge,
      discount_amount: discount,
      promo_discount: promoDiscount,
      promo_name: params.promoName ?? null,
      total,
      customer_phone: params.customerPhone ?? null,
      loyalty_phone: params.loyaltyPhone ?? null,
      reward_id: params.rewardId ?? null,
      reward_name: params.rewardName ?? null,
      reward_discount_amount: rewardDiscount,
      notes: params.notes ?? null,
    })
    .select("id, order_number, total, created_at")
    .single();
  if (orderErr) throw orderErr;

  // ── Line items ──
  const items = lines.map((l) => ({
    order_id: order.id,
    product_id: l.product.id,
    product_name: l.product.name,
    quantity: l.qty,
    unit_price: l.unit_sen,
    modifiers: l.modifiers.map((m) => ({ id: m.id, name: m.name, price: m.price_sen })),
    modifier_total: l.modifiers.reduce((s, m) => s + m.price_sen, 0),
    item_total: l.unit_sen * l.qty,
    kitchen_station: l.product.kitchen_station ?? null,
    kitchen_status: "pending",
  }));
  const { error: itemsErr } = await supabase.from("pos_order_items").insert(items);
  if (itemsErr) throw itemsErr;

  // ── Payment ──
  const { error: payErr } = await supabase.from("pos_order_payments").insert({
    order_id: order.id,
    payment_method: params.paymentMethod,
    amount: total,
    status: "completed",
  });
  if (payErr) throw payErr;

  return {
    id: order.id,
    orderNumber: order.order_number,
    subtotal,
    serviceCharge,
    discount,
    total: order.total,
    createdAt: order.created_at ?? new Date().toISOString(),
  };
}

/**
 * Next queue number for takeaway orders — reads + increments
 * pos_branch_settings.queue_counter for the outlet (mirrors the web
 * getNextQueueNumber). Best-effort: on any error we fall back to a
 * time-based number so checkout never blocks.
 */
export async function getNextQueueNumber(outletId: string): Promise<string> {
  try {
    const { data } = await supabase
      .from("pos_branch_settings")
      .select("queue_counter")
      .eq("outlet_id", outletId)
      .maybeSingle();
    const counter = (data?.queue_counter as number | null) ?? 0;
    const next = counter + 1;
    await supabase.from("pos_branch_settings").update({ queue_counter: next }).eq("outlet_id", outletId);
    return String(next);
  } catch {
    return String((Date.now() % 1000) + 1);
  }
}
