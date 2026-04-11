/**
 * Grab Menu Sync API
 *
 * POST /api/grab/menu — Push POS menu to GrabFood
 * GET  /api/grab/menu — Check menu sync status
 */

import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth";
import {
  isGrabConfigured,
  updateMenu,
  notifyMenuUpdate,
  traceMenuSync,
  type GrabMenuCategory,
  type GrabMenuItem,
  type GrabModifierGroup,
  type GrabMenuPayload,
} from "@/lib/grab";
import { createClient } from "@/lib/supabase-server";

interface RawProduct {
  id: string;
  name: string;
  category: string;
  sell_price: number; // RM decimal
  description?: string;
  image_url?: string;
  is_available?: boolean;
  modifiers?: Array<{
    title?: string;
    isMultiSelect?: boolean;
    modifiers?: Array<{
      label: string;
      priceDelta?: number;
      default?: boolean;
    }>;
  }>;
}

function convertToGrabModifiers(
  productId: string,
  rawModifiers: RawProduct["modifiers"],
): GrabModifierGroup[] {
  if (!rawModifiers || rawModifiers.length === 0) return [];

  return rawModifiers
    .filter((g) => g.modifiers && g.modifiers.length > 0)
    .map((group, gIdx) => ({
      id: `${productId}-mg-${gIdx}`,
      name: group.title || `Option ${gIdx + 1}`,
      availableStatus: "AVAILABLE" as const,
      selectionRangeMin: group.isMultiSelect ? 0 : 1,
      selectionRangeMax: group.isMultiSelect
        ? group.modifiers!.length
        : 1,
      modifiers: group.modifiers!.map((mod, mIdx) => ({
        id: `${productId}-m-${gIdx}-${mIdx}`,
        name: mod.label,
        availableStatus: "AVAILABLE" as const,
        price: Math.round((mod.priceDelta || 0) * 100), // RM → sen
      })),
    }));
}

function convertProductToGrabItem(product: RawProduct): GrabMenuItem {
  return {
    id: product.id,
    name: product.name,
    availableStatus:
      product.is_available === false ? "UNAVAILABLE" : "AVAILABLE",
    description: product.description || undefined,
    price: Math.round(product.sell_price * 100), // RM → sen
    photos: product.image_url ? [product.image_url] : undefined,
    modifierGroups: convertToGrabModifiers(product.id, product.modifiers),
  };
}

/**
 * POST — Push full POS menu to GrabFood.
 * Requires MANAGER+ role.
 */
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

  // Fetch all products from POS
  const { data: products, error: fetchErr } = await supabase
    .from("products")
    .select("*")
    .order("category")
    .order("name");

  if (fetchErr || !products) {
    return NextResponse.json(
      { error: "Failed to fetch products" },
      { status: 500 },
    );
  }

  // Group by category
  const categoryMap = new Map<string, GrabMenuItem[]>();
  for (const product of products as RawProduct[]) {
    const cat = product.category || "Uncategorized";
    if (!categoryMap.has(cat)) categoryMap.set(cat, []);
    categoryMap.get(cat)!.push(convertProductToGrabItem(product));
  }

  // Build Grab categories
  const categories: GrabMenuCategory[] = Array.from(categoryMap.entries()).map(
    ([catName, items], idx) => ({
      id: `cat-${idx}`,
      name: catName,
      availableStatus: "AVAILABLE" as const,
      items,
    }),
  );

  // Build full menu payload
  const menuPayload: GrabMenuPayload = {
    merchantID: merchantId,
    currency: { code: "MYR", symbol: "RM", exponent: 2 },
    sellingTimes: [
      {
        id: "all-day",
        startTime: "00:00",
        endTime: "23:59",
        name: "All Day",
        serviceHours: {
          mon: { openPeriodType: "OpenPeriod", periods: [{ startTime: "08:00", endTime: "22:00" }] },
          tue: { openPeriodType: "OpenPeriod", periods: [{ startTime: "08:00", endTime: "22:00" }] },
          wed: { openPeriodType: "OpenPeriod", periods: [{ startTime: "08:00", endTime: "22:00" }] },
          thu: { openPeriodType: "OpenPeriod", periods: [{ startTime: "08:00", endTime: "22:00" }] },
          fri: { openPeriodType: "OpenPeriod", periods: [{ startTime: "08:00", endTime: "22:00" }] },
          sat: { openPeriodType: "OpenPeriod", periods: [{ startTime: "08:00", endTime: "22:00" }] },
          sun: { openPeriodType: "OpenPeriod", periods: [{ startTime: "08:00", endTime: "22:00" }] },
        },
      },
    ],
    categories,
  };

  try {
    const result = await updateMenu(menuPayload);
    // Notify Grab to re-sync
    await notifyMenuUpdate(merchantId);

    return NextResponse.json({
      success: true,
      categoriesCount: categories.length,
      itemsCount: products.length,
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

/**
 * GET — Check menu sync status on Grab.
 */
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
