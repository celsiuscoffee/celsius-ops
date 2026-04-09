import { NextRequest, NextResponse } from "next/server";

// .trim() guards against accidental trailing newlines in env var values
const LOYALTY_BASE = (process.env.LOYALTY_BASE_URL ?? "https://loyalty.celsiuscoffee.com").trim();
const BRAND_ID     = (process.env.LOYALTY_BRAND_ID  ?? "brand-celsius").trim();

// POST /api/loyalty/register — enrol a phone number in loyalty (idempotent)
export async function POST(request: NextRequest) {
  try {
    const { phone } = await request.json();
    if (!phone) {
      return NextResponse.json({ success: false, error: "Phone required" }, { status: 400 });
    }

    // Check if member already exists
    const membersRes = await fetch(
      `${LOYALTY_BASE}/api/members?brand_id=${BRAND_ID}&phone=${encodeURIComponent(phone)}`,
      { headers: { "Content-Type": "application/json" } }
    );
    const members = await membersRes.json();
    let member = Array.isArray(members) && members.length > 0 ? members[0] : null;

    // Create if new
    if (!member) {
      const createRes = await fetch(`${LOYALTY_BASE}/api/members`, {
        method:  "POST",
        headers: { "Content-Type": "application/json" },
        body:    JSON.stringify({ phone, brand_id: BRAND_ID }),
      });
      if (!createRes.ok) {
        return NextResponse.json({ success: false, error: "Failed to create member" }, { status: 500 });
      }
      member = await createRes.json();
    }

    if (!member) {
      return NextResponse.json({ success: false, error: "Failed to enrol" }, { status: 500 });
    }

    const brandData = member.brand_data ?? {};
    return NextResponse.json({
      success: true,
      enrolled: true,
      member: {
        id:                member.id,
        phone:             member.phone,
        name:              member.name ?? null,
        pointsBalance:     brandData.points_balance      ?? 0,
        totalPointsEarned: brandData.total_points_earned ?? 0,
        totalVisits:       brandData.total_visits         ?? 0,
      },
    });
  } catch (err) {
    console.error("Loyalty register error:", err);
    return NextResponse.json({ success: false, error: "Registration failed" }, { status: 500 });
  }
}
