import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth";

/**
 * Proxies the admin "test send" button to the order app's
 * /api/push/test-send endpoint, attaching the shared CRON_SECRET as
 * the bearer token. Backoffice auth gates who can hit this; the
 * order app's secret check ensures no public can.
 *
 * Why proxy rather than call from client:
 *   - The admin secret never leaves the server. A public client
 *     fetch would expose it in network logs.
 *   - Backoffice auth gating already lives here.
 */

const ORDER_BASE = process.env.ORDER_APP_BASE_URL ?? "https://order.celsiuscoffee.com";

export async function POST(request: NextRequest) {
  const auth = await requireAuth(request);
  if (auth.error) return auth.error;

  try {
    const body = await request.json();
    const secret = process.env.CRON_SECRET;
    if (!secret) {
      return NextResponse.json(
        { error: "CRON_SECRET not configured on backoffice" },
        { status: 500 },
      );
    }

    const res = await fetch(`${ORDER_BASE}/api/push/test-send`, {
      method:  "POST",
      headers: {
        "Content-Type":  "application/json",
        "x-admin-secret": secret,
      },
      body:    JSON.stringify(body),
    });

    const json = await res.json().catch(() => ({}));
    return NextResponse.json(json, { status: res.status });
  } catch (err) {
    console.error("[push-campaigns test-send proxy]", err);
    return NextResponse.json({ error: "Failed to relay test send" }, { status: 500 });
  }
}
