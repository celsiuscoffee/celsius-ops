/**
 * "Get menu" webhook (inbound — Grab → POS).
 *
 * GET /api/grab/merchant/menu
 *
 * GrabFood calls this to pull our latest menu (e.g. during self-serve store
 * activation). Grab presents the partner Bearer token it obtained from our
 * /api/grab/oauth/token endpoint, so we gate on verifyGrabPartnerToken (NOT the
 * staff requireAuth used by the outbound routes).
 *
 * The per-outlet menu is built by lib/grab-menu-outlet (shared with the outbound
 * "sync menu" push at api/pos/grab/sync), so a pull and a push serve identical
 * menus. We read with the service-role key (products are behind RLS) since an
 * inbound webhook has no user session — mirrors lib/loyalty-snapshot.
 *
 * Register this URL in the GrabFood portal "Partner configuration → Get menu".
 */

import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { verifyGrabPartnerToken } from "@/lib/grab-partner";
import { buildOutletGrabMenu } from "@/lib/grab-menu-outlet";

function serviceClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
  );
}

export async function GET(request: NextRequest) {
  if (!(await verifyGrabPartnerToken(request))) {
    return NextResponse.json({ error: "invalid_token" }, { status: 401 });
  }

  // Grab passes the outlet it wants the menu for; fall back to our configured
  // merchant ID so the endpoint still works during early staging probes.
  const merchantId =
    request.nextUrl.searchParams.get("merchantID") ||
    request.nextUrl.searchParams.get("merchantId") ||
    process.env.GRAB_MERCHANT_ID ||
    "";

  const menu = await buildOutletGrabMenu(serviceClient(), merchantId);
  if (!menu) {
    return NextResponse.json({ error: "Failed to fetch products" }, { status: 500 });
  }

  console.log(
    `[grab:get-menu] served menu merchant=${merchantId} sellingTimes=${menu.sellingTimes.length} categories=${menu.categories.length}`,
  );
  return NextResponse.json(menu);
}
