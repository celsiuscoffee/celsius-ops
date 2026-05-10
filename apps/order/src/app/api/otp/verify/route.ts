import { NextRequest, NextResponse } from 'next/server';
import { verifyOTP } from '@/lib/otp';
import { checkRateLimit, RATE_LIMITS } from '@/lib/rate-limit';

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
        return NextResponse.json({ success: true });
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
    return NextResponse.json({ success: valid, error: valid ? undefined : 'Invalid or expired code' });
  } catch {
    return NextResponse.json({ success: false, error: 'Verification failed' }, { status: 500 });
  }
}
