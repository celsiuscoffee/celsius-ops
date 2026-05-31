/**
 * "PushGrabMenu" webhook (inbound — Grab → POS).
 *
 * POST /api/grab/menus
 *
 * During the self-serve store-activation journey, GrabFood pushes the store's
 * canonical menu (as it exists on Grab's side) to the partner. We just need to
 * accept and acknowledge it — our POS is the menu source of truth, so there's
 * nothing to persist yet; we log the shape for debugging during staging.
 *
 * Authenticated with the partner Bearer token Grab obtained from our
 * /api/grab/oauth/token endpoint. Register this URL in the portal
 * "Partner configuration → Push grab menu".
 */

import { NextRequest, NextResponse } from "next/server";
import { verifyGrabPartnerToken } from "@/lib/grab-partner";

export async function POST(request: NextRequest) {
  if (!(await verifyGrabPartnerToken(request))) {
    return NextResponse.json({ error: "invalid_token" }, { status: 401 });
  }

  let body: Record<string, unknown> = {};
  try {
    body = await request.json();
  } catch {
    /* tolerate empty / non-JSON body */
  }

  const merchantID = (body.merchantID || body.merchantId || "") as string;
  const categories = Array.isArray((body as { categories?: unknown[] }).categories)
    ? (body as { categories: unknown[] }).categories.length
    : undefined;
  console.log(
    `[grab:push-menu] received merchant=${merchantID}` +
      (categories !== undefined ? ` categories=${categories}` : ""),
  );

  // Ack — Grab retries on any non-2xx, so we only return non-200 on auth failure.
  return NextResponse.json({ success: true });
}

// Grab may GET to verify the URL is reachable before activation.
export async function GET() {
  return NextResponse.json({ status: "ok", service: "celsius-pos-grab-push-menu" });
}
