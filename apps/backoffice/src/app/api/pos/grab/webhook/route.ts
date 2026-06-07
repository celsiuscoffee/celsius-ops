/**
 * Grab Webhook Receiver — handles Submit Order + Push Order State.
 *
 * Grab posts/PUTs here with x-grab-signature (HMAC-SHA256 over the raw body,
 * keyed on GRAB_HMAC_SECRET — falls back to GRAB_CLIENT_SECRET for staging
 * test stores that share secrets).
 *
 * Order ingestion writes to pos_orders / pos_order_items / pos_order_payments.
 * Outlet resolution: outlets.grab_merchant_id → outlets.storehub_store_id →
 * DEFAULT_OUTLET_ID env fallback.
 */

import { NextRequest, NextResponse } from "next/server";
import { randomUUID } from "crypto";
import { verifyWebhookSignature } from "@/lib/grab";
import { verifyGrabPartnerToken } from "@/lib/grab-partner";
import { createClient } from "@/lib/supabase-server";

interface GrabOrderItem {
  id: string;
  grabItemID: string;
  name: string;
  quantity: number;
  price: number;
  modifiers?: Array<{ id: string; name: string; quantity: number; price: number }>;
  comment?: string;
}

interface GrabWebhookPayload {
  orderID: string;
  shortOrderNumber: string;
  merchantID: string;
  partnerMerchantID?: string;
  paymentType: "CASH" | "CASHLESS";
  orderTime: string;
  submitTime: string;
  orderState:
    | "PENDING" | "ACCEPTED" | "DRIVER_ALLOCATED" | "DRIVER_ARRIVED"
    | "COLLECTED" | "DELIVERED" | "CANCELLED" | "FAILED";
  currency: { code: string; symbol: string; exponent: number };
  featureFlags: Record<string, boolean>;
  items: GrabOrderItem[];
  receiver?: {
    name: string;
    phones?: string[];
    address?: { unitNumber?: string; deliveryInstruction?: string };
  };
  orderPrice: {
    subtotal: number;
    tax: number;
    deliveryFee: number;
    eaterPayment: number;
    grabFundPromo?: number;
    merchantFundPromo?: number;
  };
  orderType: "DELIVERY" | "PICKUP" | "DINE_IN";
}

function mapGrabStatusToPOS(state: GrabWebhookPayload["orderState"]): string {
  switch (state) {
    case "PENDING": case "DRIVER_ALLOCATED": return "open";
    case "ACCEPTED": return "sent_to_kitchen";
    case "DRIVER_ARRIVED": return "ready";
    case "COLLECTED": case "DELIVERED": return "completed";
    case "CANCELLED": case "FAILED": return "cancelled";
    default: return "open";
  }
}

// Grab / the simulator put the order note in different places across API
// versions (receiver.address.deliveryInstruction vs a top-level comment /
// remarks / instructions). Capture the first non-empty candidate so it reaches
// the docket + receipt instead of being silently dropped.
function firstStr(...vals: unknown[]): string | null {
  for (const v of vals) if (typeof v === "string" && v.trim()) return v.trim();
  return null;
}
function extractOrderNote(p: GrabWebhookPayload): string | null {
  const r = p.receiver as { deliveryInstruction?: string; address?: { deliveryInstruction?: string } } | undefined;
  const x = p as unknown as Record<string, unknown>;
  return firstStr(
    r?.address?.deliveryInstruction, r?.deliveryInstruction,
    x.comment, x.comments, x.remarks, x.instructions, x.instruction, x.note, x.notes, x.orderNote, x.specialInstructions,
  );
}
function extractItemNote(it: GrabOrderItem): string | null {
  const x = it as unknown as Record<string, unknown>;
  return firstStr(it.comment, x.comments, x.notes, x.note, x.instructions, x.remarks, x.specialInstructions);
}

