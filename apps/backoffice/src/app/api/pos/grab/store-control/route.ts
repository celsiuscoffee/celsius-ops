/**
 * GrabFood store pause/status — POS-callable, PER-OUTLET.
 *
 * GET  /api/pos/grab/store-control?outlet_id=outlet-sa  → { configured, paused, isActive }
 * POST /api/pos/grab/store-control  { outlet_id, pause: boolean, duration?: minutes }
 *
 * The register's Settings screen uses this to pause/resume a single outlet on
 * GrabFood (during a break / rush). Unlike the backoffice /api/pos/grab/store
 * route (single GRAB_MERCHANT_ID + MANAGER session), this resolves the OUTLET's
 * own grab_merchant_id and follows the service-role + Origin-CSRF pattern of
 * /api/pos/order-status (the register has no staff session). Outbound to Grab:
 * getStoreStatus / pauseStore.
 */

import { NextRequest, NextResponse } from "next/server";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { getStoreStatus, pauseStore } from "@/lib/grab";

let cached: SupabaseClient | null = null;
function db(): SupabaseClient {
  if (!cached) {
    cached = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    );
  }
  return cached;
}

function grabReady(): boolean {
  return !!(process.env.GRAB_CLIENT_ID && process.env.GRAB_CLIENT_SECRET);
}

async function resolveMerchant(outletId: string): Promise<string | null> {
  const { data } = await db()
    .from("outlets")
    .select("grab_merchant_id")
    .eq("id", outletId)
    .maybeSingle();
  return (data as { grab_merchant_id?: string | null } | null)?.grab_merchant_id ?? null;
}

export async function GET(req: NextRequest) {
  const outletId = (req.nextUrl.searchParams.get("outlet_id") ?? "").trim();
  if (!outletId) return NextResponse.json({ error: "outlet_id required" }, { status: 400 });
  if (!grabReady()) return NextResponse.json({ configured: false });

  const merchantId = await resolveMerchant(outletId);
  if (!merchantId) return NextResponse.json({ configured: false, reason: "no-merchant" });

  try {
    const status = await getStoreStatus(merchantId);
    return NextResponse.json({
      configured: true,
      merchantId,
      paused: !!status.isPause,
      isActive: !!status.isActive,
      closedReason: status.closedReason ?? null,
    });
  } catch (e) {
    return NextResponse.json(
      { configured: true, error: e instanceof Error ? e.message : "Unknown error" },
      { status: 502 },
    );
  }
}

export async function POST(req: NextRequest) {
  let body: { outlet_id?: string; pause?: boolean; duration?: number } = {};
  try {
    body = await req.json();
  } catch {
    /* tolerate empty body */
  }
  const outletId = (body.outlet_id ?? "").trim();
  if (!outletId || typeof body.pause !== "boolean") {
    return NextResponse.json({ error: "outlet_id + pause (boolean) required" }, { status: 400 });
  }
  if (!grabReady()) return NextResponse.json({ error: "Grab not configured" }, { status: 400 });

  const merchantId = await resolveMerchant(outletId);
  if (!merchantId) {
    return NextResponse.json({ error: `No GrabFood merchant for outlet ${outletId}` }, { status: 404 });
  }

  try {
    const result = await pauseStore(merchantId, body.pause, body.duration);
    console.log(`[grab:store-control] outlet=${outletId} merchant=${merchantId} pause=${body.pause}`);
    return NextResponse.json({ ok: true, paused: body.pause, duration: body.duration ?? null, result });
  } catch (e) {
    return NextResponse.json(
      { ok: false, error: e instanceof Error ? e.message : "Unknown error" },
      { status: 502 },
    );
  }
}
