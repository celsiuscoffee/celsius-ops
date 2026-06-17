/**
 * Manual "Sync menu to Grab" — outbound record push (us → Grab).
 *
 * POST /api/pos/grab/sync   { merchantID }    (staff-auth)
 *
 * Pushes current PRICE + AVAILABILITY for every Grab-visible item to GrabFood via
 * the Update Menu Record API (PUT /partner/v1/batch/menu, field "ITEM"). This is
 * the only on-demand push GrabFood supports for self-serve-linked stores:
 *   - notify→pull (.../menu/notification) → "UnsupportedMenuSync" (disabled here)
 *   - full-menu upload                    → does not exist in the API
 * So a sync keeps Grab's prices in line with backoffice and applies the per-outlet
 * 86 list (sold-out items → UNAVAILABLE). It CANNOT change photos / item names /
 * add-remove items — that menu *content* only refreshes when Grab re-pulls our
 * get-menu webhook (i.e. at activation). Backoffice stays the source of truth.
 *
 * Entities are taken straight off the shared per-outlet builder, so the ids,
 * prices and availability we push are byte-for-byte what the get-menu webhook
 * would serve. Service-role read for per-outlet data; route is staff-gated.
 */

import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { requireAuth } from "@/lib/auth";
import { batchUpdateMenu } from "@/lib/grab";
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

  // Flatten the menu's items into price/availability records. Same item ids the
  // menu declares (= products.id), so they match what Grab pulled.
  const entities = menu.categories
    .flatMap((c) => c.items)
    .map((it) => ({
      id: it.id,
      price: it.price,
      availableStatus: it.availableStatus,
      ...(it.maxStock != null ? { maxStock: it.maxStock } : {}),
    }));

  if (entities.length === 0) {
    return NextResponse.json(
      { ok: false, error: "empty_menu", error_description: "No Grab-visible items to sync for this outlet." },
      { status: 400 },
    );
  }

  try {
    const result = await batchUpdateMenu(merchantID, "ITEM", entities);
    return NextResponse.json({ ok: true, merchantID, items: entities.length, result });
  } catch (err) {
    return NextResponse.json(
      { ok: false, error: "sync_failed", error_description: err instanceof Error ? err.message : "Unknown error" },
      { status: 502 },
    );
  }
}
