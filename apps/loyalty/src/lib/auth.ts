/**
 * Re-export from @celsius/auth — single source of truth for all auth logic.
 * This thin wrapper keeps existing imports working without mass find-replace.
 */
export {
  type SessionUser,
  type UserRole,
  AuthError,
  COOKIE_NAME,
  createSession,
  getSession,
  clearSession,
  verifyToken,
  getUserFromHeaders,
  getUser,
  requireRole,
  requireAuth,
  hashPassword,
  verifyPassword,
  hashPin,
  verifyPin,
} from "@celsius/auth";
