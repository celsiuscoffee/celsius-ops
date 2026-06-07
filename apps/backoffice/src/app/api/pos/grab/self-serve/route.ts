/**
 * Create a GrabFood Self-Serve Activation journey for an outlet.
 *
 * POST /api/pos/grab/self-serve   { merchantID }    (staff-auth)
 *   -> { ok, merchantID, activationUrl }
 *
 * Admin-triggered OUTBOUND call (us -> Grab). The returned activationUrl is the
 * link the store owner opens to self-link their existing GrabFood store to this
 * POS integration; Grab then pushes the store menu (/api/pos/grab/merchant/menu)
 * and integration status (/api/pos/grab/status) to our inbound webhooks.
 *
 * We pass the OUTLET ID as partner.merchantID so the link round-trips to the
 * right outlet — Grab returns it as partnerMerchantID and the order webhook
 * already resolves outlet by "Partner store ID = POS outlet id".
 *
 * Same-origin admin POST → passes middleware CSRF (it carries a browser Origin,
 * unlike the inbound Grab webhooks that are CSRF-exempt). Gated by requireAuth.
 */

import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth";
import { createSelfServeJourney } from "@/lib/grab";

export async function POST(request: NextRequest) {
  const auth = await requireAuth(request);
  if (auth.error) return auth.error;

  // Self-serve only needs the OAuth pair — NOT GRAB_MERCHANT_ID. Its whole
  // purpose is onboarding stores you don't have a merchant id for yet, so gate
  // on the credentials like /health does, not on isGrabConfigured().
  if (!process.env.GRAB_CLIENT_ID || !process.env.GRAB_CLIENT_SECRET) {
    return NextResponse.json(
      { ok: false, error: "missing_credentials", error_description: "Set GRAB_CLIENT_ID and GRAB_CLIENT_SECRET." },
      { status: 400 },
    );
  }

  let body: Record<string, unknown> = {};
  try {
    body = await request.json();
  } catch {
    /* tolerate empty / non-JSON body */
  }

  const merchantID = String(body.merchantID ?? "").trim();
  if (!merchantID) {
    return NextResponse.json(
      { ok: false, error: "invalid_request", error_description: "merchantID is required" },
      { status: 400 },
    );
  }

  try {
    const res = await createSelfServeJourney(merchantID);
    if (!res?.activationUrl) {
      return NextResponse.json(
        { ok: false, error: "no_activation_url", error_description: "Grab returned no activationUrl", raw: res },
        { status: 502 },
      );
    }
    return NextResponse.json({ ok: true, merchantID, activationUrl: res.activationUrl });
  } catch (err) {
    return NextResponse.json(
      { ok: false, error: "self_serve_failed", error_description: err instanceof Error ? err.message : "Unknown error" },
      { status: 502 },
    );
  }
}
