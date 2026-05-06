import { NextRequest, NextResponse } from "next/server";

// .trim() guards against accidental trailing newlines in env var values
const LOYALTY_BASE = (process.env.LOYALTY_BASE_URL ?? "https://loyalty.celsiuscoffee.com").trim();
const BRAND_ID     = (process.env.LOYALTY_BRAND_ID  ?? "brand-celsius").trim();

// POST /api/loyalty/promotions/evaluate
// Proxies to the loyalty app's /api/promotions/evaluate so the pickup
// client can preview the discount stack as the cart changes.
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();

    const res = await fetch(`${LOYALTY_BASE}/api/promotions/evaluate`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
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
