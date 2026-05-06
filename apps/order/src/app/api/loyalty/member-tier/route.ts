import { NextRequest, NextResponse } from "next/server";

// .trim() guards against accidental trailing newlines in env var values
const LOYALTY_BASE = (process.env.LOYALTY_BASE_URL ?? "https://loyalty.celsiuscoffee.com").trim();
const BRAND_ID     = (process.env.LOYALTY_BRAND_ID  ?? "brand-celsius").trim();

// GET /api/loyalty/member-tier?member_id=xxx
// Proxies to the loyalty app's /api/member-tier so the pickup app can
// surface the tier badge, multiplier, and progress-to-next-tier.
export async function GET(request: NextRequest) {
  try {
    const memberId = request.nextUrl.searchParams.get("member_id");
    if (!memberId) {
      return NextResponse.json({ error: "member_id required" }, { status: 400 });
    }

    const res = await fetch(
      `${LOYALTY_BASE}/api/member-tier?member_id=${encodeURIComponent(memberId)}&brand_id=${BRAND_ID}`,
      { headers: { "Content-Type": "application/json" } }
    );
    const data = await res.json();
    if (!res.ok) {
      return NextResponse.json(data, { status: res.status });
    }
    return NextResponse.json(data);
  } catch (err) {
    console.error("Loyalty member-tier fetch error:", err);
    return NextResponse.json({ error: "Failed to fetch tier" }, { status: 500 });
  }
}
