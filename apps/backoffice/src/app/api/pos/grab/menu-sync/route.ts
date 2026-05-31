/**
 * "Menu sync" webhook (inbound — Grab → POS).
 *
 * POST /api/grab/menu-sync
 *
 * After we notify Grab of a menu change (outbound notifyMenuUpdate), GrabFood
 * sends the result of the sync back through this webhook — success, or a failure
 * with the offending items/errors. We log + acknowledge; the authoritative
 * result can also be pulled on demand via the outbound traceMenuSync call.
 *
 * Authenticated with the partner Bearer token Grab obtained from our
 * /api/grab/oauth/token endpoint. Register this URL in the portal
 * "Partner configuration → Menu sync".
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
  const status = (body.status || body.syncStatus || "") as string;
  const errors = (body.errors || body.errorMessage) as unknown;
  console.log(
    `[grab:menu-sync] merchant=${merchantID} status=${status}` +
      (errors ? ` errors=${JSON.stringify(errors).slice(0, 500)}` : ""),
  );

  // Ack — Grab retries on any non-2xx, so we only return non-200 on auth failure.
  return NextResponse.json({ success: true });
}

export async function GET() {
  return NextResponse.json({ status: "ok", service: "celsius-pos-grab-menu-sync" });
}
