/**
 * Grab Store Management API
 *
 * GET  /api/grab/store — Get store status and hours
 * POST /api/grab/store — Pause/unpause store
 */

import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth";
import {
  isGrabConfigured,
  getGrabConfig,
  getStoreStatus,
  getStoreHours,
  pauseStore,
} from "@/lib/grab";

/**
 * GET — Get Grab store status and configuration.
 */
export async function GET(request: NextRequest) {
  const auth = await requireAuth(request);
  if (auth.error) return auth.error;

  const config = getGrabConfig();
  if (!config.configured) {
    return NextResponse.json({ configured: false });
  }

  try {
    const [status, hours] = await Promise.all([
      getStoreStatus(config.merchantId),
      getStoreHours(config.merchantId),
    ]);

    return NextResponse.json({
      configured: true,
      env: config.env,
      merchantId: config.merchantId,
      status,
      hours,
    });
  } catch (err) {
    return NextResponse.json(
      {
        configured: true,
        error: err instanceof Error ? err.message : "Unknown error",
      },
      { status: 500 },
    );
  }
}

/**
 * POST — Pause or unpause the store on Grab.
 *
 * Body: { pause: true/false, duration?: number (minutes) }
 */
export async function POST(request: NextRequest) {
  const auth = await requireAuth(request);
  if (auth.error) return auth.error;

  // Only MANAGER+ can pause/unpause store
  if (auth.user.role !== "OWNER" && auth.user.role !== "ADMIN" && auth.user.role !== "MANAGER") {
    return NextResponse.json({ error: "Forbidden: MANAGER+ required" }, { status: 403 });
  }

  if (!isGrabConfigured()) {
    return NextResponse.json({ error: "Grab not configured" }, { status: 400 });
  }

  const body = await request.json();
  const isPause: boolean = body.pause;
  const duration: number | undefined = body.duration;

  if (typeof isPause !== "boolean") {
    return NextResponse.json(
      { error: "pause (boolean) required" },
      { status: 400 },
    );
  }

  const merchantId = process.env.GRAB_MERCHANT_ID!;

  try {
    const result = await pauseStore(merchantId, isPause, duration);
    return NextResponse.json({
      success: true,
      paused: isPause,
      duration: duration || null,
      result,
    });
  } catch (err) {
    console.error("Grab store pause failed:", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Unknown error" },
      { status: 500 },
    );
  }
}
