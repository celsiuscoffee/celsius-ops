import { NextRequest, NextResponse } from 'next/server';
import { verifyOTP } from '@/lib/otp';
import { checkRateLimit, RATE_LIMITS } from '@/lib/rate-limit';
import { signCustomerSession } from '@/lib/customer-jwt';
import { findOrCreateMember } from '@/lib/loyalty/member-direct';
import { ensureNewMemberRewards } from '@/lib/loyalty/welcome';

/** Ensure the customer has a Supabase members row by the time the
 *  session JWT is issued. Previously this route only did a lookup
 *  (`lookupMemberId`) — for first-time signups that returned null,
 *  the JWT was signed with `sub: null`, and downstream /me/* calls
 *  fell back to a loyalty-service phone lookup. That fallback path
 *  was brittle (broke any /me endpoint that didn't have the
 *  fallback) and prevented immediate referral attribution on
 *  brand-new signups. Now we always create the row up front; same
 *  pattern the /api/loyalty/otp/verify proxy used. Falls safe to
 *  null if creation fails — caller can retry later. */
type MemberSnapshot = {
  id: string;
  name: string | null;
  email: string | null;
  pointsBalance: number;
  totalVisits: number;
};

async function ensureMemberRow(phone: string): Promise<MemberSnapshot | null> {
  try {
    const member = await findOrCreateMember(phone);
    if (!member?.id) return null;
    // Welcome BOGO + any other new_member auto_issue rewards.
    // Idempotent — checks issued_rewards first, so signing in
    // repeatedly doesn't re-grant. Best-effort; failure here
    // shouldn't block sign-in.
    ensureNewMemberRewards(member.id).catch((e) => {
      console.warn('[otp/verify] ensureNewMemberRewards failed:', e);
    });
    return {
      id: member.id,
      name: member.name ?? null,
      email: member.email ?? null,
      pointsBalance: member.points_balance ?? 0,
      totalVisits: member.total_visits ?? 0,
    };
  } catch (e) {
    console.error('[otp/verify] ensureMemberRow failed:', e);
    return null;
  }
}

export async function POST(request: NextRequest) {
  try {
    const { phone, code, purpose } = await request.json();

    if (!phone || !code) {
      return NextResponse.json({ success: false, error: 'phone and code required' }, { status: 400 });
    }

    // Reviewer bypass — see otp/send for the full rationale. Constant-
    // time match so probing the reviewer code on other phones gives
    // no timing oracle. Falls through to the real verifier below if
    // the phone doesn't match the reviewer phone.
    const reviewerPhone = process.env.OTP_REVIEWER_PHONE;
    const reviewerCode  = process.env.OTP_REVIEWER_CODE;
    if (
      reviewerPhone &&
      reviewerCode &&
      phone === reviewerPhone &&
      typeof code === 'string' &&
      code.length === reviewerCode.length
    ) {
      let diff = 0;
      for (let i = 0; i < code.length; i++) {
        diff |= code.charCodeAt(i) ^ reviewerCode.charCodeAt(i);
      }
      if (diff === 0) {
        const member = await ensureMemberRow(phone);
        const sessionToken = signCustomerSession({ memberId: member?.id ?? null, phone });
        return NextResponse.json({ success: true, sessionToken, member });
      }
    }

    // Rate limit by phone number
    const rateCheck = await checkRateLimit(phone, RATE_LIMITS.OTP_VERIFY);
    if (!rateCheck.allowed) {
      return NextResponse.json(
        { success: false, error: `Too many verification attempts. Try again in ${Math.ceil((rateCheck.retryAfter || 300) / 60)} minutes.` },
        { status: 429 }
      );
    }

    const valid = await verifyOTP(phone, code, purpose || 'login');
    if (!valid) {
      return NextResponse.json({ success: false, error: 'Invalid or expired code' });
    }
    // Issue a customer session JWT alongside the OK response. Old
    // clients ignore the extra field; new clients send it back as a
    // Bearer header on member-scoped calls. The session always
    // carries a non-null memberId now (provided findOrCreateMember
    // succeeded), so downstream /me/* calls don't need the loyalty-
    // service fallback to resolve the member.
    const member = await ensureMemberRow(phone);
    const sessionToken = signCustomerSession({ memberId: member?.id ?? null, phone });
    return NextResponse.json({ success: true, sessionToken, member });
  } catch {
    return NextResponse.json({ success: false, error: 'Verification failed' }, { status: 500 });
  }
}
