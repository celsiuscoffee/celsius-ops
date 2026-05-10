import { NextRequest, NextResponse } from 'next/server';
import { verifyOTP } from '@/lib/otp';
import { checkRateLimit, RATE_LIMITS } from '@/lib/rate-limit';
import { signCustomerSession } from '@/lib/customer-jwt';
import { getSupabaseAdmin } from '@/lib/supabase/server';

// Look up the member_id (if any) so the issued session token carries it.
// Pre-first-order phones won't have a row yet — sub stays empty and is
// filled in on a follow-up verify after the first order.
async function lookupMemberId(phone: string): Promise<string | null> {
  try {
    const sb = getSupabaseAdmin();
    const { data } = await sb
      .from('members')
      .select('id')
      .eq('phone', phone)
      .maybeSingle();
    return (data as { id?: string } | null)?.id ?? null;
  } catch {
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
        const memberId = await lookupMemberId(phone);
        const sessionToken = signCustomerSession({ memberId, phone });
        return NextResponse.json({ success: true, sessionToken });
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
    // Bearer header on member-scoped calls.
    const memberId = await lookupMemberId(phone);
    const sessionToken = signCustomerSession({ memberId, phone });
    return NextResponse.json({ success: true, sessionToken });
  } catch {
    return NextResponse.json({ success: false, error: 'Verification failed' }, { status: 500 });
  }
}
