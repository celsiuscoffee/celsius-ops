import { NextRequest, NextResponse } from 'next/server';
import { verifyOTP } from '@/lib/otp';
import { checkRateLimit, RATE_LIMITS } from '@/lib/rate-limit';

export async function POST(request: NextRequest) {
  try {
    const { phone, code, purpose } = await request.json();

    if (!phone || !code) {
      return NextResponse.json({ success: false, error: 'phone and code required' }, { status: 400 });
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
