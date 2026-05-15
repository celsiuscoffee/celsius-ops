import { NextRequest, NextResponse } from "next/server";
import { ensureNewMemberRewards } from "@/lib/loyalty/welcome";
import { findOrCreateMember } from "@/lib/loyalty/member-direct";

// .trim() guards against accidental trailing newlines in env var values
const LOYALTY_BASE = (process.env.LOYALTY_BASE_URL ?? "https://loyalty.celsiuscoffee.com").trim();

// POST /api/loyalty/otp/verify — verify OTP then fetch/create member
//
// Step 1 (OTP code validation) still proxies to the loyalty app
// because the SMS gateway lives there. Step 2/3 (member lookup +
// auto-register) NOW write to Supabase directly via
// findOrCreateMember — the loyalty proxy used to silently drop
// email/birthday and produce a different row shape from
// backoffice-admin signups, which was the root cause of the
// "Complete profile" pill resurfacing across mounts.
export async function POST(request: NextRequest) {
  try {
    const { phone, code } = await request.json();
    if (!phone || !code) return NextResponse.json({ success: false, error: "Phone and code required" }, { status: 400 });

    // Step 1: Verify OTP (still via loyalty app — SMS gateway lives there)
    const verifyRes = await fetch(`${LOYALTY_BASE}/api/otp/verify`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ phone, code, purpose: "login" }),
    });
    const verifyData = await verifyRes.json();

    if (!verifyData.success) {
      return NextResponse.json({ success: false, error: verifyData.error ?? "Invalid or expired code" });
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
