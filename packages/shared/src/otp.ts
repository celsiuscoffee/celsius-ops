// ==========================================
// OTP (One-Time Password) Utilities
// Generates, stores, and verifies OTP codes
// Uses Supabase for persistent storage (required for Vercel serverless)
// ==========================================

import { timingSafeEqual, randomInt } from 'crypto';
import { sendSMS } from './sms';
import type { SupabaseClient } from '@supabase/supabase-js';

/**
 * Generate a random 6-digit OTP code
 */
export function generateOTP(): string {
  return String(randomInt(100000, 999999));
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
  const code = generateOTP();
  const normalizedPhone = normalizePhone(phone);
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

  // Send via SMS (must match approved SMS123 templates with RM0 prefix and [CelsiusCoffee] header)
  const message = purpose === 'login'
    ? `RM0 [CelsiusCoffee] Your Celsius Coffee verification code is: ${code}. Valid for 5 minutes.`
    : `RM0 [CelsiusCoffee] Your Celsius Coffee redemption code is: ${code}. Valid for 5 minutes.`;

  const result = await sendSMS(normalizedPhone, message);

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
