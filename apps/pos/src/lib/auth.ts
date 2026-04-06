/**
 * Re-export from @celsius/auth — single source of truth for all auth logic.
 */
export {
  type SessionUser,
  type UserRole,
  AuthError,
  COOKIE_NAME,
  SESSION_MAX_AGE,
  createToken,
  verifyToken,
  createSession,
  getSession,
  clearSession,
  getUserFromHeaders,
  getUserFromCookie,
  getUser,
  requireRole,
  requireAuth,
  hashPin,
  verifyPin,
  hashPassword,
  verifyPassword,
} from "@celsius/auth";