export async function POST(request: NextRequest) {
  try {
    const rawBody = await request.text();
    const signature = request.headers.get("x-grab-signature") || "";

    // Accept EITHER a valid partner Bearer token (Grab simulator pattern —
    // they call /oauth/token first, then present that JWT here) OR a matching
    // HMAC signature (production-style webhook signing). Either is sufficient.
    const bearerOk = await verifyGrabPartnerToken(request);
    const hmacOk = !!signature && verifyWebhookSignature(rawBody, signature);
    if (!bearerOk && !hmacOk) {
      // Reject silently. NEVER echo computed HMAC candidates — doing so leaks
      // the expected signature and lets an attacker forge webhooks the moment a
      // real GRAB_HMAC_SECRET is set. Minimal, non-sensitive server log only.
      console.warn(`[grab:webhook] unauthorized bearer=${bearerOk} hmac=${hmacOk} sig_present=${!!signature}`);
      return NextResponse.json({ error: "Invalid signature" }, { status: 401 });
    }

    const payload: GrabWebhookPayload = JSON.parse(rawBody);
    const { orderID, orderState, merchantID } = payload;
    const supabase = await createClient();

    // Trace every authenticated webhook hit (otherwise "skipped" looks
    // identical to "ok" in the Vercel log table).
    const itemCount = Array.isArray(payload.items) ? payload.items.length : 0;
    console.log(
      `[grab:webhook] hit method=${request.method} orderID=${orderID} state=${orderState ?? "<none>"} items=${itemCount} merchant=${merchantID}`,
    );

    // 1. Existing order → status update path.
    const { data: existing } = await supabase
      .from("pos_orders").select("id, status").eq("external_id", orderID).maybeSingle();
    if (existing) {
      const newStatus = mapGrabStatusToPOS(orderState);
      if (existing.status !== newStatus) {
        await supabase.from("pos_orders")
          .update({ status: newStatus, updated_at: new Date().toISOString() })
          .eq("id", existing.id);
      }
      return NextResponse.json({ success: true, action: "updated", orderId: existing.id, state: orderState });
    }

    // 2. Create whenever the payload carries items (Submit Order). Push
    //    Order State payloads carry no items — those legitimately fall
    //    through here when the matching order hasn't been created yet
    //    (race). The old strict allow-list dropped real Submit Orders
    //    whose orderState the simulator omitted.
    if (itemCount === 0) {
      console.log(`[grab:webhook] skipped — no items, state=${orderState ?? "<none>"} orderID=${orderID}`);
      return NextResponse.json({ success: true, action: "skipped", reason: "state-push-no-items", state: orderState });
    }

    // 3. Resolve outlet (grab_merchant_id primary, storehub_store_id fallback).
    // Resolve outlet: (1) Grab store ID → grab_merchant_id, else fall back to
    // the Partner store ID → storehub_store_id OR our outlet id itself. The deck
    // convention is "Partner store ID = POS outlet ID", so at go-live we can set
    // each store's Partner store ID to our outlet id (e.g. "outlet-sa") and it
    // resolves without needing grab_merchant_id pre-populated.
    const pmid = (payload.partnerMerchantID || "").trim();
    const orParts = [`grab_merchant_id.eq.${merchantID}`];
    if (pmid) orParts.push(`storehub_store_id.eq.${pmid}`, `id.eq.${pmid}`);
    const { data: outlet } = await supabase
      .from("outlets").select("id")
      .or(orParts.join(","))
      .maybeSingle();
    const outletId = outlet?.id || process.env.DEFAULT_OUTLET_ID || "";
    if (!outletId) {
      console.error(`[grab:webhook] no outlet linked for merchantID=${merchantID}`);
      return NextResponse.json(
        { error: "No outlet linked. Set outlets.grab_merchant_id in BackOffice → Integrations → GrabFood." },
        { status: 400 },
      );
    }

    // 4. Totals (already in sen from Grab). Defensive — the simulator's
    //    Submit Order can omit orderPrice; un-guarded access was 500'ing.
    const price = payload.orderPrice ?? ({} as GrabWebhookPayload["orderPrice"]);
    const subtotal = price.subtotal ?? 0;
    const sst = price.tax ?? 0;
    const total = price.eaterPayment ?? subtotal;
    const discount = (price.grabFundPromo ?? 0) + (price.merchantFundPromo ?? 0);
    const orderType =
      payload.orderType === "DINE_IN" ? "dine_in" :
      payload.orderType === "PICKUP" ? "pickup" : "takeaway";

    // 5. Insert order. shortOrderNumber sometimes arrives already prefixed
    //    with "GF-", so strip any existing prefix to avoid "GF-GF-6782".
    const shortNo = (payload.shortOrderNumber ?? "").replace(/^GF-/i, "");
    const { data: order, error: orderErr } = await supabase
      .from("pos_orders")
      .insert({
        external_id: orderID,
        order_number: `GF-${shortNo || orderID.slice(0, 6)}`,
        outlet_id: outletId,
        source: "grabfood",
        order_type: orderType,
        status: "sent_to_kitchen",
        subtotal, sst_amount: sst, discount_amount: discount, total,
        customer_name: payload.receiver?.name || "Grab Customer",
        customer_phone: payload.receiver?.phones?.[0] || null,
        notes: extractOrderNote(payload),
      })
      .select("id").single();
    if (orderErr || !order) {
      // Duplicate-delivery race: a concurrent Submit Order for the same orderID
      // won the unique(external_id) insert. Treat as success so Grab stops
      // retrying the (already-created) order forever.
      if ((orderErr as { code?: string } | null)?.code === "23505") {
        const { data: dup } = await supabase
          .from("pos_orders").select("id").eq("external_id", orderID).maybeSingle();
        console.log(`[grab:webhook] duplicate submit orderID=${orderID} → existing id=${dup?.id ?? "?"}`);
        return NextResponse.json({ success: true, action: "duplicate", orderId: dup?.id ?? null });
      }
      console.error("[grab:webhook] insert pos_orders failed:", orderErr);
      return NextResponse.json(
        { error: `Failed to create order: ${orderErr?.message || "unknown"}` },
        { status: 500 },
      );
    }

    // 6. Items. Defensive defaults + products-table lookup so the docket
    //    prints a real product name (not "Item") when Grab omits names.
    const itemsArr = Array.isArray(payload.items) ? payload.items : [];
    const productIds = Array.from(
      new Set(itemsArr.map((i) => i.grabItemID || i.id).filter(Boolean) as string[]),
    );
    type ProductLookupRow = { id: string; name: string };
    let products: Map<string, ProductLookupRow> = new Map();
    if (productIds.length > 0) {
      const { data: prods } = await supabase
        .from("products")
        .select("id, name")
        .in("id", productIds);
      products = new Map(((prods ?? []) as ProductLookupRow[]).map((p) => [p.id, p]));
    }
    const orderItems = itemsArr.map((item) => {
      const productId = item.grabItemID || item.id || "";
      const product = productId ? products.get(productId) : undefined;
      const qty = item.quantity ?? 1;
      const unitPrice = item.price ?? 0;
      const modTotal = (item.modifiers ?? []).reduce((n, m) => n + ((m.price ?? 0) * (m.quantity ?? 1)), 0);
      const itemTotal = (unitPrice + modTotal) * qty;
      // Real Grab orders carry our synced names + IDs. The simulator
      // sends empty names + random IDs — render price + ID hint so the
      // kitchen can still act.
      const grabIdHint = productId ? ` [${productId.slice(0, 8)}]` : "";
      const priceHint = unitPrice > 0 ? `Item @ RM ${(unitPrice / 100).toFixed(2)}${grabIdHint}` : `Item${grabIdHint}`;
      return {
        id: randomUUID(),
        order_id: order.id,
        product_id: productId || randomUUID(),
        product_name: item.name || product?.name || priceHint,
        quantity: qty,
        unit_price: unitPrice,
        modifiers: (item.modifiers ?? []).map((m) => ({
          name: m.name || (m.price ? `Add-on @ RM ${((m.price ?? 0) / 100).toFixed(2)}` : "Add-on"),
          price: m.price,
          qty: m.quantity,
        })),
        modifier_total: modTotal,
        discount_amount: 0,
        tax_amount: 0,
        item_total: itemTotal,
        notes: extractItemNote(item),
        kitchen_status: "pending",
        created_at: new Date().toISOString(),
      };
    });
    if (orderItems.length > 0) {
      const { error: itemsErr } = await supabase.from("pos_order_items").insert(orderItems);
      if (itemsErr) console.error("[grab:webhook] items insert failed:", itemsErr);
    }

    // 7. Payment.
    const { error: payErr } = await supabase.from("pos_order_payments").insert({
      id: randomUUID(),
      order_id: order.id,
      payment_method: payload.paymentType === "CASH" ? "cash" : "grabpay",
      amount: total,
      status: "paid",
      provider: "grabfood",
      provider_ref: orderID,
      refund_amount: 0,
      created_at: new Date().toISOString(),
    });
    if (payErr) console.error("[grab:webhook] payment insert failed:", payErr);

    console.log(`[grab:webhook] CREATED order=${order.id} external=${orderID} outlet=${outletId} total=${total}`);
    return NextResponse.json({
      success: true,
      action: "created",
      orderId: order.id,
      orderNumber: `GF-${payload.shortOrderNumber}`,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    const stack = err instanceof Error && err.stack ? err.stack.split("\n").slice(0, 4).join(" | ") : "";
    console.error(`[grab:webhook] EXCEPTION msg=${msg} stack=${stack}`);
    return NextResponse.json(
      { error: "Internal server error", debug: { msg, stack } },
      { status: 500 },
    );
  }
}

// Grab simulator sometimes uses PUT for Push Order State. Same handler.
export const PUT = POST;

// Grab may GET to verify reachability.
export async function GET() {
  return NextResponse.json({ status: "ok", service: "celsius-pos-grab-webhook" });
}
