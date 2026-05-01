// ==========================================
// Rate Limiting — Upstash Redis + in-memory fallback
// ==========================================
//
// On Vercel serverless every lambda instance has its own memory, so a
// pure in-memory limiter gives `maxAttempts × N warm instances` total
// before tripping. That's broken once you have any traffic.
//
// This module routes through Upstash Redis (HTTP REST) when the
// UPSTASH_REDIS_REST_URL + UPSTASH_REDIS_REST_TOKEN env vars are set
// — gives a single shared counter across every instance + edge node.
//
// When those env vars are NOT set (local dev, preview without Upstash
// configured) we fall back to the legacy in-memory Map. The fallback
// logs a warning the first time it's hit so you know.
//
// Public API is async (Upstash is HTTP). Both legacy overloads kept.

export interface RateLimitConfig {
  /** Unique key prefix (e.g., 'otp-send', 'login') */
  prefix: string;
  /** Max attempts allowed in the window */
  maxAttempts: number;
  /** Window duration in seconds */
  windowSeconds: number;
}

// ─── Upstash REST helper ──────────────────────────────

const UPSTASH_URL = process.env.UPSTASH_REDIS_REST_URL?.replace(/\/$/, "");
const UPSTASH_TOKEN = process.env.UPSTASH_REDIS_REST_TOKEN;
const HAS_UPSTASH = !!(UPSTASH_URL && UPSTASH_TOKEN);

let warnedNoUpstash = false;
function warnFallback() {
  if (warnedNoUpstash) return;
  warnedNoUpstash = true;
  if (typeof process !== "undefined" && process.env.NODE_ENV === "production") {
    // Loud in prod — running prod without Upstash means rate limits are
    // not enforced across instances.
    console.error(
      "[rate-limit] WARNING: UPSTASH_REDIS_REST_URL not set in production — rate limit is in-memory per process and will not enforce across serverless instances. Set Upstash env vars to fix.",
    );
  }
}

/**
 * Atomic INCR + EXPIRE via Upstash REST pipeline.
 * Returns the post-increment counter value, or null on transport failure
 * (fail open — degrade gracefully rather than block legitimate users
 * when Upstash itself is down).
 */
async function upstashIncrWithExpire(key: string, ttlSeconds: number): Promise<number | null> {
  if (!HAS_UPSTASH) return null;
  try {
    const res = await fetch(`${UPSTASH_URL}/pipeline`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${UPSTASH_TOKEN}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify([
        ["INCR", key],
        ["EXPIRE", key, String(ttlSeconds), "NX"],
      ]),
      // Don't blow up the request budget on a slow Upstash response.
      signal: AbortSignal.timeout(2000),
    });
    if (!res.ok) return null;
    const data = (await res.json()) as Array<{ result?: number; error?: string }>;
    if (!Array.isArray(data) || data.length === 0) return null;
    const counter = data[0]?.result;
    return typeof counter === "number" ? counter : null;
  } catch {
    return null;
  }
}

// ─── Public API: two overloads (legacy compat) ──────

export function checkRateLimit(
  key: string,
  maxAttempts?: number,
  windowMs?: number,
): Promise<{ limited: boolean; remaining: number; retryAfterMs: number }>;
export function checkRateLimit(
  identifier: string,
  config: RateLimitConfig,
): Promise<{ allowed: boolean; remaining: number; retryAfter?: number }>;
export async function checkRateLimit(
  keyOrId: string,
  configOrMax?: RateLimitConfig | number,
  windowMs?: number,
): Promise<
  | { limited: boolean; remaining: number; retryAfterMs: number }
  | { allowed: boolean; remaining: number; retryAfter?: number }
> {
  if (typeof configOrMax === "object") {
    return checkRateLimitConfig(keyOrId, configOrMax);
  }
  return checkRateLimitSimple(keyOrId, configOrMax ?? 5, windowMs ?? 60_000);
}

// ─── Simple rate limiter (backoffice/staff) ─────────────────

const simpleAttempts = new Map<string, { count: number; resetAt: number }>();

