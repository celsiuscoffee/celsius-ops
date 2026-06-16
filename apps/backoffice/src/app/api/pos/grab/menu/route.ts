/**
 * Grab Menu Sync API (outbound — partner → Grab)
 *
 * POST /api/grab/menu — Push POS menu to GrabFood
 * GET  /api/grab/menu — Check menu sync status
 *
 * The POS→Grab menu mapping lives in lib/grab-menu.ts (shared with the inbound
 * "Get menu" webhook at /api/grab/merchant/menu). Per-channel modifier
 * visibility (products.modifiers[*].channels) is applied inside that builder.
 */

import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth";
import { isGrabConfigured, updateMenu, notifyMenuUpdate, traceMenuSync } from "@/lib/grab";
import { buildGrabMenuPayload, grabMenuOptionsFromEnv, type RawProduct } from "@/lib/grab-menu";
import { createClient } from "@/lib/supabase-server";

/** POST — Push full POS menu to GrabFood. */
export async function POST(request: NextRequest) {
  const auth = await requireAuth(request);
  if (auth.error) return auth.error;

  if (!isGrabConfigured()) {
    return NextResponse.json(
      { error: "Grab not configured. Set GRAB_CLIENT_ID, GRAB_CLIENT_SECRET, GRAB_MERCHANT_ID." },
      { status: 400 },
    );
  }

  const merchantId = process.env.GRAB_MERCHANT_ID!;
  const supabase = await createClient();
  const [productsRes, categoriesRes] = await Promise.all([
    supabase.from("products").select("*").order("category").order("name"),
    supabase.from("categories").select("id, slug, name").order("position", { ascending: true }),
  ]);
  if (productsRes.error || !productsRes.data) {
    return NextResponse.json({ error: "Failed to fetch products" }, { status: 500 });
  }
  const categoryNames: Record<string, string> = {};
  for (const c of categoriesRes.data || []) {
    if (c.slug && c.name) categoryNames[c.slug] = c.name;
    if (c.id && c.name) categoryNames[c.id] = c.name;
  }

  const menuPayload = buildGrabMenuPayload(productsRes.data as RawProduct[], merchantId, {
    ...grabMenuOptionsFromEnv(),
    categoryNames,
  });

  try {
    const result = await updateMenu(menuPayload);
    await notifyMenuUpdate(merchantId);
    return NextResponse.json({
      success: true,
      sellingTimesCount: menuPayload.sellingTimes.length,
      categoriesCount: menuPayload.categories.length,
      itemsCount: productsRes.data.length,
      result,
    });
  } catch (err) {
    console.error("Grab menu sync failed:", err);
    return NextResponse.json(
      { error: `Menu sync failed: ${err instanceof Error ? err.message : "Unknown error"}` },
      { status: 500 },
    );
  }
}

/** GET — Check menu sync status on Grab. */
export async function GET(request: NextRequest) {
  const auth = await requireAuth(request);
  if (auth.error) return auth.error;

  if (!isGrabConfigured()) {
    return NextResponse.json({ configured: false });
  }

  const merchantId = process.env.GRAB_MERCHANT_ID!;
  try {
    const status = await traceMenuSync(merchantId);
    return NextResponse.json({ configured: true, syncStatus: status });
  } catch (err) {
    return NextResponse.json(
      { configured: true, error: err instanceof Error ? err.message : "Unknown" },
      { status: 500 },
    );
  }
}
