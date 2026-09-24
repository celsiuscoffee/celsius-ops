import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase/server";
import { isIpay88Checkout } from "@/lib/payments/checkout-query";
import {
  IPAY88_CHECKOUT_PREFIX,
  buildPaymentRequest,
  merchantForStore,
  paymentUrl,
  renderAutoSubmitPage,
} from "@/lib/ipay88/client";

export const dynamic = "force-dynamic";

/**
 * GET /api/payments/ipay88/pay?orderId=…&method=…&return=app|web
 *
 * The URL both clients open to pay an iPay88-routed order: the web checkout
 * redirects the browser here, the native app loads it in its payment modal.
 * iPay88 only accepts a signed form POST, so this renders a page that
 * auto-submits one. Everything signed (RefNo, amount, merchant) is read from
 * the order row, never from the query string, and the order must already
 * have been routed to iPay88 by /api/payments/create or /api/checkout/initiate.
 *
 * The middleware widens this route's CSP form-action to iPay88's host —
 * the site-wide policy only allows forms to post to 'self'.
 */
export async function GET(request: NextRequest) {
  const sp = request.nextUrl.searchParams;
  const orderId = sp.get("orderId") ?? "";
  const method = sp.get("method") ?? "";
  const target = sp.get("return") === "app" ? "app" : "web";
  const baseUrl = (process.env.NEXT_PUBLIC_BASE_URL || "https://order.celsiuscoffee.com").trim();

  if (!orderId) return new NextResponse("Missing orderId", { status: 400 });

  const { data } = await getSupabaseAdmin()
    .from("orders")
    .select("id, order_number, status, store_id, total, payment_method, payment_checkout_id, customer_name, customer_phone")
    .eq("id", orderId)
    .maybeSingle();
  const order = data as {
    id: string;
    order_number: string;
    status: string;
    store_id: string;
    total: number | null;
    payment_method: string | null;
    payment_checkout_id: string | null;
    customer_name: string | null;
    customer_phone: string | null;
  } | null;

  if (!order) return new NextResponse("Order not found", { status: 404 });

  // Already settled (double tap, back button, stale tab) — never open a
  // second payment; send the customer to wherever a finished payment goes.
  if (order.status !== "pending" && order.status !== "failed") {
    return NextResponse.redirect(
      target === "app" ? "celsiuscoffee://rm-return" : `${baseUrl}/order/${order.id}?payment=done`,
      303,
    );
  }
  if (!isIpay88Checkout(order.payment_checkout_id) || order.total == null || order.total <= 0) {
    return new NextResponse("This order isn't set up for iPay88 payment", { status: 409 });
  }
  const merchant = merchantForStore(order.store_id);
  if (!merchant) return new NextResponse("iPay88 is not configured for this outlet", { status: 503 });

  const refNo = order.payment_checkout_id!.slice(IPAY88_CHECKOUT_PREFIX.length);
  const fields = buildPaymentRequest({
    merchant,
    refNo,
    amountSen: order.total,
    methodId: method || order.payment_method || "",
    prodDesc: `Celsius Coffee order ${order.order_number}`,
    userName: order.customer_name?.trim() || "Celsius Customer",
    // orders carry no email; iPay88 requires one for its receipt field.
    userEmail: (process.env.IPAY88_DEFAULT_EMAIL || "orders@celsiuscoffee.com").trim(),
    userContact: order.customer_phone?.trim() || "0000000000",
    remark: order.id,
    responseUrl: `${baseUrl}/api/payments/ipay88/callback/${target}`,
    backendUrl: `${baseUrl}/api/payments/ipay88/webhook`,
  });

  return new NextResponse(renderAutoSubmitPage(paymentUrl(), fields), {
    status: 200,
    headers: { "Content-Type": "text/html; charset=utf-8" },
  });
}
