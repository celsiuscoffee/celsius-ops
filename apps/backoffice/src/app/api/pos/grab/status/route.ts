/**
 * "MerchantIntegrationStatus" webhook (inbound — Grab → POS).
 *
 * POST /api/grab/status
 *
 * GrabFood pushes the store's integration status during/after the self-serve
 * store-activation journey. Status is one of INACTIVE / ACTIVE / SYNCING /
 * FAILED. For now we log + acknowledge (the POS doesn't yet surface Grab's
 * integration state in BackOffice — that's a separate task with its own column).
 *
 * Authenticated with the partner Bearer token Grab obtained from our
 * /api/grab/oauth/token endpoint. Register this URL in the portal
 * "Partner configuration → Integration status".
 */

import { NextRequest, NextResponse } from "next/server";
import { verifyGrabPartnerToken } from "@/lib/grab-partner";

type IntegrationStatus = "INACTIVE" | "ACTIVE" | "SYNCING" | "FAILED";

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
  const partnerMerchantID = (body.partnerMerchantID || body.partnerMerchantId || "") as string;
  const status = (body.status || body.integrationStatus || "") as IntegrationStatus | "";
  console.log(
    `[grab:integration-status] merchant=${merchantID} partnerMerchant=${partnerMerchantID} status=${status}`,
  );

  // Ack — Grab retries on any non-2xx, so we only return non-200 on auth failure.
  return NextResponse.json({ success: true });
}

export async function GET() {
  return NextResponse.json({ status: "ok", service: "celsius-pos-grab-integration-status" });
}
