import { NextRequest, NextResponse } from "next/server";
import { findOrCreateMember } from "@/lib/loyalty/member-direct";

// POST /api/loyalty/register — enrol a phone number in loyalty (idempotent)
//
// Writes to Supabase directly via findOrCreateMember instead of
// proxying to the loyalty app's POST /api/members. Keeps member-row
// shape identical to backoffice-created rows so consolidation holds
// regardless of where the customer signs up from.
export async function POST(request: NextRequest) {
  try {
    const { phone } = await request.json();
    if (!phone) {
      return NextResponse.json({ success: false, error: "Phone required" }, { status: 400 });
    }

    const member = await findOrCreateMember(phone);
    if (!member) {
      return NextResponse.json({ success: false, error: "Failed to enrol" }, { status: 500 });
    }

    return NextResponse.json({
      success: true,
      enrolled: true,
      member: {
        id:                member.id,
        phone:             member.phone,
        name:              member.name,
        pointsBalance:     member.points_balance,
        totalPointsEarned: member.total_points_earned,
        totalVisits:       member.total_visits,
      },
    });
  } catch (err) {
    console.error("Loyalty register error:", err);
    return NextResponse.json({ success: false, error: "Registration failed" }, { status: 500 });
  }
}
