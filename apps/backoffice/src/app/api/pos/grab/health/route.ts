/**
 * GrabFood integration health check.
 *
 * GET /api/grab/health — confirms the GrabFood OAuth credentials work by doing
 * a server-side client_credentials token exchange against Grab. It NEVER returns
 * the access token itself — only { ok } plus booleans for which env vars are set.
 * Auth-gated (staff) like the other Grab routes. Visit it while logged into the
 * POS to confirm staging auth is wired before exercising the menu/order endpoints.
 */

import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth";
import { getAccessToken, getGrabConfig } from "@/lib/grab";

export async function GET(request: NextRequest) {
  const auth = await requireAuth(request);
  if (auth.error) return auth.error;

  const config = getGrabConfig();
  // Booleans only — surfaces what's configured without ever echoing a secret.
  const present = {
    GRAB_CLIENT_ID: !!process.env.GRAB_CLIENT_ID,
    GRAB_CLIENT_SECRET: !!process.env.GRAB_CLIENT_SECRET,
    GRAB_HMAC_SECRET: !!process.env.GRAB_HMAC_SECRET,
    GRAB_MERCHANT_ID: !!process.env.GRAB_MERCHANT_ID,
    GRAB_ENV: config.env,
  };

  if (!process.env.GRAB_CLIENT_ID || !process.env.GRAB_CLIENT_SECRET) {
    return NextResponse.json(
      { ok: false, reason: "missing_credentials", present },
      { status: 400 },
    );
  }

  try {
    const token = await getAccessToken();
    return NextResponse.json({
      ok: true,
      env: config.env,
      tokenAcquired: !!token, // boolean only — token value is never returned
      present,
    });
  } catch (err) {
    return NextResponse.json(
      {
        ok: false,
        reason: "oauth_failed",
        error: err instanceof Error ? err.message : "Unknown error",
        present,
      },
      { status: 502 },
    );
  }
}
