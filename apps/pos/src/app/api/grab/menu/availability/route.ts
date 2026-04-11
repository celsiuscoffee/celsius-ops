/**
 * Grab Item Availability API
 *
 * PATCH /api/grab/menu/availability — Toggle item availability on GrabFood
 *
 * Body: { items: [{ id: "product-uuid", available: true/false }] }
 */

import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth";
import { isGrabConfigured, batchUpdateMenu } from "@/lib/grab";

export async function PATCH(request: NextRequest) {
  const auth = await requireAuth(request);
  if (auth.error) return auth.error;

  if (!isGrabConfigured()) {
    return NextResponse.json(
      { error: "Grab not configured" },
      { status: 400 },
    );
  }

  const body = await request.json();
  const items: Array<{ id: string; available: boolean }> = body.items;

  if (!items || !Array.isArray(items) || items.length === 0) {
    return NextResponse.json(
      { error: "items array required with id and available fields" },
      { status: 400 },
    );
  }

  const merchantId = process.env.GRAB_MERCHANT_ID!;

  const menuEntities = items.map((item) => ({
    id: item.id,
    availableStatus: item.available
      ? ("AVAILABLE" as const)
      : ("UNAVAILABLE" as const),
  }));

  try {
    const result = await batchUpdateMenu(merchantId, "availableStatus", menuEntities);
    return NextResponse.json({
      success: true,
      updated: items.length,
      result,
    });
  } catch (err) {
    console.error("Grab availability update failed:", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Unknown error" },
      { status: 500 },
    );
  }
}
