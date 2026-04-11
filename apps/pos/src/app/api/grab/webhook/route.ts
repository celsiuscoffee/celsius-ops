/**
 * Grab Webhook Receiver
 *
 * Grab sends order notifications here when:
 * - New order placed (state: PENDING/DRIVER_ALLOCATED)
 * - Order cancelled by customer/Grab
 * - Order state changes
 *
 * Webhook payload reference: Grab Partner API v1.1.3
 */

import { NextRequest, NextResponse } from "next/server";
import { verifyWebhookSignature } from "@/lib/grab";
import { createClient } from "@/lib/supabase-server";

interface GrabOrderItem {
  id: string;
  grabItemID: string;
  name: string;
  quantity: number;
  price: number; // in minor unit (sen)
  modifiers?: Array<{
    id: string;
    name: string;
    quantity: number;
    price: number;
  }>;
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
  completeTime?: string;
  scheduledTime?: string;
  orderState:
    | "PENDING"
    | "ACCEPTED"
    | "DRIVER_ALLOCATED"
    | "DRIVER_ARRIVED"
    | "COLLECTED"
    | "DELIVERED"
    | "CANCELLED"
    | "FAILED";
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
    merchantChargeFee?: number;
    grabFundPromo?: number;
    merchantFundPromo?: number;
  };
  orderType: "DELIVERY" | "PICKUP" | "DINE_IN";
  cutlery?: boolean;
  membershipID?: string;
}

function mapGrabStatusToPOS(
  state: GrabWebhookPayload["orderState"],
): string {
  switch (state) {
    case "PENDING":
    case "DRIVER_ALLOCATED":
      return "open";
    case "ACCEPTED":
      return "sent_to_kitchen";
    case "DRIVER_ARRIVED":
      return "ready";
    case "COLLECTED":
    case "DELIVERED":
      return "completed";
    case "CANCELLED":
    case "FAILED":
      return "cancelled";
    default:
      return "open";
  }
}

export async function POST(request: NextRequest) {
  try {
    const rawBody = await request.text();

    // Verify webhook signature
    const signature = request.headers.get("x-grab-signature") || "";
    if (process.env.GRAB_CLIENT_SECRET && !verifyWebhookSignature(rawBody, signature)) {
      return NextResponse.json({ error: "Invalid signature" }, { status: 401 });
    }

    const payload: GrabWebhookPayload = JSON.parse(rawBody);
    const { orderID, orderState, merchantID } = payload;

    const supabase = await createClient();

    // Check if order already exists (status update)
    const { data: existing } = await supabase
      .from("pos_orders")
      .select("id, status")
      .eq("external_id", orderID)
      .single();

    if (existing) {
      // Update existing order status
      const newStatus = mapGrabStatusToPOS(orderState);
      if (existing.status !== newStatus) {
        await supabase
          .from("pos_orders")
          .update({
            status: newStatus,
            updated_at: new Date().toISOString(),
          })
          .eq("id", existing.id);
      }

      return NextResponse.json({ success: true, action: "updated", orderId: existing.id });
    }

    // New order — only create for PENDING/DRIVER_ALLOCATED states
    if (orderState !== "PENDING" && orderState !== "DRIVER_ALLOCATED" && orderState !== "ACCEPTED") {
      return NextResponse.json({ success: true, action: "skipped" });
    }

    // Resolve outlet from merchant ID
    const { data: outlet } = await supabase
      .from("outlets")
      .select("id, name")
      .or(`grab_merchant_id.eq.${merchantID},storehub_id.eq.${payload.partnerMerchantID || ""}`)
      .single();

    const outletId = outlet?.id || process.env.DEFAULT_OUTLET_ID || "";
    const outletName = outlet?.name || "Celsius Coffee";

    // Calculate totals (already in sen)
    const subtotal = payload.orderPrice.subtotal;
    const total = payload.orderPrice.eaterPayment;
    const discount =
      (payload.orderPrice.grabFundPromo || 0) +
      (payload.orderPrice.merchantFundPromo || 0);

    // Create POS order
    const { data: order, error: orderErr } = await supabase
      .from("pos_orders")
      .insert({
        external_id: orderID,
        order_number: `GF-${payload.shortOrderNumber}`,
        outlet_id: outletId,
        outlet_name: outletName,
        type: payload.orderType === "DINE_IN" ? "dine_in" : "takeaway",
        status: "sent_to_kitchen",
        subtotal,
        discount,
        total,
        platform: "grabfood",
        customer_name: payload.receiver?.name || "Grab Customer",
        customer_phone: payload.receiver?.phones?.[0] || null,
        delivery_notes: payload.receiver?.address?.deliveryInstruction || null,
        payment_method: payload.paymentType === "CASH" ? "cash" : "grabpay",
        created_at: payload.orderTime || new Date().toISOString(),
      })
      .select("id")
      .single();

    if (orderErr || !order) {
      console.error("Failed to create Grab order:", orderErr);
      return NextResponse.json(
        { error: "Failed to create order" },
        { status: 500 },
      );
    }

    // Create order items
    const orderItems = payload.items.map((item) => ({
      order_id: order.id,
      product_name: item.name,
      external_item_id: item.grabItemID || item.id,
      quantity: item.quantity,
      unit_price: item.price,
      total_price: item.price * item.quantity,
      modifiers: item.modifiers
        ? item.modifiers.map((m) => ({ name: m.name, price: m.price, qty: m.quantity }))
        : [],
      notes: item.comment || null,
      kitchen_status: "pending",
    }));

    await supabase.from("pos_order_items").insert(orderItems);

    // Auto-create payment record
    await supabase.from("pos_order_payments").insert({
      order_id: order.id,
      method: payload.paymentType === "CASH" ? "cash" : "grabpay",
      amount: total,
      status: "paid",
      provider: "grabfood",
      provider_ref: orderID,
    });

    return NextResponse.json({
      success: true,
      action: "created",
      orderId: order.id,
      orderNumber: `GF-${payload.shortOrderNumber}`,
    });
  } catch (err) {
    console.error("Grab webhook error:", err);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 },
    );
  }
}

// Grab may send GET to verify webhook URL is accessible
export async function GET() {
  return NextResponse.json({ status: "ok", service: "celsius-pos-grab-webhook" });
}
