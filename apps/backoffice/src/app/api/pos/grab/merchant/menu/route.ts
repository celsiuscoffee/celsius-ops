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
import { buildGrabMenuPayload, buildGrabServiceHours, grabMenuOptionsFromEnv, type RawProduct } from "@/lib/grab-menu";

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

  // Per-outlet open hours: merchantID → outlets.grab_merchant_id → outlet id →
  // pos_branch_settings.grab_open_time/close/24h. Falls back to 08:00–22:00.
  let serviceHours: ReturnType<typeof buildGrabServiceHours> | undefined;
  // Product ids 86'd at this merchant's outlet (per-outlet stock-outs) → forced
  // UNAVAILABLE in the payload so a full re-sync respects the same overrides
  // the live availability push sends.
  let unavailableIds: Set<string> | undefined;
  if (merchantId) {
    const { data: outlet } = await supabase
      .from("outlets").select("id").eq("grab_merchant_id", merchantId).maybeSingle();
    if (outlet?.id) {
      const { data: bs } = await supabase
        .from("pos_branch_settings")
        .select("grab_open_time, grab_close_time, grab_open_24h")
        .eq("outlet_id", outlet.id)
        .maybeSingle();
      if (bs) {
        serviceHours = buildGrabServiceHours({
          open: bs.grab_open_time, close: bs.grab_close_time, open24h: bs.grab_open_24h,
        });
        console.log(`[grab:get-menu] hours outlet=${outlet.id} 24h=${bs.grab_open_24h} ${bs.grab_open_time}-${bs.grab_close_time}`);
      }
      // Per-outlet 86 list (outlet_product_availability keyed by store slug).
      const { data: os } = await supabase
        .from("outlet_settings").select("store_id").eq("loyalty_outlet_id", outlet.id).maybeSingle();
      const storeId = (os as { store_id?: string } | null)?.store_id;
      if (storeId) {
        const { data: oos } = await supabase
          .from("outlet_product_availability").select("product_id")
          .eq("outlet_id", storeId).eq("is_available", false);
        unavailableIds = new Set((oos ?? []).map((r: { product_id: string }) => r.product_id));
      }
    }
  }

  // Build slug→displayName map so Grab sees "Artisan Choc" instead of "artisan-choc".
  const categoryNames: Record<string, string> = {};
  for (const c of categoriesRes.data || []) {
    if (c.slug && c.name) categoryNames[c.slug] = c.name;
    if (c.id && c.name) categoryNames[c.id] = c.name; // products.category might store id too
  }

  // "Show on" placement: only products visible on the Grab channel ship (empty
  // visible_channels = everywhere — same allow-list rule as modifiers).
  const grabProducts = (productsRes.data as RawProduct[]).filter((p) => {
    const vc = (p as { visible_channels?: string[] }).visible_channels;
    return !Array.isArray(vc) || vc.length === 0 || vc.includes("grab");
  });
  const menu = buildGrabMenuPayload(grabProducts, merchantId, {
    ...grabMenuOptionsFromEnv(),
    categoryNames,
    serviceHours,
    unavailableProductIds: unavailableIds,
  });
  const catCount = menu.sections.reduce((n, s) => n + s.categories.length, 0);
  console.log(
    `[grab:get-menu] served menu merchant=${merchantId} sections=${menu.sections.length} categories=${catCount} items=${grabProducts.length}`,
  );
  return NextResponse.json(menu);
}
