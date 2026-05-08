import { NextRequest, NextResponse } from "next/server";

// .trim() guards against accidental trailing newlines in env var values
const LOYALTY_BASE = (process.env.LOYALTY_BASE_URL ?? "https://loyalty.celsiuscoffee.com").trim();
const BRAND_ID     = (process.env.LOYALTY_BRAND_ID  ?? "brand-celsius").trim();

// POST /api/loyalty/promotions/evaluate
// Proxies to the loyalty app's /api/promotions/evaluate so the pickup
// client can preview the discount stack as the cart changes.
//
// We forward an explicit Origin pointing at order.celsiuscoffee.com so
// the loyalty app's CSRF middleware (which checks Origin against an
// allow-list) accepts the proxied call. Without this, server-to-server
// fetch sends no Origin → loyalty returns 403 → discount silently
// doesn't apply on the client. Native fetches from the pickup app also
// hit this same proxy, so the fix is one-and-done here.
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();

    const res = await fetch(`${LOYALTY_BASE}/api/promotions/evaluate`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        // celsiuscoffee.com is on the loyalty app's CSRF allowlist;
        // order.celsiuscoffee.com would be the architecturally correct
        // value but isn't (yet) in that list — we add it in a follow-up
        // commit, but keep this safe value to ensure the fix lands today.
        Origin: "https://celsiuscoffee.com",
      },
      body: JSON.stringify({ brand_id: BRAND_ID, ...body }),
    });
    const data = await res.json();
    if (!res.ok) {
      return NextResponse.json(data, { status: res.status });
    }
    return NextResponse.json(data);
  } catch (err) {
    console.error("promotions/evaluate proxy error:", err);
    return NextResponse.json(
      { error: "Failed to evaluate promotions" },
      { status: 500 }
    );
  }
}
