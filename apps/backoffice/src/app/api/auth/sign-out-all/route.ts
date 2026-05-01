import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { clearSession, requireAuth } from "@/lib/auth";

// "Sign out all my sessions" — bumps User.tokenRevokedAt to NOW so any
// JWT issued before this timestamp 401s on routes that use
// verifyTokenWithFreshness from @celsius/auth. Useful when a user
// suspects their cookie was stolen (e.g. left their laptop unlocked).
//
// Also clears THIS session's cookie. The user is logged out of every
// device on next request from any of them.
//
// Note: routes that still use the basic verifyToken (most of them
// today) won't see the revocation. That's by design — those routes
// trust the cookie until expiry. Migrate the most sensitive routes
// (password change, member PII view, payment endpoints) to
// verifyTokenWithFreshness as you tighten security.
export async function POST(req: NextRequest) {
  const auth = await requireAuth(req);
  if (auth.error) return auth.error;

  await prisma.user.update({
    where: { id: auth.user.id },
    data: { tokenRevokedAt: new Date() },
  });

  await clearSession();

  return NextResponse.json({ ok: true, revokedAt: new Date().toISOString() });
}
