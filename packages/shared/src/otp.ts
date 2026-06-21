// ==========================================
// OTP (One-Time Password) Utilities
// Generates, stores, and verifies OTP codes
// Uses Supabase for persistent storage (required for Vercel serverless)
// ==========================================

// Node-only `crypto` imports — required for OTP generation +
// constant-time comparison. The `node:` protocol prefix tells
// Next.js / Turbopack to treat these as native Node built-ins
// and not bundle them for the Edge/browser runtimes (which is what
// triggers "Ecmascript file had an error" when the chain reaches
// middleware via packages/shared/src/index.ts).
import { timingSafeEqual, randomInt } from 'node:crypto';
import { sendSMS, resolveSmsProvider, providerAutoPrependsSender } from './sms';
import type { SupabaseClient } from '@supabase/supabase-js';

/**
 * Generate a random 6-digit OTP code
 */
export function generateOTP(): string {
  return String(randomInt(100000, 999999));
}

// Reviewer test account for App Store / Play Store review submissions.
// SMS to this phone is suppressed; the static code below always verifies.
// Document the same phone+code in App Store Connect / Play Console review notes.
const REVIEWER_PHONE = '60111111111';
const REVIEWER_OTP = '424242';

function isReviewerPhone(normalizedPhone: string): boolean {
  return normalizedPhone === REVIEWER_PHONE;
}

/**
 * Normalize phone number for consistent storage.
 * Strips spaces, dashes, and converts to 60XXXXXXXXX format.
 */
function normalizePhone(phone: string): string {
  let cleaned = phone.replace(/[\s\-()]/g, '');
  if (cleaned.startsWith('+60')) return cleaned.slice(1); // +60 → 60
  if (cleaned.startsWith('60')) return cleaned;
  if (cleaned.startsWith('0')) return `60${cleaned.slice(1)}`;
  return cleaned;
}

/**
 * Send OTP to a phone number
 * Stores the OTP in Supabase otp_codes table for persistence across serverless instances
 */
export async function sendOTP(
  supabaseAdmin: SupabaseClient,
  phone: string,
  purpose: 'login' | 'redeem' = 'login',
) {
  const normalizedPhone = normalizePhone(phone);

  // Reviewer fast-path: skip SMS, OTP is verified statically.
  if (isReviewerPhone(normalizedPhone)) {
    return { success: true, expiresAt: Date.now() + 5 * 60 * 1000 };
  }

  const code = generateOTP();
  const expiresAt = new Date(Date.now() + 5 * 60 * 1000); // 5 minutes from now

  // Delete any existing unused OTP for this phone+purpose
  await supabaseAdmin
    .from('otp_codes')
    .delete()
    .eq('phone', normalizedPhone)
    .eq('purpose', purpose)
    .eq('verified', false);

  // Store OTP in Supabase
  const { error: insertError } = await supabaseAdmin
    .from('otp_codes')
    .insert({
      phone: normalizedPhone,
      code,
      purpose,
      expires_at: expiresAt.toISOString(),
    });

  if (insertError) {
    console.error('Failed to store OTP:', insertError.message);
    return { success: false, error: 'Failed to store OTP' };
  }

  // Resolve the active gateway (app_settings toggle → env fallback). SMS123
  // needs the "RM0 [CelsiusCoffee]" prefix to match approved templates; SMS
  // Niaga prepends its own "RM0 <SenderID>:" at the gateway, so omit ours there
  // to avoid a double prefix.
  const provider = await resolveSmsProvider(supabaseAdmin);
  const prefix = providerAutoPrependsSender(provider) ? '' : 'RM0 [CelsiusCoffee] ';
  const message = purpose === 'login'
    ? `${prefix}Your Celsius Coffee verification code is: ${code}. Valid for 5 minutes.`
    : `${prefix}Your Celsius Coffee redemption code is: ${code}. Valid for 5 minutes.`;

  const result = await sendSMS(normalizedPhone, message, { provider });

  return {
    success: result.success,
    expiresAt: expiresAt.getTime(),
    // Only expose code in local dev with explicit flag (never in production/staging)
    ...(process.env.NODE_ENV === 'development' && process.env.EXPOSE_OTP === 'true'
      ? { _dev_code: code }
      : {}),
  };
}

/**
 * Verify an OTP code
 * Checks against Supabase otp_codes table for the matching phone+purpose
 */
export async function verifyOTP(
  supabaseAdmin: SupabaseClient,
  phone: string,
  code: string,
  purpose: 'login' | 'redeem' = 'login',
): Promise<boolean> {
  // Basic validation: must be a 6-digit code
  if (!/^\d{6}$/.test(code)) return false;

  const normalizedPhone = normalizePhone(phone);

  // Reviewer fast-path: static OTP for App Store / Play Store reviewers.
  if (isReviewerPhone(normalizedPhone)) {
    return timingSafeEqual(Buffer.from(code), Buffer.from(REVIEWER_OTP));
  }

  // Find the latest unused OTP for this phone+purpose that hasn't expired
  const { data, error } = await supabaseAdmin
    .from('otp_codes')
    .select('*')
    .eq('phone', normalizedPhone)
    .eq('purpose', purpose)
    .eq('verified', false)
    .gte('expires_at', new Date().toISOString())
    .order('created_at', { ascending: false })
    .limit(1)
    .single();

  if (error || !data) {
    console.log('OTP verify: no valid OTP found for', normalizedPhone, purpose, error?.message);
    return false;
  }

  // Check if the code matches
  if (!timingSafeEqual(Buffer.from(data.code), Buffer.from(code))) {
    console.log('OTP verify: code mismatch for', normalizedPhone);
    return false;
  }

  // Mark OTP as verified so it can't be reused
  await supabaseAdmin
    .from('otp_codes')
    .update({ verified: true })
    .eq('id', data.id);

  return true;
}
