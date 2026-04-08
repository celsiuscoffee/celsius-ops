/**
 * Simple in-memory rate limiter for auth endpoints.
 * Uses IP-based tracking with a sliding window.
 * Note: In a serverless environment, this resets per cold start.
 * For production, consider Redis-based rate limiting.
 */
const attempts = new Map<string, { count: number; resetAt: number }>();

// Clean up expired entries periodically
setInterval(() => {
  const now = Date.now();
  for (const [key, val] of attempts) {
    if (now > val.resetAt) attempts.delete(key);
  }
}, 60_000);

/**
 * Check if a request is rate-limited.
 * @param key - Unique identifier (e.g., IP + endpoint)
 * @param maxAttempts - Max attempts within the window
 * @param windowMs - Time window in milliseconds
 * @returns { limited: boolean, remaining: number, retryAfterMs: number }
 */
export function checkRateLimit(
  key: string,
  maxAttempts: number = 5,
  windowMs: number = 60_000
): { limited: boolean; remaining: number; retryAfterMs: number } {
  const now = Date.now();
  const entry = attempts.get(key);

  if (!entry || now > entry.resetAt) {
    attempts.set(key, { count: 1, resetAt: now + windowMs });
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
