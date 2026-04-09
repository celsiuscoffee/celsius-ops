// ==========================================
// Rate Limiting (in-memory)
// Simple per-process rate limiter
// ==========================================

export interface RateLimitConfig {
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
 *
 * Simple overload (backoffice/staff style):
 *   checkRateLimit(key, maxAttempts?, windowMs?)
 *
 * Config overload (loyalty/order style):
 *   checkRateLimit(identifier, config)
 */
export function checkRateLimit(
  key: string,
  maxAttempts?: number,
  windowMs?: number,
): { limited: boolean; remaining: number; retryAfterMs: number };
export function checkRateLimit(
  identifier: string,
  config: RateLimitConfig,
): { allowed: boolean; remaining: number; retryAfter?: number };
export function checkRateLimit(
  keyOrId: string,
  configOrMax?: RateLimitConfig | number,
  windowMs?: number,
):
  | { limited: boolean; remaining: number; retryAfterMs: number }
  | { allowed: boolean; remaining: number; retryAfter?: number } {
  // Config-based overload
  if (typeof configOrMax === "object") {
    return checkRateLimitConfig(keyOrId, configOrMax);
  }
  // Simple overload
  return checkRateLimitSimple(keyOrId, configOrMax ?? 5, windowMs ?? 60_000);
}

// ─── Simple rate limiter (backoffice/staff) ─────────────────

const simpleAttempts = new Map<string, { count: number; resetAt: number }>();

// Clean up expired entries periodically
if (typeof setInterval !== "undefined") {
  setInterval(() => {
    const now = Date.now();
    for (const [key, val] of simpleAttempts) {
      if (now > val.resetAt) simpleAttempts.delete(key);
    }
  }, 60_000);
}

function checkRateLimitSimple(
  key: string,
  maxAttempts: number,
  windowMs: number,
): { limited: boolean; remaining: number; retryAfterMs: number } {
  const now = Date.now();
  const entry = simpleAttempts.get(key);

  if (!entry || now > entry.resetAt) {
    simpleAttempts.set(key, { count: 1, resetAt: now + windowMs });
    return { limited: false, remaining: maxAttempts - 1, retryAfterMs: 0 };
  }

  entry.count++;
  if (entry.count > maxAttempts) {
    return {
      limited: true,
      remaining: 0,
      retryAfterMs: entry.resetAt - now,
    };
  }

  return { limited: false, remaining: maxAttempts - entry.count, retryAfterMs: 0 };
}

// ─── Config-based rate limiter (loyalty/order) ──────────────

function checkRateLimitConfig(
  identifier: string,
  config: RateLimitConfig,
): { allowed: boolean; remaining: number; retryAfter?: number } {
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
    prefix: "otp-send",
    maxAttempts: 5,
    windowSeconds: 300, // 5 per 5 minutes
  },
  OTP_VERIFY: {
    prefix: "otp-verify",
    maxAttempts: 10,
    windowSeconds: 300, // 10 per 5 minutes
  },
  ADMIN_LOGIN: {
    prefix: "admin-login",
    maxAttempts: 10,
    windowSeconds: 900, // 10 per 15 minutes
  },
  STAFF_PIN: {
    prefix: "staff-pin",
    maxAttempts: 5,
    windowSeconds: 300, // 5 per 5 minutes
  },
  SMS_BLAST: {
    prefix: "sms-blast",
    maxAttempts: 5,
    windowSeconds: 3600, // 5 per hour
  },
  PROFILE_UPDATE: {
    prefix: "profile-update",
    maxAttempts: 10,
    windowSeconds: 600, // 10 per 10 minutes
  },
  PHONE_LOOKUP: {
    prefix: "phone-lookup",
    maxAttempts: 20,
    windowSeconds: 300, // 20 per 5 minutes
  },
  MEMBER_CREATE: {
    prefix: "member-create",
    maxAttempts: 3,
    windowSeconds: 3600, // 3 per hour per phone
  },
} as const;