if (typeof setInterval !== "undefined") {
  setInterval(() => {
    const now = Date.now();
    for (const [key, val] of simpleAttempts) {
      if (now > val.resetAt) simpleAttempts.delete(key);
    }
  }, 60_000);
}

async function checkRateLimitSimple(
  key: string,
  maxAttempts: number,
  windowMs: number,
): Promise<{ limited: boolean; remaining: number; retryAfterMs: number }> {
  // Try Upstash first
  if (HAS_UPSTASH) {
    const ttlSeconds = Math.ceil(windowMs / 1000);
    const counter = await upstashIncrWithExpire(`rl:simple:${key}`, ttlSeconds);
    if (counter != null) {
      const remaining = Math.max(0, maxAttempts - counter);
      const limited = counter > maxAttempts;
      return { limited, remaining, retryAfterMs: limited ? windowMs : 0 };
    }
    // Upstash transport failed — fall through to in-memory
  } else {
    warnFallback();
  }

  // In-memory fallback
  const now = Date.now();
  const entry = simpleAttempts.get(key);
  if (!entry || now > entry.resetAt) {
    simpleAttempts.set(key, { count: 1, resetAt: now + windowMs });
    return { limited: false, remaining: maxAttempts - 1, retryAfterMs: 0 };
  }
  entry.count++;
  if (entry.count > maxAttempts) {
    return { limited: true, remaining: 0, retryAfterMs: entry.resetAt - now };
  }
  return { limited: false, remaining: maxAttempts - entry.count, retryAfterMs: 0 };
}

// ─── Config-based rate limiter (loyalty/order) ──────────────

const configAttempts = new Map<string, number[]>();

async function checkRateLimitConfig(
  identifier: string,
  config: RateLimitConfig,
): Promise<{ allowed: boolean; remaining: number; retryAfter?: number }> {
  const key = `${config.prefix}:${identifier}`;

  if (HAS_UPSTASH) {
    const counter = await upstashIncrWithExpire(`rl:cfg:${key}`, config.windowSeconds);
    if (counter != null) {
      const allowed = counter <= config.maxAttempts;
      return {
        allowed,
        remaining: Math.max(0, config.maxAttempts - counter),
        ...(allowed ? {} : { retryAfter: config.windowSeconds }),
      };
    }
  } else {
    warnFallback();
  }

  // In-memory fallback (sliding window)
  const now = Date.now();
  const windowStart = now - config.windowSeconds * 1000;
  const timestamps = (configAttempts.get(key) || []).filter((t) => t > windowStart);

  if (timestamps.length >= config.maxAttempts) {
    configAttempts.set(key, timestamps);
    return { allowed: false, remaining: 0, retryAfter: config.windowSeconds };
  }
  timestamps.push(now);
  configAttempts.set(key, timestamps);
  return { allowed: true, remaining: Math.max(0, config.maxAttempts - timestamps.length) };
}

// ─── Predefined rate limit configs ────────────────────

export const RATE_LIMITS = {
  OTP_SEND: { prefix: "otp-send", maxAttempts: 5, windowSeconds: 300 },
  OTP_VERIFY: { prefix: "otp-verify", maxAttempts: 10, windowSeconds: 300 },
  ADMIN_LOGIN: { prefix: "admin-login", maxAttempts: 10, windowSeconds: 900 },
  STAFF_PIN: { prefix: "staff-pin", maxAttempts: 5, windowSeconds: 300 },
  SMS_BLAST: { prefix: "sms-blast", maxAttempts: 5, windowSeconds: 3600 },
  PROFILE_UPDATE: { prefix: "profile-update", maxAttempts: 10, windowSeconds: 600 },
  PHONE_LOOKUP: { prefix: "phone-lookup", maxAttempts: 20, windowSeconds: 300 },
  MEMBER_CREATE: { prefix: "member-create", maxAttempts: 3, windowSeconds: 3600 },
  ACCOUNT_DELETE: { prefix: "account-delete", maxAttempts: 3, windowSeconds: 3600 },
  ORDER_CREATE: { prefix: "order-create", maxAttempts: 10, windowSeconds: 60 },
  PAYMENT_CREATE: { prefix: "payment-create", maxAttempts: 20, windowSeconds: 60 },
} as const;
