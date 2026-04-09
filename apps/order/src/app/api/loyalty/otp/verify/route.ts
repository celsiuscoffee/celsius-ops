import { NextRequest, NextResponse } from "next/server";

// .trim() guards against accidental trailing newlines in env var values
const LOYALTY_BASE = (process.env.LOYALTY_BASE_URL ?? "https://loyalty.celsiuscoffee.com").trim();
const BRAND_ID     = (process.env.LOYALTY_BRAND_ID  ?? "brand-celsius").trim();

// POST /api/loyalty/otp/verify — verify OTP then fetch/create member
export async function POST(request: NextRequest) {
  try {
    const { phone, code } = await request.json();
    if (!phone || !code) return NextResponse.json({ success: false, error: "Phone and code required" }, { status: 400 });

    // Step 1: Verify OTP
    const verifyRes = await fetch(`${LOYALTY_BASE}/api/otp/verify`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ phone, code, purpose: "login" }),
    });
    const verifyData = await verifyRes.json();

    if (!verifyData.success) {
      return NextResponse.json({ success: false, error: verifyData.error ?? "Invalid or expired code" });
    }

    // Step 2: Look up member
    const membersRes = await fetch(
      `${LOYALTY_BASE}/api/members?brand_id=${BRAND_ID}&phone=${encodeURIComponent(phone)}`,
      { headers: { "Content-Type": "application/json" } }
    );
    const members = await membersRes.json();
    let member = Array.isArray(members) && members.length > 0 ? members[0] : null;

    // Step 3: Auto-register if new
    if (!member) {
      const createRes = await fetch(`${LOYALTY_BASE}/api/members`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ phone, brand_id: BRAND_ID }),
      });
      if (createRes.ok) {
        member = await createRes.json();
      }
    }

    if (!member) {
      return NextResponse.json({ success: true, member: null });
    }

    const brandData = member.brand_data ?? {};

    return NextResponse.json({
      success: true,
      member: {
        id:                member.id,
        phone:             member.phone,
        name:              member.name ?? null,
        pointsBalance:     brandData.points_balance     ?? 0,
        totalPointsEarned: brandData.total_points_earned ?? 0,
        totalVisits:       brandData.total_visits        ?? 0,
      },
    });
  } catch (err) {
    console.error("Loyalty OTP verify error:", err);
    return NextResponse.json({ success: false, error: "Verification failed" }, { status: 500 });
  }
}
