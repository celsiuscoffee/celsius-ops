import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getUserFromHeaders } from "@/lib/auth";
import { hasAccess } from "@/lib/access";
import type { SessionUser } from "@celsius/auth";

type GuardOk = { ok: true; session: SessionUser; moduleAccess: Record<string, unknown> };
type GuardErr = { ok: false; response: NextResponse };

// Server-side module-access guard for Phase 8 endpoints (and any new
// route that wants DB-backed RBAC).
//
// Reads the user's `moduleAccess` JSON column from Postgres rather than
// trusting only the session/JWT — the JWT today doesn't carry
// moduleAccess, and even when it does, fresh DB reads catch revocations
// that happen mid-token-lifetime.
//
// Returns either { ok: true, session, moduleAccess } so the caller can
// use the session.id / moduleAccess for further checks, or { ok: false,
// response } with a 401/403 to return directly.
export async function checkModuleAccess(
  req: Request,
  moduleKey: string,
): Promise<GuardOk | GuardErr> {
  const session = await getUserFromHeaders(req.headers);
  if (!session) {
    return {
      ok: false,
      response: NextResponse.json({ error: "Unauthorized" }, { status: 401 }),
    };
  }

  // OWNER + ADMIN bypass module checks (same as client `hasAccess`).
  if (session.role === "OWNER" || session.role === "ADMIN") {
    return { ok: true, session, moduleAccess: {} };
  }

  const user = await prisma.user.findUnique({
    where: { id: session.id },
    select: { moduleAccess: true, role: true },
  });
  if (!user) {
    return {
      ok: false,
      response: NextResponse.json({ error: "Unauthorized" }, { status: 401 }),
    };
  }

  // `moduleAccess` is JSON in Postgres — defensively coerce to object.
  const access = (user.moduleAccess ?? {}) as Record<string, unknown>;
  const granted = hasAccess(session.role, access, moduleKey);
  if (!granted) {
    return {
      ok: false,
      response: NextResponse.json(
        { error: `Access denied: ${moduleKey}` },
        { status: 403 },
      ),
    };
  }

  return { ok: true, session, moduleAccess: access };
}

// Helper for endpoints that need to additionally check "manager-or-higher"
// on top of the module key (e.g. PO approve/send, Payment Request flow).
export function isManagerRole(role: string | undefined | null): boolean {
  return role === "OWNER" || role === "ADMIN" || role === "MANAGER";
}
