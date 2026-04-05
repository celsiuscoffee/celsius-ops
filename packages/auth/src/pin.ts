/**
 * @celsius/auth — PIN hashing (bcrypt)
 *
 * PINs are 4-6 digits. Uses bcrypt with 10 rounds.
 * Supports progressive migration from plaintext PINs.
 */

import bcrypt from "bcryptjs";

const BCRYPT_ROUNDS = 10;

/**
 * Hash a PIN using bcrypt.
 */
export async function hashPin(pin: string): Promise<string> {
  return bcrypt.hash(pin.trim(), BCRYPT_ROUNDS);
}

/**
 * Verify a PIN against a stored value.
 * Handles three cases:
 * 1. Bcrypt hash ($2...) — proper comparison
 * 2. Plaintext (legacy) — direct comparison, returns { match, needsRehash: true }
 * 3. Empty/null — always fails
 */
export async function verifyPin(
  pin: string,
  stored: string | null | undefined,
): Promise<{ match: boolean; needsRehash: boolean }> {
  if (!stored) return { match: false, needsRehash: false };

  const trimmedPin = pin.trim();

  // Bcrypt hash
  if (stored.startsWith("$2")) {
    const match = await bcrypt.compare(trimmedPin, stored);
    return { match, needsRehash: false };
  }

  // Plaintext (legacy) — needs migration
  const match = stored === trimmedPin;
  return { match, needsRehash: match }; // only flag rehash if it actually matched
}
