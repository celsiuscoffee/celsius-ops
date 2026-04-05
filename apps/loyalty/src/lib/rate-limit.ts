// ==========================================
// Rate Limiting (in-memory)
// Simple per-process rate limiter
// ==========================================

interface RateLimitConfig {
  /** Unique key prefix (e.g., 'otp-send', 'login') */
  prefix: string;
  /** Max attempts allowed in the window */
  maxAttempts: number;
  /** Window duration in seconds */
  windowSeconds: number;
}

/** In-memory store: key -> list of timestamps (ms) */
const attempts = new Map<string, number[]>();

/**
 * Check rate limit using in-memory Map.
 * Sufficient for single-instance deployments; swap to Redis for multi-instance.
 */
export async function checkRateLimit(
  identifier: string,
  config: RateLimitConfig
): Promise<{ allowed: boolean; remaining: number; retryAfter?: number }> {
  const key = `${config.prefix}:${identifier}`;
  const now = Date.now();
  const windowStart = now - config.windowSeconds * 1000;

  // Get existing timestamps and prune expired ones
  const timestamps = (attempts.get(key) || []).filter((t) => t > windowStart);

  if (timestamps.length >= config.maxAttempts) {
    attempts.set(key, timestamps);
    return {
      allowed: false,
      remaining: 0,
      retryAfter: config.windowSeconds,
    };
  }

  // Record this attempt
  timestamps.push(now);
  attempts.set(key, timestamps);

  return {
    allowed: true,
    remaining: Math.max(0, config.maxAttempts - timestamps.length),
  };
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
