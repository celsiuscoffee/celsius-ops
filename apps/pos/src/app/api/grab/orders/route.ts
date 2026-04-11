/**
 * Grab Order Actions API
 *
 * POST /api/grab/orders — Accept, reject, mark ready, cancel orders on Grab
 *
 * Body: { action: "accept"|"reject"|"ready"|"cancel", orderID: "...", rejectCode?: "...", cancelCode?: "..." }
 */

import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth";
import {
  isGrabConfigured,
  acceptRejectOrder,
  markOrderReady,
  cancelOrder,
  checkOrderCancelable,
  updateOrderReadyTime,
  listOrders,
} from "@/lib/grab";

type OrderAction = "accept" | "reject" | "ready" | "cancel" | "update_ready_time" | "check_cancelable" | "list";

export async function POST(request: NextRequest) {
  const auth = await requireAuth(request);
  if (auth.error) return auth.error;

  if (!isGrabConfigured()) {
    return NextResponse.json(
      { error: "Grab not configured" },
      { status: 400 },
    );
  }

  const body = await request.json();
  const action: OrderAction = body.action;
  const orderID: string = body.orderID;
  const merchantId = process.env.GRAB_MERCHANT_ID!;

  if (!action) {
    return NextResponse.json(
      { error: "action required: accept, reject, ready, cancel, update_ready_time, check_cancelable, list" },
      { status: 400 },
    );
  }

  try {
    switch (action) {
      case "accept": {
        if (!orderID) return NextResponse.json({ error: "orderID required" }, { status: 400 });
        const result = await acceptRejectOrder(orderID, "ACCEPTED");
        return NextResponse.json({ success: true, action: "accepted", result });
      }

      case "reject": {
        if (!orderID) return NextResponse.json({ error: "orderID required" }, { status: 400 });
        const result = await acceptRejectOrder(orderID, "REJECTED", body.rejectCode);
        return NextResponse.json({ success: true, action: "rejected", result });
      }

      case "ready": {
        if (!orderID) return NextResponse.json({ error: "orderID required" }, { status: 400 });
        const result = await markOrderReady(orderID);
        return NextResponse.json({ success: true, action: "marked_ready", result });
      }

      case "cancel": {
        if (!orderID) return NextResponse.json({ error: "orderID required" }, { status: 400 });
        if (!body.cancelCode) return NextResponse.json({ error: "cancelCode required" }, { status: 400 });
        const result = await cancelOrder(orderID, merchantId, body.cancelCode);
        return NextResponse.json({ success: true, action: "cancelled", result });
      }

      case "update_ready_time": {
        if (!orderID) return NextResponse.json({ error: "orderID required" }, { status: 400 });
        if (!body.readyTime) return NextResponse.json({ error: "readyTime (ISO 8601) required" }, { status: 400 });
        const result = await updateOrderReadyTime(orderID, body.readyTime);
        return NextResponse.json({ success: true, action: "ready_time_updated", result });
      }

      case "check_cancelable": {
        if (!orderID) return NextResponse.json({ error: "orderID required" }, { status: 400 });
        const result = await checkOrderCancelable(orderID);
        return NextResponse.json({ success: true, ...result });
      }

      case "list": {
        const result = await listOrders(merchantId, {
          page: body.page,
          pageSize: body.pageSize,
          date: body.date,
        });
        return NextResponse.json({ success: true, orders: result });
      }

      default:
        return NextResponse.json(
          { error: `Unknown action: ${action}` },
          { status: 400 },
        );
    }
  } catch (err) {
    console.error(`Grab order action '${action}' failed:`, err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Unknown error" },
      { status: 500 },
    );
  }
}
