import { NextRequest, NextResponse } from 'next/server';
import { sendOTP } from '@/lib/otp';
import { supabaseAdmin } from '@/lib/supabase';
import { checkRateLimit, RATE_LIMITS } from '@/lib/rate-limit';
import { z } from 'zod';

const schema = z.object({
  phone: z.string().min(1, 'phone required').max(20),
  purpose: z.enum(['login', 'redeem']).optional(),
});

// Phone normalization — try common Malaysian formats so a typo'd format
// still matches an existing member.
function phoneVariants(phone: string): string[] {
  const digits = phone.replace(/\D/g, '');
  const set = new Set<string>([phone]);
  if (digits.startsWith('60')) {
    set.add(`+${digits}`);
    set.add(digits);
    set.add(`0${digits.slice(2)}`);
  } else if (digits.startsWith('0')) {
    set.add(`+6${digits}`);
    set.add(`6${digits}`);
    set.add(digits);
  } else if (digits) {
    set.add(`+60${digits}`);
    set.add(`60${digits}`);
    set.add(`0${digits}`);
  }
  return [...set];
}

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

    // Member existence check — both login (rewards portal) and redeem
    // (staff tablet) flows expect the member to already exist. Without
    // this guard we'd burn SMS credits on every typo'd phone number.
    const { data: member } = await supabaseAdmin
      .from('members')
      .select('id')
      .in('phone', phoneVariants(phone))
      .maybeSingle();

    if (!member) {
      return NextResponse.json(
        { success: false, error: 'No Celsius Coffee account found for this number. Please register at the counter.' },
        { status: 404 }
      );
    }

    const result = await sendOTP(phone, purpose || 'login');
    return NextResponse.json(result);
  } catch {
    return NextResponse.json({ success: false, error: 'Failed to send OTP' }, { status: 500 });
  }
}
