/**
 * "Get menu" webhook (inbound — Grab → POS).
 *
 * GET /api/grab/merchant/menu
 *
 * GrabFood calls this to pull our latest menu. Per the API deck this is only
 * triggered AFTER we call the outbound "Update menu notification" (lib/grab.ts
 * notifyMenuUpdate). Grab presents the partner Bearer token it obtained from our
 * /api/grab/oauth/token endpoint, so we gate on verifyGrabPartnerToken (NOT the
 * staff requireAuth used by the outbound routes).
 *
 * Register this URL in the GrabFood portal "Partner configuration → Get menu".
 *
 * There's no user session on an inbound webhook, so we read products with the
 * service-role key (the products table is behind RLS) — mirrors lib/loyalty-snapshot.
 */

import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { verifyGrabPartnerToken } from "@/lib/grab-partner";
import { buildGrabMenuPayload, grabMenuOptionsFromEnv, type RawProduct } from "@/lib/grab-menu";

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

  const supabase = serviceClient();
  const [productsRes, categoriesRes] = await Promise.all([
    supabase.from("products").select("*").order("category").order("name"),
    supabase.from("categories").select("id, slug, name").order("position", { ascending: true }),
  ]);

  if (productsRes.error || !productsRes.data) {
    console.error("[grab:get-menu] product fetch failed:", productsRes.error);
    return NextResponse.json({ error: "Failed to fetch products" }, { status: 500 });
  }

  // Build slug→displayName map so Grab sees "Artisan Choc" instead of "artisan-choc".
  const categoryNames: Record<string, string> = {};
  for (const c of categoriesRes.data || []) {
    if (c.slug && c.name) categoryNames[c.slug] = c.name;
    if (c.id && c.name) categoryNames[c.id] = c.name; // products.category might store id too
  }

  const menu = buildGrabMenuPayload(productsRes.data as RawProduct[], merchantId, {
    ...grabMenuOptionsFromEnv(),
    categoryNames,
  });
  const catCount = menu.sections.reduce((n, s) => n + s.categories.length, 0);
  console.log(
    `[grab:get-menu] served menu merchant=${merchantId} sections=${menu.sections.length} categories=${catCount} items=${productsRes.data.length}`,
  );
  return NextResponse.json(menu);
}
