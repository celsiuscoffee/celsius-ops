import { NextResponse, NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { getUserFromHeaders, hasModulePermission, type SessionUser } from "@/lib/auth";
import { hashPassword } from "@/lib/password";
import { hashPin, verifyPin } from "@celsius/auth";

// Authorise a staff-management action.
// ADMIN/OWNER → always allowed.
// MANAGER → allowed only when the target user is STAFF in the manager's outlet,
//           the manager has settings:staff module permission, and any role change
//           keeps the target as STAFF.
async function authorizeStaffAction(
  caller: SessionUser,
  targetId: string,
  newRole?: string,
): Promise<{ ok: true } | { ok: false; status: number; error: string }> {
  if (caller.role === "OWNER" || caller.role === "ADMIN") return { ok: true };
  if (caller.role !== "MANAGER") return { ok: false, status: 403, error: "Forbidden" };

  const target = await prisma.user.findUnique({ where: { id: targetId }, select: { role: true, outletId: true } });
  if (!target) return { ok: false, status: 404, error: "Not found" };
  if (target.role !== "STAFF") return { ok: false, status: 403, error: "Managers can only manage Staff" };
  if (caller.outletId && target.outletId !== caller.outletId) {
    return { ok: false, status: 403, error: "Out of scope" };
  }
  if (newRole && newRole !== "STAFF") {
    return { ok: false, status: 403, error: "Managers cannot change role away from Staff" };
  }
  const allowed = await hasModulePermission(caller, "settings:staff", prisma);
  if (!allowed) return { ok: false, status: 403, error: "Forbidden" };
  return { ok: true };
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

  // Manager cannot move a staff member out of their own outlet
  if (caller.role === "MANAGER" && body.outletId !== undefined && caller.outletId && body.outletId !== caller.outletId) {
    return NextResponse.json({ error: "Managers cannot move staff to another outlet" }, { status: 403 });
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
  if (body.appAccess !== undefined) data.appAccess = body.appAccess;
  if (body.moduleAccess !== undefined) data.moduleAccess = body.moduleAccess;

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

    const user = await prisma.user.update({
      where: { id },
      data: data as never,
    });
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

  await prisma.user.update({
    where: { id },
    data: { status: "DEACTIVATED" },
  });
  return NextResponse.json({ ok: true });
}
