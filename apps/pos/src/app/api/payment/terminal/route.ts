import { NextRequest, NextResponse } from "next/server";
import {
  initiateTerminalPayment,
  isRMConfigured,
  getRMConfig,
  type RMPaymentType,
} from "@/lib/revenue-monster";

/**
 * POST /api/payment/terminal
 *
 * Initiate a payment on the Revenue Monster terminal.
 * The POS calls this, which pushes the payment to the physical terminal.
 *
 * Body: { orderId, orderTitle, amount (sen), type: "E-WALLET"|"RETAIL-QR"|"CARD" }
 */
export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { orderId, orderTitle, amount, type } = body;

    if (!orderId || !amount || !type) {
      return NextResponse.json(
        { error: "Missing required fields: orderId, amount, type" },
        { status: 400 }
      );
    }

    // Validate type
    const validTypes: RMPaymentType[] = ["E-WALLET", "RETAIL-QR", "CARD"];
    if (!validTypes.includes(type)) {
      return NextResponse.json(
        { error: `Invalid type. Must be one of: ${validTypes.join(", ")}` },
        { status: 400 }
      );
    }

    // Check if RM is configured
    if (!isRMConfigured()) {
      // Fallback: simulate payment for development/testing
      console.warn("[PAYMENT] Revenue Monster not configured, simulating payment");
      await new Promise((resolve) => setTimeout(resolve, 1500));
      return NextResponse.json({
        code: "SUCCESS",
        simulated: true,
        item: {
          transactionId: `SIM-${Date.now()}`,
          order: { id: orderId, title: orderTitle || "Order", amount },
          status: "SUCCESS",
          paymentMethod: type,
        },
      });
    }

    // Real RM terminal payment
    const result = await initiateTerminalPayment({
      orderId,
      orderTitle: orderTitle || "Celsius Coffee",
      amount: Math.round(amount), // ensure integer (sen)
      type,
    });

    return NextResponse.json(result);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Payment failed";
    console.error("[PAYMENT] Terminal error:", message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

/**
 * GET /api/payment/terminal
 *
 * Check RM terminal configuration status.
 */
export async function GET() {
  return NextResponse.json(getRMConfig());
}
