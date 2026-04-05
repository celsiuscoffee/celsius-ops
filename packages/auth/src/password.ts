/**
 * @celsius/auth — Password hashing (scrypt)
 *
 * Uses Node.js built-in crypto for zero external dependencies.
 * Stores as "salt:hash" format (hex-encoded).
 *
 * Also supports verifying bcrypt hashes (from legacy loyalty/POS data)
 * for forward compatibility during migration.
 */

import { randomBytes, scryptSync, timingSafeEqual } from "crypto";
import bcrypt from "bcryptjs";

/**
 * Hash a password using scrypt (primary method).
 * Returns "salt:hash" format.
 */
export function hashPassword(password: string): string {
  const salt = randomBytes(16).toString("hex");
  const hash = scryptSync(password, salt, 64).toString("hex");
  return `${salt}:${hash}`;
}

/**
 * Verify a password against a stored hash.
 * Accepts both scrypt ("salt:hash") and bcrypt ("$2...") formats.
 */
export async function verifyPassword(
  password: string,
  stored: string,
): Promise<boolean> {
  // Detect bcrypt hash (from legacy loyalty data)
  if (stored.startsWith("$2")) {
    return bcrypt.compare(password, stored);
  }

  // scrypt format: "salt:hash"
  const [salt, hash] = stored.split(":");
  if (!salt || !hash) return false;
  const hashBuffer = Buffer.from(hash, "hex");
  const derivedKey = scryptSync(password, salt, 64);
  return timingSafeEqual(hashBuffer, derivedKey);
}
