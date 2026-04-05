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
};

export class AuthError extends Error {
  status: number;
  constructor(message: string, status: number) {
    super(message);
    this.name = "AuthError";
    this.status = status;
  }
}
