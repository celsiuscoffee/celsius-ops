// Constant-time string comparison for shared secrets (cron bearer, webhook
// secret tokens, partner client secrets).
//
// `a !== b` short-circuits at the first differing character, so the time a
// compare takes leaks how long a matching prefix an attacker has guessed.
// With 32+ char random secrets that is a negligible oracle over the internet,
// but the fix is free, so every secret compare goes through here.
//
// Pure JS on purpose: this package's barrel is imported by Edge middleware
// and client bundles, where node:crypto's timingSafeEqual is unavailable.
// Length still leaks (unavoidable without padding, and harmless: the secret's
// length is not what protects it).
export function safeEqual(a: string | null | undefined, b: string | null | undefined): boolean {
  if (typeof a !== "string" || typeof b !== "string") return false;
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}
