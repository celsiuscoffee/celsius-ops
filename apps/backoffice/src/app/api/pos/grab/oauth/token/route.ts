/**
 * Partner OAuth token endpoint (Grab → POS direction).
 *
 * Register this URL in the GrabFood portal "Partner configuration → OAuth token
 * endpoint". Grab calls it with the Partner client ID/secret set in that page
 * (mirrored here as GRAB_PARTNER_CLIENT_ID / GRAB_PARTNER_CLIENT_SECRET) to get a
 * Bearer token, which it then presents on our inbound webhooks (submit order,
 * push order state, get menu, push grab menu, integration status).
 *
 * This is the "Get partner access token" webhook from Grab's API deck — issued
 * BY us; the reverse of lib/grab.ts getAccessToken (token FROM Grab for outbound).
 */

import { NextRequest, NextResponse } from "next/server";
import {
  partnerConfigured,
  partnerCredsMatch,
  issuePartnerToken,
  PARTNER_TOKEN_TTL_SECONDS,
} from "@/lib/grab-partner";

export async function POST(req: NextRequest) {
  if (!partnerConfigured()) {
    return NextResponse.json(
      { error: "server_error", error_description: "partner credentials not configured" },
      { status: 500 },
    );
  }

  // Accept JSON or form-encoded bodies (OAuth clients vary).
  let body: Record<string, unknown> = {};
  try {
    const ct = req.headers.get("content-type") || "";
    if (ct.includes("application/json")) {
      body = await req.json();
    } else {
      const form = await req.formData();
      body = Object.fromEntries(Array.from(form.entries()).map(([k, v]) => [k, String(v)]));
    }
  } catch {
    /* fall through to invalid_request */
  }

  const { client_id: clientId, client_secret: clientSecret, scope } = body;

  if (!clientId || !clientSecret) {
    return NextResponse.json(
      { error: "invalid_request", error_description: "client_id and client_secret required" },
      { status: 400 },
    );
  }
  if (!partnerCredsMatch(clientId, clientSecret)) {
    return NextResponse.json({ error: "invalid_client" }, { status: 401 });
  }

  const accessToken = await issuePartnerToken(String(clientId), String(scope ?? ""));
  return NextResponse.json({
    access_token: accessToken,
    token_type: "Bearer",
    expires_in: PARTNER_TOKEN_TTL_SECONDS,
  });
}
