/**
 * GrabFood order ingestion — the single source of truth for turning a Grab
 * order payload into pos_orders / pos_order_items / pos_order_payments.
 *
 * Used by BOTH the live webhook (/api/pos/grab/webhook) and the reconciliation
 * job (lib/grab-reconcile) so a backfilled order is created exactly like a
 * webhook-delivered one — no drift, no second code path. Extracted from the
 * webhook route verbatim; the only additions are `opts` (autoAccept /
 * statusOverride) so reconciliation can replay an already-finished order without
 * re-accepting it or dropping it onto the live KDS.
 */

import { randomUUID } from "crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { acceptRejectOrder } from "@/lib/grab";
import { mapGrabStatusToPOS, shouldApplyStatus, type GrabOrderState } from "@/lib/grab-order-status";
import {
  indexProductsByGrabKeys,
  resolveGrabItemProduct,
  fallbackGrabItemName,
  resolveGrabModifierName,
  resolveModifierNameFromCatalogue,
  type GrabItemProductRow,
  type CatalogueModifierGroup,
} from "@/lib/grab-order-items";

export interface GrabOrderItemModifier {
  id?: string;
  price?: number;
  tax?: number;
  quantity?: number;
}

export interface GrabOrderItem {
  id: string;
  grabItemID?: string;
  quantity: number;
  price: number;
  tax?: number;
  specifications?: string;
  modifiers?: GrabOrderItemModifier[];
  comment?: string;
}

export interface GrabOrderPrice {
  subtotal?: number;
  tax?: number;
  merchantChargeFee?: number;
  serviceChargeFee?: number;
  deliveryFee?: number;
  grabFundPromo?: number;
  merchantFundPromo?: number;
  eaterPayment?: number;
}

export interface GrabWebhookPayload {
  orderID: string;
  shortOrderNumber: string;
  merchantID: string;
  partnerMerchantID?: string;
  paymentType: "CASH" | "CASHLESS";
  orderTime: string;
  submitTime: string;
  orderState: GrabOrderState;
  currency: { code: string; symbol: string; exponent: number };
  featureFlags: Record<string, boolean>;
  items: GrabOrderItem[];
  receiver?: {
    name: string;
    phones?: string[];
    address?: { unitNumber?: string; deliveryInstruction?: string };
  };
  price?: GrabOrderPrice;
  orderPrice?: GrabOrderPrice;
  orderType: "DELIVERY" | "PICKUP" | "DINE_IN";
}

function firstStr(...vals: unknown[]): string | null {
  for (const v of vals) if (typeof v === "string" && v.trim()) return v.trim();
  return null;
}
export function extractOrderNote(p: GrabWebhookPayload): string | null {
  const r = p.receiver as { deliveryInstruction?: string; address?: { deliveryInstruction?: string } } | undefined;
  const x = p as unknown as Record<string, unknown>;
  return firstStr(
    r?.address?.deliveryInstruction, r?.deliveryInstruction,
    x.comment, x.comments, x.remarks, x.instructions, x.instruction, x.note, x.notes, x.orderNote, x.specialInstructions,
  );
}
function extractItemNote(it: GrabOrderItem): string | null {
  const x = it as unknown as Record<string, unknown>;
  return firstStr(it.specifications, it.comment, x.comments, x.notes, x.note, x.instructions, x.remarks, x.specialInstructions);
}

export type IngestAction = "updated" | "noop" | "skipped" | "no_outlet" | "created" | "duplicate" | "error";
export interface IngestResult {
  action: IngestAction;
  orderId?: string | null;
  reason?: string;
  from?: string;
  to?: string;
  error?: string;
  acceptStatus?: string;
}

export interface IngestOpts {
  /** Auto-accept the order on Grab (live webhook). false for reconciliation
   *  backfills of already-finished orders. Default true. */
  autoAccept?: boolean;
  /** Initial pos_orders.status. Default "sent_to_kitchen" (live). Reconciliation
   *  passes the order's CURRENT mapped Grab status so a completed order isn't
   *  dropped onto the live KDS. */
  statusOverride?: string;
  /** Tag stored in notes when set (e.g. "[reconciled]"). */
  originTag?: string;
}

