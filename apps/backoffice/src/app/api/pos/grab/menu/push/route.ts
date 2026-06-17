/**
 * Per-outlet FULL-MENU push (us → Grab) — replaces the outlet's entire GrabFood
 * menu with our catalogue (PUT /partner/v1/menu), then notifies Grab to re-pull.
 *
 * POST /api/pos/grab/menu/push   { merchantID }   (staff-auth)
 *
 * Why this exists separately from /api/pos/grab/sync (which only pushes price +
 * availability RECORDS): a full push makes Grab adopt OUR item ids (= products.id)
 * as each item's externalID, so future order webhooks match the catalogue without
 * any manual grab_item_id linking. The open question is whether GrabFood accepts
 * a full-menu replace for a self-serve-linked store — historically it has returned
 * "UnsupportedMenuSync". This endpoint surfaces Grab's RAW response so we can see
 * exactly what happens for a given outlet.
 *
 * ⚠️ DESTRUCTIVE if accepted: it replaces the live (portal-built) menu — categories,
 * modifiers and photos as Grab currently holds them — with our payload.
 */

import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { requireAuth } from "@/lib/auth";
import { updateMenu, notifyMenuUpdate } from "@/lib/grab";
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

  const menu = await buildOutletGrabMenu(serviceClient(), merchantID);
  if (!menu) {
    return NextResponse.json(
      { ok: false, error: "build_failed", error_description: "Could not build the menu for this outlet." },
      { status: 500 },
    );
  }

  const itemsCount = menu.categories.reduce((n, c) => n + c.items.length, 0);
  if (itemsCount === 0) {
    return NextResponse.json(
      { ok: false, error: "empty_menu", error_description: "No Grab-visible items to push for this outlet." },
      { status: 400 },
    );
  }

  try {
    const result = await updateMenu(menu);
    // Best-effort nudge to re-pull (also the lever for photos/structure refresh).
    let notified = true;
    try {
      await notifyMenuUpdate(merchantID);
    } catch {
      notified = false;
    }
    return NextResponse.json({
      ok: true,
      merchantID,
      categories: menu.categories.length,
      items: itemsCount,
      notified,
      result,
    });
  } catch (err) {
    // Surface Grab's exact message (e.g. "UnsupportedMenuSync") verbatim.
    return NextResponse.json(
      { ok: false, error: "push_failed", error_description: err instanceof Error ? err.message : "Unknown error" },
      { status: 502 },
    );
  }
}
