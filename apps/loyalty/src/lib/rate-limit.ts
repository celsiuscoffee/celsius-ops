// ==========================================
// Rate Limiting (Supabase-backed)
// Works across serverless instances
// ==========================================

import { supabaseAdmin } from './supabase';

interface RateLimitConfig {
  /** Unique key prefix (e.g., 'otp-send', 'login') */
  prefix: string;
  /** Max attempts allowed in the window */
  maxAttempts: number;
  /** Window duration in seconds */
  windowSeconds: number;
}

/**
 * Check rate limit using Supabase.
 * Uses the otp_codes table with a special purpose to track attempts,
 * or falls back to a simple time-based check.
 *
 * Returns { allowed: boolean, remaining: number, retryAfter?: number }
 */
export async function checkRateLimit(
  identifier: string,
  config: RateLimitConfig
): Promise<{ allowed: boolean; remaining: number; retryAfter?: number }> {
  if (!supabaseAdmin) {
    console.error('Rate limiter: supabaseAdmin not available');
    return { allowed: false, remaining: 0, retryAfter: 60 };
  }

  const key = `${config.prefix}:${identifier}`;
  const windowStart = new Date(Date.now() - config.windowSeconds * 1000).toISOString();

  try {
    // Count recent attempts
    const { count, error } = await supabaseAdmin
      .from('rate_limits')
      .select('*', { count: 'exact', head: true })
      .eq('key', key)
      .gte('created_at', windowStart);

    if (error) {
      console.error('Rate limiter DB error:', error.message);
      // Fail open only for table-not-found (first deploy); fail closed otherwise
      if (error.message?.includes('does not exist')) {
        return { allowed: true, remaining: config.maxAttempts };
      }
      return { allowed: false, remaining: 0, retryAfter: 60 };
    }

    const attempts = count || 0;
    const remaining = Math.max(0, config.maxAttempts - attempts);

    if (attempts >= config.maxAttempts) {
      return {
        allowed: false,
        remaining: 0,
        retryAfter: config.windowSeconds,
      };
    }

    // Record this attempt
    await supabaseAdmin.from('rate_limits').insert({
      key,
      created_at: new Date().toISOString(),
    });

    return { allowed: true, remaining: remaining - 1 };
  } catch (err) {
    console.error('Rate limiter exception:', err);
    return { allowed: false, remaining: 0, retryAfter: 60 };
  }
}

// ─── Predefined rate limit configs ────────────────────

export const RATE_LIMITS = {
  OTP_SEND: {
    prefix: 'otp-send',
    maxAttempts: 5,
    windowSeconds: 300, // 5 per 5 minutes
  },
  OTP_VERIFY: {
    prefix: 'otp-verify',
    maxAttempts: 10,
    windowSeconds: 300, // 10 per 5 minutes
  },
  ADMIN_LOGIN: {
    prefix: 'admin-login',
    maxAttempts: 10,
    windowSeconds: 900, // 10 per 15 minutes
  },
  STAFF_PIN: {
    prefix: 'staff-pin',
    maxAttempts: 5,
    windowSeconds: 300, // 5 per 5 minutes
  },
  SMS_BLAST: {
    prefix: 'sms-blast',
    maxAttempts: 5,
    windowSeconds: 3600, // 5 per hour
  },
  PROFILE_UPDATE: {
    prefix: 'profile-update',
    maxAttempts: 10,
    windowSeconds: 600, // 10 per 10 minutes
  },
  PHONE_LOOKUP: {
    prefix: 'phone-lookup',
    maxAttempts: 20,
    windowSeconds: 300, // 20 per 5 minutes
  },
  MEMBER_CREATE: {
    prefix: 'member-create',
    maxAttempts: 3,
    windowSeconds: 3600, // 3 per hour per phone
  },
} as const;
