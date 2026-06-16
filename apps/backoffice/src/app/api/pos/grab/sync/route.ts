/**
 * Manual "Sync menu to Grab" — outbound (us → Grab).
 *
 * POST /api/pos/grab/sync   { merchantID }    (staff-auth)
 *   -> notifyMenuUpdate(merchantID)
 *
 * Tells GrabFood our menu changed for this store so Grab re-pulls our latest menu
 * via the get-menu webhook (which serves the per-outlet menu incl. the 86 list +
 * service hours). Backoffice stays the source of truth; this just makes Grab
 * follow on demand instead of waiting for its own next pull — so edits like a
 * hidden item, a new photo, or a price change show up on GrabFood right away.
 */

import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth";
import { notifyMenuUpdate } from "@/lib/grab";

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

  try {
    const result = await notifyMenuUpdate(merchantID);
    return NextResponse.json({ ok: true, merchantID, result });
  } catch (err) {
    return NextResponse.json(
      { ok: false, error: "sync_failed", error_description: err instanceof Error ? err.message : "Unknown error" },
      { status: 502 },
    );
  }
}
