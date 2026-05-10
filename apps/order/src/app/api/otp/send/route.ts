import { NextRequest, NextResponse } from 'next/server';
import { sendOTP } from '@/lib/otp';
import { checkRateLimit, RATE_LIMITS } from '@/lib/rate-limit';

export async function POST(request: NextRequest) {
  try {
    const { phone, purpose } = await request.json();

    if (!phone) {
      return NextResponse.json({ success: false, error: 'phone required' }, { status: 400 });
    }

    // App Store / Play Store reviewer bypass — they cannot receive
    // a real Malaysian SMS. When the phone matches OTP_REVIEWER_PHONE
    // we no-op the send: verify will accept OTP_REVIEWER_CODE for the
    // same phone. Both env vars must be set; if either is missing,
    // this branch never fires (so prod is unaffected when not in use).
    const reviewerPhone = process.env.OTP_REVIEWER_PHONE;
    const reviewerCode  = process.env.OTP_REVIEWER_CODE;
    if (reviewerPhone && reviewerCode && phone === reviewerPhone) {
      return NextResponse.json({ success: true });
    }

    // Rate limit by phone number
    const rateCheck = await checkRateLimit(phone, RATE_LIMITS.OTP_SEND);
    if (!rateCheck.allowed) {
      return NextResponse.json(
        { success: false, error: `Too many OTP requests. Try again in ${Math.ceil((rateCheck.retryAfter || 300) / 60)} minutes.` },
        { status: 429 }
      );
    }

    const result = await sendOTP(phone, purpose || 'login');
    return NextResponse.json(result);
  } catch {
    return NextResponse.json({ success: false, error: 'Failed to send OTP' }, { status: 500 });
  }
}
