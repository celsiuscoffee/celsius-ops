/**
 * @celsius/auth — Unified authentication for all Celsius apps
 *
 * Single source of truth for:
 * - JWT token creation/verification
 * - Session management (cookie-based, cross-subdomain)
 * - Password hashing (scrypt, with bcrypt migration support)
 * - PIN hashing (bcrypt, with plaintext migration support)
 * - Auth requirement helpers for API routes
 */

// Types
export { type SessionUser, type UserRole, AuthError } from "./types";

// Constants
export { COOKIE_NAME, SESSION_MAX_AGE } from "./constants";

// JWT
export { createToken, verifyToken } from "./jwt";

// Session (requires next/headers — use in Server Components / Route Handlers)
export { createSession, getSession, clearSession } from "./session";

// Password
export { hashPassword, verifyPassword } from "./password";

// PIN
export { hashPin, verifyPin } from "./pin";

// Auth helpers for API routes
export {
  getUserFromHeaders,
  getUserFromCookie,
  getUser,
  requireRole,
  requireAuth,
} from "./require-auth";
