/**
 * @celsius/auth — Shared types
 */

export type UserRole = "OWNER" | "ADMIN" | "MANAGER" | "STAFF";

export type SessionUser = {
  id: string;
  name: string;
  role: UserRole;
  outletId: string | null;
  outletName?: string | null;
  /**
   * The PIN on this account was set by somebody else and has not been
   * replaced yet. Carried IN THE TOKEN rather than read per request: the
   * only thing that clears it is /api/auth/change-pin, which re-issues the
   * session, so the token can never be stale in the direction that matters
   * (a cleared flag still showing as set would lock someone out).
   * Optional, so sessions minted before this existed stay valid.
   */
  mustChangePin?: boolean;
};

export class AuthError extends Error {
  status: number;
  constructor(message: string, status: number) {
    super(message);
    this.name = "AuthError";
    this.status = status;
  }
}
