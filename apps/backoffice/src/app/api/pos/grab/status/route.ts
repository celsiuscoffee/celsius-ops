/**
 * "MerchantIntegrationStatus" webhook (inbound — Grab → POS).
 *
 * POST /api/grab/status
 *
 * GrabFood pushes the store's integration status during/after the self-serve
 * store-activation journey (INACTIVE / ACTIVE / SYNCING / FAILED). We persist it
 * onto the outlet so BackOffice can surface "connected / syncing / failed" per
 * store (see /settings/integrations/grab), then acknowledge.
 *
 * Authenticated with the partner Bearer token Grab obtained from our
 * /api/grab/oauth/token endpoint. Register this URL in the portal
 * "Partner configuration → Integration status".
 */

import { NextRequest, NextResponse } from "next/server";
import { verifyGrabPartnerToken } from "@/lib/grab-partner";
import { prisma } from "@/lib/prisma";
import { Prisma } from "@prisma/client";

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

  // Spec field is `grabMerchantID` (+ `partnerMerchantID` + `integrationStatus`);
  // tolerate the older `merchantID` / `status` aliases too.
  const grabMerchantID = (body.grabMerchantID || body.merchantID || body.merchantId || "") as string;
  const partnerMerchantID = (body.partnerMerchantID || body.partnerMerchantId || "") as string;
  const status = (body.integrationStatus || body.status || "") as IntegrationStatus | "";
  console.log(
    `[grab:integration-status] grabMerchant=${grabMerchantID} partnerMerchant=${partnerMerchantID} status=${status}`,
  );

  // Persist onto the outlet. Resolve by the partner store id (= Outlet.loyaltyOutletId,
  // what we send on self-serve) or the Grab store id. Best-effort — never fail the
  // ack on a write error (Grab retries on any non-2xx).
  if (status && (partnerMerchantID || grabMerchantID)) {
    try {
      await prisma.$executeRaw(Prisma.sql`
        UPDATE "Outlet"
        SET "grabIntegrationStatus" = ${status}, "grabIntegrationStatusAt" = NOW()
        WHERE "loyaltyOutletId" = ${partnerMerchantID || null}
           OR "grabMerchantId"  = ${grabMerchantID || null}
      `);
    } catch (err) {
      console.warn("[grab:integration-status] persist skipped:", err);
    }
  }

  // Ack — Grab retries on any non-2xx, so we only return non-200 on auth failure.
  return NextResponse.json({ success: true });
}

export async function GET() {
  return NextResponse.json({ status: "ok", service: "celsius-pos-grab-integration-status" });
}
