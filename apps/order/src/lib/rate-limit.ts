// ==========================================
// Rate Limiting (Supabase-backed)
// Works across serverless instances
// ==========================================

import { supabaseAdmin } from './supabase';
import type { RateLimitConfig } from '@celsius/shared';

// Re-export configs from shared
export { RATE_LIMITS } from '@celsius/shared';
export type { RateLimitConfig } from '@celsius/shared';

/**
 * Check rate limit using Supabase.
 * This is a Supabase-backed implementation that works across serverless instances.
 * For in-memory rate limiting, use checkRateLimit from @celsius/shared directly.
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
