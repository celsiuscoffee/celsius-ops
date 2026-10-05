import { NextRequest, NextResponse } from "next/server";
import { parseResponse } from "@/lib/ipay88/client";
import { settleIpay88Response } from "@/lib/ipay88/settle";

/**
 * iPay88 ResponseURL — the customer's browser posts the signed result here
 * when they finish (paid, failed or cancelled) on iPay88's page.
 *
 *   /callback/web → settle, then 303 to the web order tracking page
 *   /callback/app → settle, then 303 to celsiuscoffee://rm-return, which the
 *                   native payment modal (or the system browser session)
 *                   intercepts to close itself
 *
 * Settling here means the order has usually flipped before the customer's
 * screen loads, without waiting on the BackendURL post or a poll. The path
 * matches the CSRF middleware's /callback exemption (iPay88's page is a
 * different origin).
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ target: string }> },
) {
  const { target } = await params;
  const baseUrl = (process.env.NEXT_PUBLIC_BASE_URL || "https://order.celsiuscoffee.com").trim();

  let orderId: string | null = null;
  try {
    const form = await request.formData();
    const result = await settleIpay88Response(parseResponse(form));
    orderId = result.orderId;
  } catch (err) {
    console.error("[ipay88 callback] error:", err);
  }

  if (target === "app") return NextResponse.redirect("celsiuscoffee://rm-return", 303);
  return NextResponse.redirect(orderId ? `${baseUrl}/order/${orderId}?payment=done` : `${baseUrl}/orders`, 303);
}
