import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/pickup/supabase";

/**
 * POS "stop / resume online ordering" switch — lets a cashier pause QR table
 * orders AND pickup orders for THEIR outlet from the SUNMI register, for when
 * the shop's internet is flaky and online orders aren't reaching the till.
 *
 * Flips the SAME flag the backoffice Pickup Settings toggles and that both
 * order paths already guard on:
 *   - outlet_settings.is_open  (Prisma Outlet.isOpen)
 *   - /api/orders            (pickup) → rejects when is_open === false
 *   - /api/checkout/initiate (QR)     → rejects when is_open === false
 *
 * Like /api/pos/availability this is an open POS endpoint (the native app
 * carries no backoffice session cookie); it keys off the loyalty outlet id the
 * register sends ("outlet-sa") and resolves the pickup store slug ("shah-alam")
 * the flag is stored against. Writes run under service role.
 *
 * Closing also pins app_settings.outlet_open_override[storeId]=true so the
 * auto-hours cron doesn't silently reopen the outlet mid-outage. Re-opening
 * CLEARS that override so the outlet returns to its normal scheduled hours.
 */

// Guarantee the four known outlets resolve even before a settings row exists
// (mirrors /api/pos/table-qr + /api/pos/availability).
const STORE_SLUG: Record<string, string> = {
  "outlet-sa": "shah-alam",
  "outlet-con": "conezion",
  "outlet-tam": "tamarind",
  "outlet-nilai": "nilai",
};

async function resolveStoreId(
  supabase: ReturnType<typeof getSupabaseAdmin>,
  outletId: string,
): Promise<string | null> {
  const { data: os } = await supabase
    .from("outlet_settings")
    .select("store_id")
    .eq("loyalty_outlet_id", outletId)
    .maybeSingle();
  return (os as { store_id?: string } | null)?.store_id || STORE_SLUG[outletId] || null;
}

// GET /api/pos/ordering-open?outlet_id=outlet-sa → { is_open, store_id }
export async function GET(req: NextRequest) {
  const outletId = req.nextUrl.searchParams.get("outlet_id") || "";
  if (!outletId) return NextResponse.json({ error: "outlet_id required" }, { status: 400 });

  const supabase = getSupabaseAdmin();
  const storeId = await resolveStoreId(supabase, outletId);
  if (!storeId) return NextResponse.json({ error: `Unknown outlet ${outletId}` }, { status: 404 });

  const { data } = await supabase
    .from("outlet_settings")
    .select("is_open")
    .eq("store_id", storeId)
    .maybeSingle();

  // Open by default when no row / null — matches "not explicitly closed".
  const isOpen = (data as { is_open?: boolean | null } | null)?.is_open;
  return NextResponse.json({ is_open: isOpen !== false, store_id: storeId });
}

// POST /api/pos/ordering-open — body: { outlet_id, is_open }
export async function POST(req: NextRequest) {
  let body: { outlet_id?: string; is_open?: boolean };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const { outlet_id, is_open } = body;
  if (!outlet_id || typeof is_open !== "boolean") {
    return NextResponse.json({ error: "outlet_id, is_open required" }, { status: 400 });
  }

  const supabase = getSupabaseAdmin();
  const storeId = await resolveStoreId(supabase, outlet_id);
  if (!storeId) return NextResponse.json({ error: `Unknown outlet ${outlet_id}` }, { status: 404 });

  const now = new Date().toISOString();

  // 1. Flip the open/closed flag (immediate effect on the next order request).
  const { data: updated, error } = await supabase
    .from("Outlet")
    .update({ isOpen: is_open, updatedAt: now })
    .eq("pickupStoreId", storeId)
    .select("id");
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  if (!updated || updated.length === 0) {
    // No Outlet row maps to this store slug — flag wouldn't have changed.
    return NextResponse.json(
      { error: `No outlet linked to store "${storeId}"` },
      { status: 404 },
    );
  }

  // 2. Keep the auto-hours cron in step:
  //    close → pin override so it can't reopen us during the outage;
  //    open  → drop the override so we follow the configured schedule again.
  try {
    const { data: ovRow } = await supabase
      .from("app_settings")
      .select("value")
      .eq("key", "outlet_open_override")
      .maybeSingle();
    const raw = (ovRow as { value?: unknown } | null)?.value;
    const override: Record<string, boolean> =
      raw && typeof raw === "object" && !Array.isArray(raw)
        ? { ...(raw as Record<string, boolean>) }
        : {};
    if (is_open) delete override[storeId];
    else override[storeId] = true;
    await supabase
      .from("app_settings")
      .upsert({ key: "outlet_open_override", value: override, updated_at: now }, { onConflict: "key" });
  } catch (e) {
    // Non-fatal: the flag flip above already took effect. Worst case the cron
    // reconciles to schedule on its next tick.
    console.error("[pos/ordering-open] override sync failed:", e);
  }

  return NextResponse.json({ ok: true, store_id: storeId, is_open });
}
