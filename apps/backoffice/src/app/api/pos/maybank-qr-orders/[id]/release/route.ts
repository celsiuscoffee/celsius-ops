import { NextRequest, NextResponse } from "next/server";
import { createServiceToken } from "@celsius/auth";
import { requireAuth } from "@/lib/auth";

const ORDER_APP_BASE = (
  process.env.ORDER_APP_BASE_URL ?? "https://order.celsiuscoffee.com"
).replace(/\/$/, "");

/**
 * POST /api/pos/maybank-qr-orders/[id]/release
 *
 * Staff confirms the Maybank transfer landed and releases the order
 * to the kitchen. The actual side-effects (atomic status flip + loyalty
 * earn/deduct + V2 hooks + brewing-now push) live in apps/order at
 * /api/orders/[id]/confirm-maybank-qr so Maybank-QR customers earn
 * points on parity with gateway-paid customers — see
 * apps/order/src/app/api/orders/[orderId]/confirm-stripe for the
 * matching reference path.
 *
 * This route just authenticates the staff click in backoffice and
 * forwards to the order app with a short-lived scoped service token
 * (signed with the JWT_SECRET both apps share). The service-role key
 * must never transit in headers — one proxy log or Sentry breadcrumb
 * away from a full database compromise.
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const auth = await requireAuth(request);
  if (auth.error) return auth.error;

  const { id } = await params;
  if (!id) return NextResponse.json({ error: "Missing order id" }, { status: 400 });

  try {
    const serviceToken = await createServiceToken("order.confirm-maybank-qr");
    const res = await fetch(
      `${ORDER_APP_BASE}/api/orders/${encodeURIComponent(id)}/confirm-maybank-qr`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${serviceToken}`,
          Origin: ORDER_APP_BASE,
          Referer: ORDER_APP_BASE + "/",
        },
        body: "{}",
      },
    );
    const text = await res.text();
    const json = (text ? safeJson(text) : {}) as Record<string, unknown>;
    if (!res.ok) {
      return NextResponse.json(
        { error: (json.error as string | undefined) ?? `HTTP ${res.status}` },
        { status: res.status },
      );
    }
    return NextResponse.json({ ok: true, ...json });
  } catch (e) {
    console.error("[maybank-qr release] forward failed", e);
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Forward to order app failed" },
      { status: 502 },
    );
  }
}

function safeJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return {};
  }
}

