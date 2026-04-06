import { NextRequest, NextResponse } from 'next/server';
import { sendOTP } from '@/lib/otp';
import { checkRateLimit, RATE_LIMITS } from '@/lib/rate-limit';
import { z } from 'zod';

const schema = z.object({
  phone: z.string().min(1, 'phone required').max(20),
  purpose: z.enum(['login', 'redeem']).optional(),
});

export async function POST(request: NextRequest) {
  try {
    const parsed = schema.safeParse(await request.json());
    if (!parsed.success) {
      return NextResponse.json({ success: false, error: parsed.error.issues[0]?.message }, { status: 400 });
    }
    const { phone, purpose } = parsed.data;

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
