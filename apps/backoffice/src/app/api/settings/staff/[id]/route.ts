import { NextResponse, NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { getUserFromHeaders, hasModulePermission, type SessionUser } from "@/lib/auth";
import { clampGrantsToCaller } from "@/lib/staff-grants";
import { hashPassword } from "@/lib/password";
import { hashPin, verifyPin } from "@celsius/auth";
import { logActivity, diffFields } from "@/lib/activity-log";

// Authorise a staff-management action.
// ADMIN/OWNER → always allowed.
// MANAGER → allowed when the target is STAFF in any outlet inside the
//           manager's full scope (primary `outletId` ∪ multi-outlet
//           `outletIds`), the manager has the settings:staff module
//           permission, and any role change keeps the target as STAFF.
//
// The caller scope is loaded fresh from the DB rather than trusted from the
// JWT — sessions are minted with `outletId` only and don't carry `outletIds`,
// and a multi-outlet manager who's had their primary nulled would otherwise
// hit a stale-cookie "Out of scope" rejection.
async function authorizeStaffAction(
  caller: SessionUser,
  targetId: string,
  newRole?: string,
): Promise<{ ok: true; scope: Set<string> } | { ok: false; status: number; error: string }> {
  if (caller.role === "OWNER" || caller.role === "ADMIN") return { ok: true, scope: new Set() };
  if (caller.role !== "MANAGER") return { ok: false, status: 403, error: "Forbidden" };

  const target = await prisma.user.findUnique({ where: { id: targetId }, select: { role: true, outletId: true } });
  if (!target) return { ok: false, status: 404, error: "Not found" };
  if (target.role !== "STAFF") return { ok: false, status: 403, error: "Managers can only manage Staff" };

  const callerRow = await prisma.user.findUnique({
    where: { id: caller.id },
    select: { outletId: true, outletIds: true },
  });
  const scope = new Set<string>();
  if (callerRow?.outletId) scope.add(callerRow.outletId);
  for (const oid of callerRow?.outletIds ?? []) scope.add(oid);
  if (scope.size === 0) {
    // Manager with no outlets at all can't manage anyone.
    return { ok: false, status: 403, error: "No outlet assigned" };
  }
  if (!target.outletId || !scope.has(target.outletId)) {
    return { ok: false, status: 403, error: "Out of scope" };
  }
  if (newRole && newRole !== "STAFF") {
    return { ok: false, status: 403, error: "Managers cannot change role away from Staff" };
  }
  const allowed = await hasModulePermission(caller, "settings:staff", prisma);
  if (!allowed) return { ok: false, status: 403, error: "Forbidden" };
  return { ok: true, scope };
}

/** Check if a plaintext PIN is already used by another active staff at the same outlet */
async function checkDuplicatePin(pin: string, outletId: string | null, excludeUserId: string): Promise<string | null> {
  if (!outletId) return null;
  const others = await prisma.user.findMany({
    where: { pin: { not: null }, status: "ACTIVE", outletId, id: { not: excludeUserId } },
    select: { id: true, name: true, pin: true },
  });
  for (const u of others) {
    if (!u.pin) continue;
    const { match } = await verifyPin(pin, u.pin);
    if (match) return u.name;
  }
  return null;
}

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const caller = await getUserFromHeaders(req.headers);
  if (!caller) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = await params;
  let body;
  try {
    body = await req.json();
  } catch (e) {
    console.error('[staff PATCH] Body parse error:', e);
    return NextResponse.json({ error: 'Invalid request body' }, { status: 400 });
  }

  const authz = await authorizeStaffAction(caller, id, body?.role);
  if (!authz.ok) return NextResponse.json({ error: authz.error }, { status: authz.status });

  // Manager-scoped guards — primary outlet move + multi-outlet grant must stay
  // inside the manager's own scope. authz.scope is empty for OWNER/ADMIN; the
  // .size check skips the guards for them.
  if (caller.role === "MANAGER" && authz.scope.size > 0) {
    if (body.outletId !== undefined && body.outletId && !authz.scope.has(body.outletId)) {
      return NextResponse.json({ error: "Cannot move staff to an outlet outside your scope" }, { status: 403 });
    }
    if (Array.isArray(body.outletIds)) {
      const outOfScope = body.outletIds.filter((oid: string) => !authz.scope.has(oid));
      if (outOfScope.length > 0) {
        return NextResponse.json({ error: "Cannot grant access to outlets outside your scope" }, { status: 403 });
      }
    }
  }

  const data: Record<string, unknown> = {};

  // Basic fields
  if (body.name !== undefined) data.name = body.name;
  if (body.phone !== undefined) data.phone = body.phone;
  if (body.email !== undefined) data.email = body.email || null;
  if (body.role !== undefined) data.role = body.role;
  if (body.outletId !== undefined) data.outletId = body.outletId || null;
  if (body.outletIds !== undefined) data.outletIds = body.outletIds;
  if (body.username !== undefined) data.username = body.username || null;
  if (body.status !== undefined) data.status = body.status;
  // A manager can't grant a Staff member apps/modules they don't hold themselves.
  const grants = await clampGrantsToCaller(caller, body.appAccess, body.moduleAccess);
  if (grants.appAccess !== undefined) data.appAccess = grants.appAccess;
  if (grants.moduleAccess !== undefined) data.moduleAccess = grants.moduleAccess;

  // Password — hash before saving
  if (body.password && body.password.length >= 8) {
    data.passwordHash = hashPassword(body.password);
  }

  // PIN — check for duplicates at same outlet, then hash
  if (body.pin !== undefined) {
    if (body.pin) {
      // Resolve outlet: use the new outletId if being changed, else fetch current
      let resolvedOutletId = body.outletId;
      if (resolvedOutletId === undefined) {
        const existing = await prisma.user.findUnique({ where: { id }, select: { outletId: true } });
        resolvedOutletId = existing?.outletId ?? null;
      }
      const dupName = await checkDuplicatePin(body.pin, resolvedOutletId, id);
      if (dupName) {
        return NextResponse.json({ error: `PIN already used by ${dupName} at this outlet` }, { status: 409 });
      }
      data.pin = await hashPin(body.pin);
    } else {
      data.pin = null;
    }
  }

  try {
    // Ensure moduleAccess is valid JSON for Prisma
    if (data.moduleAccess !== undefined && typeof data.moduleAccess === 'object') {
      data.moduleAccess = JSON.parse(JSON.stringify(data.moduleAccess));
    }

    // Snapshot the audit-worthy fields before the update so we can diff
    // them after. PIN/password aren't logged as values — just whether they
    // were set/cleared — so a leaked log can't be replayed.
    const auditFields = ["name", "phone", "email", "role", "status", "outletId", "outletIds", "username", "appAccess", "moduleAccess"] as const;
    const before = await prisma.user.findUnique({
      where: { id },
      select: { name: true, phone: true, email: true, role: true, status: true, outletId: true, outletIds: true, username: true, appAccess: true, moduleAccess: true, pin: true, passwordHash: true },
    });

    const user = await prisma.user.update({
      where: { id },
      data: data as never,
    });

    // Write an audit row covering every field that actually changed. Best-
    // effort — failures inside logActivity don't fail the PATCH.
    if (before) {
      const fieldDiff = diffFields(before as Record<string, unknown>, data, [...auditFields]);
      const credChanges: Record<string, { from: unknown; to: unknown }> = {};
      if (data.pin !== undefined) credChanges.pin = { from: before.pin ? "(set)" : "(unset)", to: data.pin ? "(set)" : "(unset)" };
      if (data.passwordHash !== undefined) credChanges.password = { from: before.passwordHash ? "(set)" : "(unset)", to: "(set)" };
      const fullDiff = { ...fieldDiff, ...credChanges };
      if (Object.keys(fullDiff).length > 0) {
        await logActivity({
          actorId: caller.id,
          action: "user.update",
          module: "settings:staff",
          targetId: id,
          targetName: user.name ?? before.name ?? null,
          details: { changes: fullDiff },
          request: req,
        });
      }
    }

    return NextResponse.json({ ok: true, id: user.id });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    const stack = err instanceof Error ? err.stack : '';
    console.error('[staff PATCH] Error updating', id, ':', message, stack);
    const safeData = { ...data };
    delete safeData.passwordHash;
    delete safeData.pin;
    console.error('[staff PATCH] Data was:', JSON.stringify(safeData));
    if (message.includes("Unique constraint")) {
      if (message.includes("phone")) return NextResponse.json({ error: "Phone number already in use" }, { status: 409 });
      if (message.includes("username")) return NextResponse.json({ error: "Username already taken" }, { status: 409 });
      if (message.includes("email")) return NextResponse.json({ error: "Email already in use" }, { status: 409 });
      return NextResponse.json({ error: "Duplicate value" }, { status: 409 });
    }
    return NextResponse.json({ error: `Failed to update: ${message}` }, { status: 500 });
  }
}

export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const caller = await getUserFromHeaders(req.headers);
  if (!caller) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = await params;
  const authz = await authorizeStaffAction(caller, id);
  if (!authz.ok) return NextResponse.json({ error: authz.error }, { status: authz.status });

  const before = await prisma.user.findUnique({ where: { id }, select: { name: true, status: true } });
  await prisma.user.update({
    where: { id },
    data: { status: "DEACTIVATED" },
  });
  if (before) {
    await logActivity({
      actorId: caller.id,
      action: "user.deactivate",
      module: "settings:staff",
      targetId: id,
      targetName: before.name,
      details: { changes: { status: { from: before.status, to: "DEACTIVATED" } } },
      request: req,
    });
  }
  return NextResponse.json({ ok: true });
}