/**
 * Candidate order_numbers for a Grab order, in preference order. pos_orders has
 * a GLOBAL unique constraint on order_number, but GrabFood "short" numbers
 * (e.g. 445) are only unique per-merchant-per-day and recur — so the clean
 * GF-<short> collides with an older order. We fall back to the globally-unique
 * Grab order id (external_id) to disambiguate, so the order is never dropped.
 */
function grabOrderNumberCandidates(shortNo: string, orderID: string): string[] {
  const base = `GF-${shortNo || orderID.slice(0, 6)}`;
  const tail = orderID.replace(/[^A-Za-z0-9]/g, "").slice(-6).toUpperCase();
  const out = [base];
  if (tail) out.push(`${base}-${tail}`);
  out.push(`GF-${orderID}`); // last resort: external_id is globally unique
  return out;
}

export type InsertOrderResult =
  | { status: "created"; id: string }
  | { status: "duplicate"; id: string | null }
  | { status: "error"; error: string };

/**
 * Insert a grabfood pos_orders row, choosing a unique order_number. On a 23505
 * we distinguish a REAL duplicate (this external_id already exists → idempotent
 * no-op) from an order_number collision with a DIFFERENT order (recurring short
 * number → try the next candidate). Previously a collision was misread as a
 * duplicate and the order was silently dropped (no docket, no revenue).
 * `row` must include external_id and must NOT include order_number.
 */
export async function insertGrabPosOrder(
  supabase: SupabaseClient,
  row: Record<string, unknown>,
  shortNo: string,
  orderID: string,
): Promise<InsertOrderResult> {
  for (const order_number of grabOrderNumberCandidates(shortNo, orderID)) {
    const { data, error } = await supabase
      .from("pos_orders").insert({ ...row, order_number }).select("id").single();
    if (!error && data) return { status: "created", id: (data as { id: string }).id };
    if ((error as { code?: string } | null)?.code === "23505") {
      const { data: dup } = await supabase
        .from("pos_orders").select("id").eq("external_id", row.external_id as string).maybeSingle();
      if (dup) return { status: "duplicate", id: (dup as { id: string }).id };
      continue; // order_number taken by a different order — disambiguate
    }
    return { status: "error", error: error?.message || "insert failed" };
  }
  return { status: "error", error: "order_number candidates exhausted (all collided)" };
}

/**
 * Idempotent ingest: update an existing order's status (forward-only), skip a
 * no-items state push, or create the order + items + payment. Safe to call from
 * the webhook or a replay.
 */
