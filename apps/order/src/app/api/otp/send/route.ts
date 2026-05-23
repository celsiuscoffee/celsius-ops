import { NextRequest, NextResponse } from 'next/server';
import { sendOTP } from '@/lib/otp';
import { checkRateLimit, RATE_LIMITS } from '@/lib/rate-limit';
import { supabaseAdmin } from '@/lib/supabase';

// Match every common stored shape — "+60123456789", "60123456789",
// "0123456789", "123456789" — so the returning-customer lookup
// doesn't miss a member who originally signed up with a slightly
// different format. Mirrors the variant logic used elsewhere.
function phoneVariants(raw: string): string[] {
  const digits = raw.replace(/[^0-9]/g, '');
  const local = digits.startsWith('60') ? digits.slice(2) : digits.replace(/^0+/, '');
  return Array.from(new Set([
    raw.trim(),
    digits,
    `+${digits}`,
    local,
    `0${local}`,
    `60${local}`,
    `+60${local}`,
  ].filter(Boolean)));
}

/** Returns true when the supplied phone matches a member with at
 *  least one post-payment order. Drives the UX hide on the OTP
 *  screen — referral code field disappears for returning members
 *  who would be rejected by attributeReferralOnSignup's `not_new`
 *  guard anyway. The server guard is the source of truth; this is
 *  pure UX polish. Fails safe to `false` (show the field) when the
 *  lookup errors. */
async function isReturningCustomer(phone: string): Promise<boolean> {
  try {
    const variants = phoneVariants(phone);
    if (variants.length === 0) return false;
    const { data: memberRows } = await supabaseAdmin
      .from('members')
      .select('id')
      .in('phone', variants)
      .limit(5);
    const memberIds = (memberRows ?? []).map((r) => r.id as string);
    if (memberIds.length === 0) return false;
    const { count } = await supabaseAdmin
      .from('orders')
      .select('id', { count: 'exact', head: true })
      .in('loyalty_id', memberIds)
      .in('status', ['preparing', 'ready', 'completed']);
    return (count ?? 0) > 0;
  } catch {
    return false;
  }
}

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
    // Reviewer accounts are always treated as "new" so the referral
    // field shows during App Store review walkthrough.
    const reviewerPhone = process.env.OTP_REVIEWER_PHONE;
    const reviewerCode  = process.env.OTP_REVIEWER_CODE;
    if (reviewerPhone && reviewerCode && phone === reviewerPhone) {
      return NextResponse.json({ success: true, is_new_member: true });
    }

    // Rate limit by phone number
    const rateCheck = await checkRateLimit(phone, RATE_LIMITS.OTP_SEND);
    if (!rateCheck.allowed) {
      return NextResponse.json(
        { success: false, error: `Too many OTP requests. Try again in ${Math.ceil((rateCheck.retryAfter || 300) / 60)} minutes.` },
        { status: 429 }
      );
    }

    // Probe whether the customer is returning in parallel with the
    // SMS dispatch so we don't add latency to the OTP send path.
    // is_new_member drives the OTP screen's referral-field visibility;
    // the actual security guard is server-side in
    // attributeReferralOnSignup.
    const [result, returning] = await Promise.all([
      sendOTP(phone, purpose || 'login'),
      isReturningCustomer(phone),
    ]);
    return NextResponse.json({ ...result, is_new_member: !returning });
  } catch {
    return NextResponse.json({ success: false, error: 'Failed to send OTP' }, { status: 500 });
  }
}
