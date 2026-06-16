/**
 * Manual "Sync menu to Grab" — outbound push (us → Grab).
 *
 * POST /api/pos/grab/sync   { merchantID }    (staff-auth)
 *
 * Builds the per-outlet menu (the SAME builder the get-menu webhook serves) and
 * PUTs it straight to Grab via updateMenu. We PUSH rather than notify: these
 * self-serve stores reject the notify→pull trigger — POST .../menu/notification
 * returns {"target":"UnsupportedMenuSync","reason":"invalid_argument"}. Pushing
 * makes GrabFood match backoffice on demand (corrected photos, hidden items,
 * price changes) instead of waiting on Grab.
 *
 * Per-outlet data (hours, 86 list) is read with the service-role key, same as the
 * inbound webhook; the route itself is staff-gated by requireAuth.
 */

import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { requireAuth } from "@/lib/auth";
import { updateMenu } from "@/lib/grab";
import { buildOutletGrabMenu } from "@/lib/grab-menu-outlet";

function serviceClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
  );
}

export async function POST(request: NextRequest) {
  const auth = await requireAuth(request);
  if (auth.error) return auth.error;

  // Outbound OAuth pair (same one self-serve uses). GRAB_MERCHANT_ID isn't needed
  // here — the store is passed per request, so we can sync any linked outlet.
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

  const menu = await buildOutletGrabMenu(serviceClient(), merchantID);
  if (!menu) {
    return NextResponse.json(
      { ok: false, error: "build_failed", error_description: "Could not build the menu for this outlet." },
      { status: 500 },
    );
  }

  try {
    const result = await updateMenu(menu);
    const items = menu.categories.reduce((n, c) => n + c.items.length, 0);
    return NextResponse.json({ ok: true, merchantID, categories: menu.categories.length, items, result });
  } catch (err) {
    return NextResponse.json(
      { ok: false, error: "sync_failed", error_description: err instanceof Error ? err.message : "Unknown error" },
      { status: 502 },
    );
  }
}