export async function ingestGrabOrder(
  supabase: SupabaseClient,
  payload: GrabWebhookPayload,
  opts: IngestOpts = {},
): Promise<IngestResult> {
  const { orderID, orderState, merchantID } = payload;
  const itemCount = Array.isArray(payload.items) ? payload.items.length : 0;

  // 1. Existing order → forward-only status update.
  const { data: existing } = await supabase
    .from("pos_orders").select("id, status").eq("external_id", orderID).maybeSingle();
  if (existing) {
    const newStatus = mapGrabStatusToPOS(orderState);
    const apply = shouldApplyStatus(existing.status, newStatus);
    if (apply) {
      await supabase.from("pos_orders")
        .update({ status: newStatus, updated_at: new Date().toISOString() })
        .eq("id", existing.id);
    }
    return { action: apply ? "updated" : "noop", orderId: existing.id, from: existing.status, to: newStatus };
  }

  // 2. No items → a Push Order State that arrived before the Submit Order.
  if (itemCount === 0) {
    return { action: "skipped", reason: "state-push-no-items" };
  }

  // 3. Resolve outlet (grab_merchant_id primary, partner store id fallback).
  const pmid = (payload.partnerMerchantID || "").trim();
  const orParts = [`grab_merchant_id.eq.${merchantID}`];
  if (pmid) orParts.push(`storehub_store_id.eq.${pmid}`, `id.eq.${pmid}`);
  const { data: outlet } = await supabase
    .from("outlets").select("id").or(orParts.join(",")).maybeSingle();
  const outletId = outlet?.id || process.env.DEFAULT_OUTLET_ID || "";
  if (!outletId) {
    return { action: "no_outlet" };
  }

  // 4. Totals — minor units (sen). Real key is `price`; simulator used `orderPrice`.
  const price: GrabOrderPrice = payload.price ?? payload.orderPrice ?? {};
  const itemsArr = Array.isArray(payload.items) ? payload.items : [];
  const itemsSubtotal = itemsArr.reduce(
    (n, it) =>
      n +
      ((it.price ?? 0) +
        (it.modifiers ?? []).reduce((m, md) => m + (md.price ?? 0) * (md.quantity ?? 1), 0)) *
        (it.quantity ?? 1),
    0,
  );
  const subtotal = price.subtotal && price.subtotal > 0 ? price.subtotal : itemsSubtotal;
  const sst = price.tax ?? 0;
  const merchantFees = (price.merchantChargeFee ?? 0) + (price.serviceChargeFee ?? 0);
  const discount = (price.grabFundPromo ?? 0) + (price.merchantFundPromo ?? 0);
  const total = subtotal + merchantFees;
  const orderType =
    payload.orderType === "DINE_IN" ? "dine_in" :
    payload.orderType === "PICKUP" ? "pickup" : "takeaway";

  // 5. Insert order. order_number carries a GLOBAL unique constraint, but
  // GrabFood short numbers recur across days — insertGrabPosOrder keeps the
  // clean GF-<short> when free and disambiguates on collision, so an order is
  // never silently dropped as a false "duplicate".
  const shortNo = (payload.shortOrderNumber ?? "").replace(/^GF-/i, "");
  const baseNote = extractOrderNote(payload);
  const notes = opts.originTag ? `${opts.originTag}${baseNote ? ` ${baseNote}` : ""}` : baseNote;
  const ins = await insertGrabPosOrder(supabase, {
    external_id: orderID,
    outlet_id: outletId,
    source: "grabfood",
    order_type: orderType,
    status: opts.statusOverride ?? "sent_to_kitchen",
    subtotal, sst_amount: sst, discount_amount: discount, total,
    customer_name: payload.receiver?.name || "Grab Customer",
    customer_phone: payload.receiver?.phones?.[0] || null,
    notes,
  }, shortNo, orderID);
  if (ins.status === "duplicate") return { action: "duplicate", orderId: ins.id };
  if (ins.status === "error") return { action: "error", error: ins.error };
  const order = { id: ins.id };

  // 6. Items — resolved from our catalogue by partner id / grab_item_id.
  const candidateIds = Array.from(
    new Set(itemsArr.flatMap((i) => [i.id, i.grabItemID]).filter(Boolean) as string[]),
  );
  const productIndex = new Map<string, GrabItemProductRow>();
  const modifiersByProductId = new Map<string, CatalogueModifierGroup[]>();
  if (candidateIds.length > 0) {
    const [byId, byGrab] = await Promise.all([
      supabase.from("products").select("id, name, grab_item_id, modifiers").in("id", candidateIds),
      supabase.from("products").select("id, name, grab_item_id, modifiers").in("grab_item_id", candidateIds),
    ]);
    const rows = [
      ...((byId.data ?? []) as GrabItemProductRow[]),
      ...((byGrab.data ?? []) as GrabItemProductRow[]),
    ];
    for (const [k, v] of indexProductsByGrabKeys(rows)) productIndex.set(k, v);
    for (const r of [...(byId.data ?? []), ...(byGrab.data ?? [])] as Array<{ id: string; modifiers?: unknown }>) {
      if (Array.isArray(r.modifiers)) modifiersByProductId.set(r.id, r.modifiers as CatalogueModifierGroup[]);
    }
  }

  const modifierIds = Array.from(
    new Set(itemsArr.flatMap((i) => (i.modifiers ?? []).map((m) => m.id)).filter(Boolean) as string[]),
  );
  const modifierNameById = new Map<string, string>();
  if (modifierIds.length > 0) {
    const { data: links } = await supabase
      .from("grab_modifier_links").select("grab_modifier_id, name").in("grab_modifier_id", modifierIds);
    for (const l of (links ?? []) as Array<{ grab_modifier_id: string; name: string }>) {
      modifierNameById.set(l.grab_modifier_id, l.name);
    }
  }
  const orderItems = itemsArr.map((item) => {
    const product = resolveGrabItemProduct(item, productIndex);
    const qty = item.quantity ?? 1;
    const unitPrice = item.price ?? 0;
    const modTotal = (item.modifiers ?? []).reduce((n, m) => n + (m.price ?? 0) * (m.quantity ?? 1), 0);
    const itemTotal = unitPrice * qty;
    return {
      id: randomUUID(),
      order_id: order.id,
      product_id: product?.id || item.id || item.grabItemID || randomUUID(),
      product_name: product?.name || fallbackGrabItemName(item),
      grab_item_id: item.grabItemID || item.id || null,
      quantity: qty,
      unit_price: unitPrice,
      modifiers: (item.modifiers ?? []).map((m) => ({
        grab_modifier_id: m.id ?? null,
        name:
          (m.id ? modifierNameById.get(m.id) : undefined) ??
          resolveModifierNameFromCatalogue(m.id, modifiersByProductId) ??
          resolveGrabModifierName(m, modifierNameById),
        price: m.price,
        qty: m.quantity,
      })),
      modifier_total: modTotal,
      discount_amount: 0,
      tax_amount: item.tax ?? 0,
      item_total: itemTotal,
      notes: extractItemNote(item),
      kitchen_status: "pending",
      created_at: new Date().toISOString(),
    };
  });
  if (orderItems.length > 0) {
    const { error: itemsErr } = await supabase.from("pos_order_items").insert(orderItems);
    if (itemsErr) console.error("[grab:ingest] items insert failed:", itemsErr);
  }

  // 7. Payment.
  const { error: payErr } = await supabase.from("pos_order_payments").insert({
    id: randomUUID(),
    order_id: order.id,
    payment_method: payload.paymentType === "CASH" ? "cash" : "grabpay",
    amount: total,
    // Must be one of the pos_order_payments_status_check values
    // (pending|completed|failed|refunded); "paid" was rejected (23514), silently
    // orphaning every Grab payment row. "completed" == card/qr's paid state.
    status: "completed",
    provider: "grabfood",
    provider_ref: orderID,
    refund_amount: 0,
    created_at: new Date().toISOString(),
  });
  if (payErr) console.error("[grab:ingest] payment insert failed:", payErr);

  // 8. Auto-accept on Grab (live webhook only) + record the outcome.
  let acceptStatus: string | null = null;
  let acceptError: string | null = null;
  if (opts.autoAccept !== false) {
    if (process.env.GRAB_CLIENT_ID && process.env.GRAB_CLIENT_SECRET) {
      try {
        await acceptRejectOrder(orderID, "ACCEPTED");
        acceptStatus = "accepted";
      } catch (e) {
        acceptStatus = "failed";
        acceptError = (e instanceof Error ? e.message : String(e)).slice(0, 500);
        console.warn(`[grab:ingest] auto-accept failed orderID=${orderID}:`, acceptError);
      }
    } else {
      acceptStatus = "skipped_no_creds";
    }
  }

  // Best-effort outcome columns (separate from the insert so a schema-cache miss
  // can never block order creation).
  {
    const patch: Record<string, unknown> = { grab_merchant_promo: price.merchantFundPromo ?? 0 };
    if (acceptStatus) { patch.grab_accept_status = acceptStatus; patch.grab_accept_error = acceptError; }
    const { error: colErr } = await supabase.from("pos_orders").update(patch).eq("id", order.id);
    if (colErr) console.warn("[grab:ingest] outcome write skipped:", colErr.message);
  }

  return { action: "created", orderId: order.id, acceptStatus: acceptStatus ?? undefined };
}
