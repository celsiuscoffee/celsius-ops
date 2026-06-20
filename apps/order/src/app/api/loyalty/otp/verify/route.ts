import { NextRequest, NextResponse } from "next/server";
import { verifyOTP } from "@/lib/otp";
import { checkRateLimit, RATE_LIMITS } from "@/lib/rate-limit";
import { ensureNewMemberRewards } from "@/lib/loyalty/welcome";
import { findOrCreateMember } from "@/lib/loyalty/member-direct";

// POST /api/loyalty/otp/verify — legacy alias for /api/otp/verify.
//
// OTP code validation now runs natively (shared OTP store via @/lib/otp)
// instead of proxying to the loyalty app, so it no longer depends on
// loyalty.celsiuscoffee.com. Member lookup/create + welcome rewards are
// unchanged (Supabase-direct via findOrCreateMember). Current clients call
// /api/otp/verify directly; this stays as a thin back-compat endpoint.
export async function POST(request: NextRequest) {
  try {
    const { phone, code } = await request.json();
    if (!phone || !code) return NextResponse.json({ success: false, error: "Phone and code required" }, { status: 400 });

    // Rate-limit by phone (the loyalty endpoint used to enforce this).
    const rate = await checkRateLimit(phone, RATE_LIMITS.OTP_VERIFY);
    if (!rate.allowed) {
      return NextResponse.json(
        { success: false, error: `Too many verification attempts. Try again in ${Math.ceil((rate.retryAfter || 300) / 60)} minutes.` },
        { status: 429 },
      );
    }

    // Step 1: Verify the OTP code natively against the shared store.
    const valid = await verifyOTP(phone, code, "login");
    if (!valid) {
      return NextResponse.json({ success: false, error: "Invalid or expired code" });
    }

    // Step 2/3: Find or create the member row in Supabase directly.
    // Phone-variant lookup so a customer who previously signed up as
    // "0123..." doesn't get a duplicate "+60123..." row.
    const member = await findOrCreateMember(phone);
    if (!member) {
      return NextResponse.json({ success: true, member: null });
    }

    // Welcome BOGO + any other new_member auto_issue rewards. Fires on
    // every pickup-app sign-in but is idempotent — the helper checks
    // issued_rewards first, so a member only gets it the first time
    // they log in via the app. Members created via POS / backoffice
    // who later sign in here get their voucher at this point.
    await ensureNewMemberRewards(member.id);

    return NextResponse.json({
      success: true,
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
    console.error("Loyalty OTP verify error:", err);
    return NextResponse.json({ success: false, error: "Verification failed" }, { status: 500 });
  }
}
