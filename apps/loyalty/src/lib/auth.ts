// ==========================================
// Authentication & Authorization
// JWT-based admin auth with httpOnly cookies
// ==========================================

import { SignJWT, jwtVerify } from 'jose';
import { NextRequest, NextResponse } from 'next/server';
import bcrypt from 'bcryptjs';

if (!process.env.JWT_SECRET) {
  console.error('FATAL: JWT_SECRET environment variable is not set');
}
const JWT_SECRET = new TextEncoder().encode(
  process.env.JWT_SECRET || 'MISSING-JWT-SECRET-DO-NOT-USE'
);

const COOKIE_NAME = 'celsius-admin-token';
const ADMIN_TOKEN_EXPIRY = '24h';
const STAFF_TOKEN_EXPIRY = '8h';
const SALT_ROUNDS = 10;

// ─── JWT Token ────────────────────────────────────────

export async function createToken(payload: {
  id: string;
  email: string;
  name: string;
  role: string;
}): Promise<string> {
  const expiry = payload.role === 'staff' ? STAFF_TOKEN_EXPIRY : ADMIN_TOKEN_EXPIRY;
  return new SignJWT(payload)
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt()
    .setExpirationTime(expiry)
    .sign(JWT_SECRET);
}

export async function verifyToken(token: string): Promise<{
  id: string;
  email: string;
  name: string;
  role: string;
} | null> {
  try {
    const { payload } = await jwtVerify(token, JWT_SECRET);
    return payload as { id: string; email: string; name: string; role: string };
  } catch {
    return null;
  }
}

// ─── Cookie Helpers ───────────────────────────────────

export function setAuthCookie(response: NextResponse, token: string): NextResponse {
  response.cookies.set(COOKIE_NAME, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'strict',
    maxAge: 60 * 60 * 24, // 24 hours
    path: '/',
  });
  return response;
}

export function clearAuthCookie(response: NextResponse): NextResponse {
  response.cookies.set(COOKIE_NAME, '', {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'strict',
    maxAge: 0,
    path: '/',
  });
  return response;
}

// ─── Auth Middleware ──────────────────────────────────

/**
 * Verify admin auth from JWT cookie.
 * Returns the user payload if valid, or null if not.
 */
export async function getAuthUser(request: NextRequest): Promise<{
  id: string;
  email: string;
  name: string;
  role: string;
} | null> {
  const token = request.cookies.get(COOKIE_NAME)?.value;
  if (!token) return null;
  return verifyToken(token);
}

/**
 * Require admin auth. Returns error response if not authenticated.
 */
export async function requireAuth(request: NextRequest): Promise<
  | { user: { id: string; email: string; name: string; role: string }; error: null }
  | { user: null; error: NextResponse }
> {
  const user = await getAuthUser(request);
  if (!user) {
    return {
      user: null,
      error: NextResponse.json({ error: 'Unauthorized' }, { status: 401 }),
    };
  }
  return { user, error: null };
}

// ─── Password Hashing ────────────────────────────────

export async function hashPassword(password: string): Promise<string> {
  return bcrypt.hash(password, SALT_ROUNDS);
}

export async function verifyPassword(password: string, hash: string): Promise<boolean> {
  // Only accept bcrypt hashes — plaintext passwords no longer supported
  if (!hash.startsWith('$2')) {
    console.error('Rejected login: non-bcrypt password hash detected. Run migration to hash all passwords.');
    return false;
  }
  return bcrypt.compare(password, hash);
}

// ─── PIN Hashing ─────────────────────────────────────

export async function hashPin(pin: string): Promise<string> {
  return bcrypt.hash(pin, SALT_ROUNDS);
}

export async function verifyPin(pin: string, hash: string): Promise<boolean> {
  // Only accept bcrypt hashes — plaintext PINs no longer supported
  if (!hash.startsWith('$2')) {
    console.error('Rejected PIN: non-bcrypt pin_hash detected. Run migration to hash all PINs.');
    return false;
  }
  return bcrypt.compare(pin, hash);
}
