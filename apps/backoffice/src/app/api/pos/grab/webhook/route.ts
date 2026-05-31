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
import { randomUUID, createHmac } from "crypto";
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

function hmac(algo: "sha256" | "sha1" | "sha512", secret: string, body: string, enc: "hex" | "base64") {
  return createHmac(algo, secret).update(body).digest(enc);
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
      // DIAGNOSTIC: one short console.error per field (avoid Vercel log truncation)
      // AND echo into the 401 response so we can read it without log access.
      const interestingHeaders: Record<string, string> = {};
      request.headers.forEach((v, k) => {
        if (/sign|grab|auth|time|nonce|date|version/i.test(k)) interestingHeaders[k] = v;
      });
      const secA = process.env.GRAB_HMAC_SECRET || "";
      const secB = process.env.GRAB_CLIENT_SECRET || "";
      const candidates = {
        hmac_secret_len: secA.length,
        client_secret_len: secB.length,
        sha256_hex_HMAC:    hmac("sha256", secA, rawBody, "hex"),
        sha256_b64_HMAC:    hmac("sha256", secA, rawBody, "base64"),
        sha1_hex_HMAC:      hmac("sha1",   secA, rawBody, "hex"),
        sha512_hex_HMAC:    hmac("sha512", secA, rawBody, "hex"),
        sha256_hex_CLIENT:  hmac("sha256", secB, rawBody, "hex"),
        sha256_b64_CLIENT:  hmac("sha256", secB, rawBody, "base64"),
      };
      // emit each as its own log line
      console.error(`[grab:DBG] incoming_sig=${signature}`);
      console.error(`[grab:DBG] incoming_sig_len=${signature.length}`);
      console.error(`[grab:DBG] body_len=${rawBody.length}`);
      console.error(`[grab:DBG] body_head=${rawBody.slice(0, 300)}`);
      for (const [k, v] of Object.entries(interestingHeaders)) {
        console.error(`[grab:DBG] hdr:${k}=${v}`);
      }
      for (const [k, v] of Object.entries(candidates)) {
        console.error(`[grab:DBG] cand:${k}=${v}`);
      }
      return NextResponse.json(
        { error: "Invalid signature", debug: { incoming_sig: signature, sig_len: signature.length, body_len: rawBody.length, body_head: rawBody.slice(0, 300), headers: interestingHeaders, candidates } },
        { status: 401 },
      );
    }

    const payload: GrabWebhookPayload = JSON.parse(rawBody);
    const { orderID, orderState, merchantID } = payload;
    const supabase = await createClient();

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
      return NextResponse.json({ success: true, action: "updated", orderId: existing.id });
    }

    // 2. New order — only create for states that mean "Grab is sending this to us".
    if (orderState !== "PENDING" && orderState !== "DRIVER_ALLOCATED" && orderState !== "ACCEPTED") {
      return NextResponse.json({ success: true, action: "skipped" });
    }

    // 3. Resolve outlet (grab_merchant_id primary, storehub_store_id fallback).
    const { data: outlet } = await supabase
      .from("outlets").select("id")
      .or(`grab_merchant_id.eq.${merchantID},storehub_store_id.eq.${payload.partnerMerchantID || ""}`)
      .maybeSingle();
    const outletId = outlet?.id || process.env.DEFAULT_OUTLET_ID || "";
    if (!outletId) {
      console.error(`[grab:webhook] no outlet linked for merchantID=${merchantID}`);
      return NextResponse.json(
        { error: "No outlet linked. Set outlets.grab_merchant_id in BackOffice → Integrations → GrabFood." },
        { status: 400 },
      );
    }

    // 4. Totals (already in sen from Grab).
    const subtotal = payload.orderPrice.subtotal;
    const sst = payload.orderPrice.tax || 0;
    const total = payload.orderPrice.eaterPayment;
    const discount = (payload.orderPrice.grabFundPromo || 0) + (payload.orderPrice.merchantFundPromo || 0);
    const orderType =
      payload.orderType === "DINE_IN" ? "dine_in" :
      payload.orderType === "PICKUP" ? "pickup" : "takeaway";

    // 5. Insert order (schema-matched).
    const { data: order, error: orderErr } = await supabase
      .from("pos_orders")
      .insert({
        external_id: orderID,
        order_number: `GF-${payload.shortOrderNumber}`,
        outlet_id: outletId,
        source: "grabfood",
        order_type: orderType,
        status: "sent_to_kitchen",
        subtotal, sst_amount: sst, discount_amount: discount, total,
        customer_name: payload.receiver?.name || "Grab Customer",
        customer_phone: payload.receiver?.phones?.[0] || null,
        notes: payload.receiver?.address?.deliveryInstruction || null,
      })
      .select("id").single();
    if (orderErr || !order) {
      console.error("[grab:webhook] insert pos_orders failed:", orderErr);
      return NextResponse.json(
        { error: `Failed to create order: ${orderErr?.message || "unknown"}` },
        { status: 500 },
      );
    }

    // 6. Items.
    const orderItems = payload.items.map((item) => {
      const modTotal = (item.modifiers || []).reduce((n, m) => n + (m.price || 0) * (m.quantity || 1), 0);
      const itemTotal = (item.price + modTotal) * item.quantity;
      return {
        id: randomUUID(),
        order_id: order.id,
        product_id: item.grabItemID || item.id || randomUUID(),
        product_name: item.name,
        quantity: item.quantity,
        unit_price: item.price,
        modifiers: (item.modifiers || []).map((m) => ({ name: m.name, price: m.price, qty: m.quantity })),
        modifier_total: modTotal,
        discount_amount: 0,
        tax_amount: 0,
        item_total: itemTotal,
        notes: item.comment || null,
        kitchen_status: "pending",
        created_at: new Date().toISOString(),
      };
    });
    const { error: itemsErr } = await supabase.from("pos_order_items").insert(orderItems);
    if (itemsErr) console.error("[grab:webhook] items insert failed:", itemsErr);

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
    console.error("Grab webhook error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

// Grab simulator sometimes uses PUT for Push Order State. Same handler.
export const PUT = POST;

// Grab may GET to verify reachability.
export async function GET() {
  return NextResponse.json({ status: "ok", service: "celsius-pos-grab-webhook" });
}
