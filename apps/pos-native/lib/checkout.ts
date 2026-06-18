import { supabase } from "./supabase";
import type { CartLine } from "./cart";
import { useSettings } from "./settings";
import { newId, bufferSale } from "./offline-queue";
import { flushPending } from "./sale-sync";
import { getOnline, markOnline, markOffline, withTimeout } from "./connectivity";

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
  // Take the highest SEQUENTIAL number, ignoring offline time-coded numbers
  // (CC-XX-<base36>, e.g. "0NOUN"/"A86RD"). Reading only the single newest row
  // broke when that row was an offline order: parseInt("0NOUN") -> 0 reset the
  // sequence to CC-XX-0001, which already exists -> UNIQUE collision -> the sale
  // jammed the offline queue. Sequential numbers grow monotonically with time,
  // so the newest row whose tail is all-digits carries the max. (The server
  // also regenerates on any collision, so this is belt-and-suspenders.)
  const { data } = await supabase
    .from("pos_orders")
    .select("order_number")
    .eq("outlet_id", outletId)
    .order("created_at", { ascending: false })
    .limit(40);
  let seq = 0;
  for (const row of data ?? []) {
    const tail = ((row.order_number as string | null) ?? "").split("-").pop() ?? "";
    if (/^\d+$/.test(tail)) {
      seq = parseInt(tail, 10);
      break; // newest all-numeric number = current max sequence
    }
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
  /** Identified member id — drives the deferred points earn fired on sync. */
  memberId?: string | null;
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
  // Why the ORDER-level manual discount was given + who authorised it. The
  // reason is the composed text (label · note); discountBy is the staff/manager
  // id (the manager when a staff override was used, else the cashier). Per-LINE
  // comps carry their own reason/by on each cart line. Persisted to
  // pos_orders.discount_reason / discount_by for the comps audit.
  manualDiscountReason?: string | null;
  discountBy?: string | null;
};

export type Sale = {
  id: string;
  orderNumber: string;
  subtotal: number;
  serviceCharge: number;
  sst: number;
  discount: number;
  total: number;
  createdAt: string;
};

// Register/shift context is cached per outlet so an offline sale can still
// attribute to the last-known register + shift (reconciled on sync). Resolved
// online when connected; reused offline.
const ctxCache: Record<string, { registerId: string | null; shiftId: string | null }> = {};

async function resolveContext(
  outletId: string,
  staffId: string,
): Promise<{ registerId: string | null; shiftId: string | null }> {
  if (!getOnline()) return ctxCache[outletId] ?? { registerId: null, shiftId: null };
  try {
    const registerId = await withTimeout(Promise.resolve(resolveRegisterId(outletId)), 4000);
    const shiftId = await withTimeout(Promise.resolve(ensureOpenShift(outletId, registerId, staffId)), 4000);
    ctxCache[outletId] = { registerId, shiftId };
    markOnline();
    return ctxCache[outletId];
  } catch {
    markOffline();
    return ctxCache[outletId] ?? { registerId: null, shiftId: null };
  }
}

// Online → the sequential CC-CODE-NNNN number. Offline → a distinct time-based
// fallback (CC-CODE-XXXXX) that won't collide and visibly flags an offline
// order. Persisted as-is on sync.
async function resolveOrderNumber(outletId: string): Promise<string> {
  if (getOnline()) {
    try {
      const n = await withTimeout(Promise.resolve(nextOrderNumber(outletId)), 4000);
      markOnline();
      return n;
    } catch {
      markOffline();
    }
  }
  const code = OUTLET_CODE[outletId] ?? "CC";
  return `CC-${code}-${Date.now().toString(36).slice(-5).toUpperCase()}`;
}

