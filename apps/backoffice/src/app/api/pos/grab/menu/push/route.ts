/**
 * Per-outlet full-menu SYNC (us → Grab) via the menu-update NOTIFICATION.
 *
 * POST /api/pos/grab/menu/push   { merchantID }   (staff-auth)
 *
 * GrabFood has NO "replace the whole menu" push endpoint. The full menu is
 * delivered by Grab PULLING our get-menu webhook (/api/pos/grab/merchant/menu),
 * which already serves the catalogue keyed by OUR product ids. To refresh it we
 * call the menu-update notification (POST /partner/v1/merchant/menu/notification)
 * — Grab then re-pulls our webhook. This is how StoreHub "pushes" a menu.
 *
 * (The earlier PUT /partner/v1/menu attempt failed with "invalid_argument:
 * Invalid parameters!" because that endpoint is Grab's Update Menu RECORD API —
 * a single item/modifier by id — not a full-menu body.)
 *
 * Outcome surfaced verbatim:
 *   - ok               → Grab accepted the sync; it will re-pull our menu and
 *                        adopt our item ids (orders then match the catalogue,
 *                        no per-item linking needed).
 *   - "UnsupportedMenuSync" → this outlet is still MERCHANT-managed (self-serve)
 *                        on Grab's side. Grab must switch it to partner/
 *                        integration-managed menu mode (onboarding step) before
 *                        a sync is accepted — the same mode StoreHub stores use.
 */

import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { requireAuth } from "@/lib/auth";
import { notifyMenuUpdate } from "@/lib/grab";
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
    /* tolerate empty body */
  }
  const merchantID = String(body.merchantID ?? "").trim();
  if (!merchantID) {
    return NextResponse.json(
      { ok: false, error: "invalid_request", error_description: "merchantID is required" },
      { status: 400 },
    );
  }

  // Sanity-check that our get-menu webhook will serve a non-empty menu for this
  // outlet (we don't send it here — Grab pulls it — but an empty pull is pointless).
  const menu = await buildOutletGrabMenu(serviceClient(), merchantID);
  const itemsCount = menu ? menu.categories.reduce((n, c) => n + c.items.length, 0) : 0;
  if (!menu || itemsCount === 0) {
    return NextResponse.json(
      { ok: false, error: "empty_menu", error_description: "No Grab-visible items to serve for this outlet." },
      { status: 400 },
    );
  }

  try {
    const result = await notifyMenuUpdate(merchantID);
    return NextResponse.json({
      ok: true,
      merchantID,
      categories: menu.categories.length,
      items: itemsCount,
      result,
    });
  } catch (err) {
    // Surface Grab's exact message (e.g. "UnsupportedMenuSync") verbatim.
    return NextResponse.json(
      { ok: false, error: "notify_failed", error_description: err instanceof Error ? err.message : "Unknown error" },
      { status: 502 },
    );
  }
}
