/**
 * Re-export from @celsius/auth — single source of truth for all auth logic.
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
} from "@celsius/auth";