export async function createSale(params: SaleParams): Promise<Sale> {
  const { outletId, staffId, lines } = params;
  if (lines.length === 0) throw new Error("Cart is empty");

  const subtotal = lines.reduce((s, l) => s + l.unit_sen * l.qty, 0);
  // Effective per-line fulfilment: a takeaway ORDER packs every line to-go; a
  // dine-in order honours each line's per-item `takeaway` override. Single
  // source of truth for the docket tag + pos_order_items.fulfillment.
  const isTakeaway = (l: CartLine) => params.orderType === "takeaway" || l.takeaway === true;
  // Service charge applies to DINE-IN lines only (Malaysia convention) — summed
  // per line so a mixed order charges it correctly. The rate is 0 today, so this
  // is 0; the moment a service charge is enabled, mixed orders are already right.
  const dineInGross = lines.reduce((s, l) => s + (isTakeaway(l) ? 0 : l.unit_sen * l.qty), 0);
  const serviceCharge = Math.round((dineInGross * (params.serviceChargeRate ?? 0)) / 100);
  // Total discount = redeemed voucher + auto tier% / promotions + the
  // cashier's manual discount, clamped so it never exceeds what's owed.
  const rewardDiscount = Math.max(0, params.rewardDiscount ?? 0);
  const promoDiscount = Math.max(0, params.promoDiscount ?? 0);
  const manualDiscount = Math.max(0, params.manualDiscount ?? 0);
  const discount = Math.min(rewardDiscount + promoDiscount + manualDiscount, subtotal + serviceCharge);
  const afterDiscount = Math.max(0, subtotal + serviceCharge - discount);
  // SST — single source of truth (app_settings.sst), the same rate the
  // pickup/order app applies, so in-store and pickup charge identically.
  // Added on top of the net (post-discount) amount; the service charge is
  // part of the taxable base. Toggle off in the backoffice → sstAmount = 0.
  const { rate: sstRate, enabled: sstEnabled } = useSettings.getState().sst;
  const sstAmount = sstEnabled ? Math.round(afterDiscount * sstRate) : 0;
  const total = afterDiscount + sstAmount;

  // ── Build the sale locally (online-first, offline-tolerant) ──────────────
  // The till never blocks on, or fails because of, the network: assign a client
  // UUID, record the completed sale to a durable local buffer, then push it to
  // the cloud via the atomic, idempotent create_pos_sale RPC. Online → the push
  // lands in ~1s and clears the buffer; offline → it stays buffered and the sync
  // loop retries on reconnect. The caller prints from the returned Sale either way.
  const orderId = newId();
  const createdAt = new Date().toISOString();
  const { registerId, shiftId } = await resolveContext(outletId, staffId);
  const orderNumber = await resolveOrderNumber(outletId);

  const orderRow = {
    id: orderId,
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
    sst_amount: sstAmount,
    discount_amount: discount,
    // Manual-discount audit: only meaningful when the cashier actually applied
    // one, so don't stamp a reason/authoriser for a purely promo/reward bill.
    discount_reason: (params.manualDiscount ?? 0) > 0 ? params.manualDiscountReason ?? null : null,
    discount_by: (params.manualDiscount ?? 0) > 0 ? params.discountBy ?? null : null,
    promo_discount: promoDiscount,
    promo_name: params.promoName ?? null,
    total,
    customer_phone: params.customerPhone ?? null,
    loyalty_phone: params.loyaltyPhone ?? null,
    reward_id: params.rewardId ?? null,
    reward_name: params.rewardName ?? null,
    reward_discount_amount: rewardDiscount,
    notes: params.notes ?? null,
    created_at: createdAt,
  };

  // line_discount_sen (per-cart-line manual discount) is persisted as
  // pos_order_items.discount_amount so reporting can split line-level vs
  // order-level promos. item_total is the net (post-discount) value.
  const items = lines.map((l) => {
    const lineDiscount = l.line_discount_sen ?? 0;
    const lineGross = l.unit_sen * l.qty;
    return {
      id: newId(),
      product_id: l.product.id,
      product_name: l.product.name,
      quantity: l.qty,
      unit_price: l.unit_sen,
      modifiers: l.modifiers.map((m) => ({ id: m.id, name: m.name, price: m.price_sen })),
      modifier_total: l.modifiers.reduce((s, m) => s + m.price_sen, 0),
      discount_amount: lineDiscount,
      // Per-line comp audit — reason + who authorised it (null when the line
      // wasn't discounted).
      discount_reason: lineDiscount > 0 ? l.line_discount_reason ?? null : null,
      discount_by: lineDiscount > 0 ? l.line_discount_by ?? null : null,
      item_total: Math.max(0, lineGross - lineDiscount),
      kitchen_station: l.product.kitchen_station ?? null,
      // Per-item kitchen note — printed under the item on the docket and kept
      // on the order line (same column Grab/Pickup dockets read).
      notes: l.note ?? null,
      // Per-line fulfilment so the kitchen packs the right items + reports can
      // split a mixed order at the line level.
      fulfillment: isTakeaway(l) ? "takeaway" : "dine_in",
    };
  });

  const payments = [
    { id: newId(), payment_method: params.paymentMethod, amount: total, status: "completed" },
  ];

  await bufferSale({
    payload: { order: orderRow, items, payments },
    loyalty: params.memberId ? { memberId: params.memberId, orderId } : null,
    bufferedAt: createdAt,
    attempts: 0,
  });
  // Fire-and-forget push: online syncs immediately, offline stays buffered.
  void flushPending();

  return {
    id: orderId,
    orderNumber,
    subtotal,
    serviceCharge,
    sst: sstAmount,
    discount,
    total,
    createdAt,
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
