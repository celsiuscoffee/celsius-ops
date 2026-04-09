/**
 * POS auth module — re-exports from @celsius/auth (shared package).
 *
 * All auth logic now lives in packages/auth.
 * This file exists so any remaining @/lib/auth imports still resolve.
 */

export {
  // Types
  type SessionUser,
  type UserRole,
  AuthError,

  // Constants
  COOKIE_NAME,
  SESSION_MAX_AGE,

  // JWT
  createToken,
  verifyToken,

  // Session
  createSession,
  getSession,
  clearSession,

  // Password
  hashPassword,
  verifyPassword,

  // PIN
  hashPin,
  verifyPin,

  // Auth helpers
  getUserFromHeaders,
  getUserFromCookie,
  getUser,
  requireRole,
  requireAuth,
} from "@celsius/auth";
